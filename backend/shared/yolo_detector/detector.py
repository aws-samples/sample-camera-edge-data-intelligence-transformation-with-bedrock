#!/usr/bin/env python3
"""
YOLO Detector

YOLOv9 MIT版を使用してオブジェクト検出とトラッキングを行います。
SupervisionのByteTrackでトラッキングを行います。

対応入力形式:
- pyav.VideoFrame
- numpy array (RGB)

環境対応:
- ECS Fargate (hlsyolo): フル機能（トラッキング、cv2アノテーション）
- Lambda (s3yolo): ワンショット検出のみ（libGL非依存）
"""
from __future__ import annotations

import os
import logging
import numpy as np
import torch
from pathlib import Path
from omegaconf import OmegaConf
from PIL import Image
from typing import List, Dict, Any, Tuple
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# =============================================================================
# 環境判定（モジュール読み込み時に一度だけ判定）
# =============================================================================
IS_LAMBDA = os.environ.get('AWS_LAMBDA_FUNCTION_NAME') is not None

if IS_LAMBDA:
    logger.info("Lambda環境を検出しました（ワンショット検出モード）")

# =============================================================================
# 環境依存のインポート
# - ECS Fargate: supervision/cv2を使用（トラッキング、アノテーション）
# - Lambda: supervision/cv2は使用しない（libGL依存を避けるため）
# =============================================================================
sv = None
cv2 = None

if not IS_LAMBDA:
    # ECS Fargate環境: supervision/cv2を通常インポート
    import supervision as sv
    import cv2


class YoloDetector:
    """YOLO検出クラス（トラッキング付き）"""
    
    def __init__(
        self, 
        model_path: str = 'v9-c',
        custom_weights: str = None,
        custom_dataset: str = 'coco',
        conf_threshold: float = 0.3,
        config_base_path: str = 'shared/yolo_detector/yolo/config'
    ):
        """
        YOLODetectorを初期化
        
        Args:
            model_path: YOLOモデル ('v9-c', 'v9-m', 'v9-e', 'v9-s', 'v9-t')
            custom_weights: カスタム重みのパス（オプション）
            custom_dataset: データセット名（デフォルト: 'coco'）
            conf_threshold: 検出信頼度閾値
            config_base_path: YOLOモデル設定ファイルのベースパス
        """
        self.model_path = model_path
        self.custom_weights = custom_weights
        self.custom_dataset = custom_dataset
        self.conf_threshold = conf_threshold
        self.config_base_path = config_base_path
        
        self.model = None
        self.converter = None
        self.post_process = None
        self.transform = None
        self.class_names = []
        
        # トラッキング関連
        self.tracker = None
        self.track_history = {}
        self.previous_positions = {}
        
        # デバイス設定
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        
        self._load_model()
    
    def _load_model(self):
        """YOLOモデルを読み込む"""
        from yolo import create_model, create_converter, PostProcess, NMSConfig, AugmentationComposer
        
        logger.info(f"YOLOv9モデルを読み込んでいます: {self.model_path}")
        
        # Lambda環境対応:
        # - 作業ディレクトリを/tmpに変更（重みダウンロード先、Lambdaは/tmp以外read-only）
        # - config_base_pathを絶対パスに変換（cwdが/tmpになるため相対パスが使えない）
        original_cwd = None
        config_base = self.config_base_path
        
        if IS_LAMBDA:
            original_cwd = os.getcwd()
            os.chdir('/tmp')  # nosec B108 - Lambda環境では/tmpのみ書き込み可能
            logger.info("Lambda環境: 作業ディレクトリを/tmpに変更")
            if not config_base.startswith('/'):
                config_base = f"/var/task/{config_base}"
                logger.info(f"Lambda環境: config_base_pathを絶対パスに変換: {config_base}")
        
        try:
            # 1. YOLOv9モデル設定を読み込み
            model_cfg_path = f"{config_base}/model/{self.model_path}.yaml"
            if not Path(model_cfg_path).exists():
                raise FileNotFoundError(f"モデル設定ファイルが見つかりません: {model_cfg_path}")
            
            model_cfg = OmegaConf.load(model_cfg_path)
            model_cfg.model.auxiliary = {}
            
            # 2. データセット設定を読み込み
            dataset_cfg_path = f"{config_base}/dataset/{self.custom_dataset}.yaml"
            if not Path(dataset_cfg_path).exists():
                raise FileNotFoundError(f"データセット設定ファイルが見つかりません: {dataset_cfg_path}")
            
            dataset_cfg = OmegaConf.load(dataset_cfg_path)
            class_num = len(dataset_cfg.class_list)
            
            # 3. モデル作成
            if self.custom_weights:
                logger.info(f"カスタム重みを読み込み: {self.custom_weights}")
                logger.info(f"クラス数: {class_num} (データセット: {self.custom_dataset})")
                
                weight_path = Path(self.custom_weights)
                if not weight_path.exists():
                    raise FileNotFoundError(f"カスタム重みファイルが見つかりません: {self.custom_weights}")
                
                self.model = create_model(model_cfg, weight_path=self.custom_weights, class_num=class_num)
            else:
                logger.info(f"事前学習済み重み（COCO）を使用")
                self.model = create_model(model_cfg, weight_path=True, class_num=80)
            
            self.model = self.model.to(self.device).eval()
            
            # 4. ボックス変換器作成
            image_size = (640, 640)
            self.converter = create_converter(
                model_cfg.name, self.model, model_cfg.anchor, image_size, self.device
            )
            
            # 5. NMS設定
            nms_config = NMSConfig(
                min_confidence=0.01,
                min_iou=0.5,
                max_bbox=300
            )
            self.post_process = PostProcess(self.converter, nms_config)
            
            # 6. 画像変換
            self.transform = AugmentationComposer([])
            
            # 7. クラス名リスト
            self.class_names = dataset_cfg.class_list
            
            # 8. トラッキング初期化
            # - ECS Fargate: ByteTrackでトラッキング
            # - Lambda: ワンショット検出のみ（トラッキング不要）
            if IS_LAMBDA:
                self.tracker = None
                logger.info("Lambda環境: トラッキング無効（ワンショット検出モード）")
            else:
                self.tracker = sv.ByteTrack()
            
            logger.info("YOLOv9 Detectorの初期化が完了しました")
            logger.info(f"  - デバイス: {self.device}")
            logger.info(f"  - モデル: {self.model_path}")
            logger.info(f"  - クラス数: {len(self.class_names)}")
            
        except FileNotFoundError as e:
            logger.error(f"ファイルが見つかりません: {e}")
            raise
        except Exception as e:
            logger.error(f"YOLOv9モデルの読み込みに失敗しました: {e}")
            raise
        finally:
            # Lambda環境: 元のcwdに戻す
            if IS_LAMBDA and original_cwd is not None:
                os.chdir(original_cwd)
                logger.info(f"Lambda環境: 作業ディレクトリを元に戻しました: {original_cwd}")
    
    def detect(self, frame) -> List[Dict[str, Any]]:
        """
        フレームを検出・トラッキング
        
        Args:
            frame: pyav.VideoFrame または numpy array (RGB)
            
        Returns:
            検出結果のリスト [
                {
                    'track_id': int,
                    'class': str,
                    'class_id': int,
                    'confidence': float,
                    'bbox': [x1, y1, x2, y2],
                    'center': (cx, cy),
                    'velocity': (vx, vy),
                    'track_status': str
                }, ...
            ]
        """
        # 1. フレーム変換（pyav → PIL Image）
        if hasattr(frame, 'to_ndarray'):
            img_np = frame.to_ndarray(format='rgb24')
            img = Image.fromarray(img_np)
        else:
            # numpy array (RGB) → PIL Image
            img = Image.fromarray(frame)
        
        # 2. YOLOv9の前処理
        image_tensor, _, rev_tensor = self.transform(img)
        image_tensor = image_tensor.to(self.device)[None]
        rev_tensor = rev_tensor.to(self.device)[None]
        
        # 3. YOLOv9推論
        with torch.no_grad():
            predict = self.model(image_tensor)
            pred_bbox = self.post_process(predict, rev_tensor)
        
        # デバッグ: post_process出力を確認
        logger.debug(f"YOLOv9 post_process結果: pred_bbox len={len(pred_bbox)}, " + 
                    (f"pred_bbox[0] len={len(pred_bbox[0])}" if len(pred_bbox) > 0 else "empty") +
                    f", 信頼度閾値={self.conf_threshold}")
        
        # 4. 結果をnumpy arrayに変換
        if len(pred_bbox) == 0 or len(pred_bbox[0]) == 0:
            logger.debug("YOLOv9検出: 0個")
            return []
        
        boxes = np.array(pred_bbox[0])
        
        # YOLOv9の出力形式: [class_id, x1, y1, x2, y2, confidence]
        class_ids = boxes[:, 0].astype(int)
        xyxy = boxes[:, 1:5]
        confidences = boxes[:, 5]
        
        # デバッグ: 検出結果を出力（フィルタリング前）
        if len(boxes) > 0:
            detected_classes = [self.class_names[int(cid)] if cid < len(self.class_names) else f"class_{cid}" for cid in class_ids]
            logger.debug(f"YOLOv9検出（フィルタ前）: {len(boxes)}個 - クラス: {detected_classes[:5]}{'...' if len(detected_classes) > 5 else ''}, 信頼度: {confidences[:5]}")
        
        # 信頼度閾値でフィルタリング
        conf_mask = confidences >= self.conf_threshold
        if not conf_mask.any():
            logger.debug(f"信頼度閾値{self.conf_threshold}以上の検出なし")
            return []
        
        class_ids = class_ids[conf_mask]
        xyxy = xyxy[conf_mask]
        confidences = confidences[conf_mask]
        
        logger.debug(f"YOLOv9検出（フィルタ後）: {len(confidences)}個 - 信頼度: {confidences[:5] if len(confidences) > 0 else []}")
        
        # 5. トラッキング処理
        # - ECS Fargate: ByteTrackでトラッキング（track_id, velocity等を付与）
        # - Lambda: ワンショット検出（トラッキングなし）
        if not IS_LAMBDA and self.tracker is not None:
            # Supervisionの形式に変換
            sv_detections = sv.Detections(
                xyxy=xyxy,
                confidence=confidences,
                class_id=class_ids
            )
            
            # ByteTrackでトラッキング
            sv_detections = self.tracker.update_with_detections(sv_detections)
            
            # 既存形式に変換
            return self._convert_to_legacy_format(sv_detections)
        else:
            # トラッキングなし（ワンショット検出用）
            return self._convert_to_simple_format(xyxy, confidences, class_ids)
    
    def _convert_to_legacy_format(self, sv_detections: sv.Detections) -> List[Dict[str, Any]]:
        """Supervisionの検出結果を既存形式に変換"""
        detections = []
        current_time = datetime.now(timezone.utc).timestamp()
        
        if sv_detections.tracker_id is None:
            return detections
        
        for i in range(len(sv_detections)):
            bbox = sv_detections.xyxy[i]
            confidence = sv_detections.confidence[i] if sv_detections.confidence is not None else 0.0
            class_id = int(sv_detections.class_id[i]) if sv_detections.class_id is not None else 0
            track_id = int(sv_detections.tracker_id[i])
            
            x1, y1, x2, y2 = bbox
            center_x = (x1 + x2) / 2
            center_y = (y1 + y2) / 2
            
            # 速度計算
            velocity_x, velocity_y = self._calculate_velocity(
                track_id, center_x, center_y, current_time
            )
            
            # トラック状態判定
            track_status = self._get_track_status(track_id)
            
            class_name = self.class_names[class_id] if class_id < len(self.class_names) else f"class_{class_id}"
            
            detection = {
                'track_id': track_id,
                'class': class_name,
                'class_id': class_id,
                'confidence': float(confidence),
                'bbox': [float(x1), float(y1), float(x2), float(y2)],
                'center': (float(center_x), float(center_y)),
                'velocity': (float(velocity_x), float(velocity_y)),
                'track_status': track_status
            }
            
            detections.append(detection)
            
            # 履歴更新
            self._update_history(track_id, center_x, center_y, current_time)
        
        return detections
    
    def _convert_to_simple_format(
        self, 
        xyxy: np.ndarray, 
        confidences: np.ndarray, 
        class_ids: np.ndarray
    ) -> List[Dict[str, Any]]:
        """
        トラッキングなしの単純な検出結果フォーマットに変換
        （supervisionが利用できない環境用）
        """
        detections = []
        
        for i in range(len(xyxy)):
            x1, y1, x2, y2 = xyxy[i]
            confidence = confidences[i]
            class_id = int(class_ids[i])
            
            center_x = (x1 + x2) / 2
            center_y = (y1 + y2) / 2
            
            class_name = self.class_names[class_id] if class_id < len(self.class_names) else f"class_{class_id}"
            
            detection = {
                'class': class_name,
                'class_id': class_id,
                'confidence': float(confidence),
                'bbox': [float(x1), float(y1), float(x2), float(y2)],
                'center': (float(center_x), float(center_y)),
            }
            
            detections.append(detection)
        
        return detections
    
    def _calculate_velocity(
        self, 
        track_id: int, 
        x: float, 
        y: float, 
        current_time: float
    ) -> Tuple[float, float]:
        """トラックの移動速度を計算（ピクセル/秒）"""
        if track_id not in self.previous_positions:
            return 0.0, 0.0
        
        prev_x, prev_y, prev_time = self.previous_positions[track_id]
        time_delta = current_time - prev_time
        
        if time_delta < 0.001:
            return 0.0, 0.0
        
        velocity_x = (x - prev_x) / time_delta
        velocity_y = (y - prev_y) / time_delta
        
        self.previous_positions[track_id] = (x, y, current_time)
        
        return velocity_x, velocity_y
    
    def _get_track_status(self, track_id: int) -> str:
        """トラックの状態を判定"""
        if track_id not in self.track_history:
            return 'new'
        
        history_length = len(self.track_history[track_id])
        if history_length < 3:
            return 'new'
        else:
            return 'active'
    
    def _update_history(self, track_id: int, x: float, y: float, timestamp: float):
        """トラック履歴を更新"""
        if track_id not in self.track_history:
            self.track_history[track_id] = []
            self.previous_positions[track_id] = (x, y, timestamp)
        
        self.track_history[track_id].append((timestamp, x, y))
        if len(self.track_history[track_id]) > 30:
            self.track_history[track_id].pop(0)
    
    def reset_tracker(self):
        """
        トラッカーをリセット（ストリーム再接続時など）
        
        Note:
            Lambda環境ではトラッカーは常にNone（ワンショット検出のため不要）
        """
        if IS_LAMBDA:
            self.tracker = None
        else:
            self.tracker = sv.ByteTrack()
        self.track_history.clear()
        self.previous_positions.clear()
        logger.info("トラッカーをリセットしました")
    
    def annotate(self, frame_bgr: np.ndarray, detections: List[Dict[str, Any]]) -> np.ndarray:
        """
        検出結果を画像に描画
        
        Args:
            frame_bgr: numpy array (BGR形式)
            detections: detect()の戻り値
            
        Returns:
            アノテーション済み画像（BGR形式のnumpy array）
            
        Note:
            cv2が利用できない環境では使用不可（Lambda環境など）
        """
        # Lambda環境ではcv2が利用不可（libGL依存）
        # s3yolo等ではPillowで独自にアノテーションを実装している
        if IS_LAMBDA:
            raise RuntimeError(
                "Lambda環境ではannotate()は使用できません。"
                "Pillowでの独自実装を使用してください。"
            )
        
        try:
            img = frame_bgr.copy()
            
            if img.dtype != np.uint8:
                img = img.astype(np.uint8)
            
            for det in detections:
                x1, y1, x2, y2 = [int(v) for v in det['bbox']]
                class_name = det['class']
                confidence = det['confidence']
                
                # トラッキング情報
                track_id = det.get('track_id')
                status = det.get('track_status', 'active')
                velocity = det.get('velocity')
                
                # ボックス描画（ステータスで色分け）
                if status == 'new':
                    color = (0, 255, 0)  # 緑
                elif status == 'active':
                    color = (255, 0, 0)  # 青
                else:
                    color = (0, 165, 255)  # オレンジ
                
                cv2.rectangle(img, (x1, y1), (x2, y2), color, 2)
                
                # ラベル描画
                if track_id is not None:
                    label = f"ID:{track_id} {class_name} {confidence:.2f}"
                else:
                    label = f"{class_name} {confidence:.2f}"
                
                label_size, _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 2)
                cv2.rectangle(img, (x1, y1 - label_size[1] - 5), 
                             (x1 + label_size[0], y1), color, -1)
                cv2.putText(img, label, (x1, y1 - 5), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 2)
                
                # 速度情報描画
                if velocity:
                    vx, vy = velocity
                    speed = np.sqrt(vx**2 + vy**2)
                    if speed > 1.0:
                        velocity_text = f"Speed: {speed:.1f}px/s"
                        cv2.putText(img, velocity_text, (x1, y2 + 15), 
                                   cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1)
            
            return img
            
        except Exception as e:
            logger.error(f"annotateでエラー: {e}", exc_info=True)
            return frame_bgr.copy() if frame_bgr.dtype == np.uint8 else frame_bgr.astype(np.uint8)
    
    def filter_by_class(
        self, 
        detections: List[Dict[str, Any]], 
        target_classes: List[str],
        min_confidence: float = None
    ) -> List[Dict[str, Any]]:
        """
        クラスと信頼度でフィルタリング
        
        Args:
            detections: detect()の戻り値
            target_classes: 対象クラス名リスト
            min_confidence: 最小信頼度（Noneの場合は self.conf_threshold）
        
        Returns:
            フィルタ後の検出結果
        """
        min_conf = min_confidence if min_confidence is not None else self.conf_threshold
        target_lower = [c.lower() for c in target_classes]
        
        return [
            d for d in detections
            if d['class'].lower() in target_lower
            and d['confidence'] >= min_conf
        ]
