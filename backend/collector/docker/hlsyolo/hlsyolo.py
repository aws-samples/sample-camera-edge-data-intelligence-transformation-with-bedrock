#!/usr/bin/env python3
"""
HLS + YOLO11 + BoT-SORT トラッキングコレクター（イベント駆動版）

HLSストリーム（Kinesis Video StreamsまたはVSaaS）から映像を取得し、
YOLO11でオブジェクト検出、BoT-SORTでトラッキングを行い、
イベント発生時のみS3とDynamoDBに保存します。
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
import boto3
from botocore.exceptions import NoCredentialsError, ClientError
import av
import click
from PIL import Image
import io
import time
import uuid
import logging
import cv2
import numpy as np
import json
import ast
from concurrent.futures import ThreadPoolExecutor
import threading
from queue import Queue, Empty

# shared.commonから共通関数をインポート
from shared.common import *

from shared.hls_connector import HlsConnectorFactory
from shared.yolo_detector import YoloDetector, filter_detections_by_class, build_class_detect_data
from shared.eventbridge_publisher import (
    EventBridgePublisher,
    EVENT_TYPE_CLASS_DETECT,
    EVENT_TYPE_AREA_DETECT
)
from shared.detect_log_helper import (
    get_or_create_collector_internal_detector,
    get_collector_internal_detector_id,
    save_area_detect_log,
    save_class_detect_log
)

# 環境変数の取得
COLLECTOR_ID = os.environ.get('COLLECTOR_ID')
if not COLLECTOR_ID:
    print("ERROR: COLLECTOR_ID環境変数が設定されていません。")
    import sys
    sys.exit(1)

# ロガーの設定
logger = setup_logger(__name__)

# Shapely（エリア検出用）
try:
    from shapely.geometry import Point, Polygon, box
    SHAPELY_AVAILABLE = True
except ImportError:
    logger.warning("Shapely がインストールされていません。area_detect機能は使用できません。")
    SHAPELY_AVAILABLE = False

# ThreadPoolExecutor（非同期画像保存とdetector実行用）
# 注意: グローバル変数として定義せず、関数内でローカル作成する


class TrackingManager:
    """トラッキング管理クラス（イベント駆動版）"""
    
    def __init__(self, camera_id: str, collector_type: str = 'hlsYolo'):
        """
        初期化
        
        Args:
            camera_id: カメラID
            collector_type: コレクタータイプ
        """
        self.camera_id = camera_id
        self.collector_type = collector_type
        
        # コレクター設定を環境変数COLLECTOR_IDから取得
        from shared.database import get_collector_by_id
        
        settings = get_collector_by_id(COLLECTOR_ID)
        if not settings:
            raise ValueError(f"Collector not found: {COLLECTOR_ID}")
        
        logger.info(f"Collector settings: {settings}")
        
        # collector_idを保存（環境変数と同じ）
        self.collector_id = COLLECTOR_ID
        
        # collector_modeを保存
        self.collector_mode = settings.get('collector_mode', 'image')
        
        # 設定値を保存（ミリ秒単位）
        self.capture_track_interval_ms = int(settings.get('capture_track_interval', 200))
        
        # collect_classをリストに変換（カンマまたは|区切り）
        collect_class_str = settings.get('collect_class', 'person')
        import re
        self.collect_classes = [c.strip() for c in re.split(r'[,|]', collect_class_str) if c.strip()]
        
        # confidence閾値を取得（デフォルト: 0.5）
        self.confidence_threshold = float(settings.get('confidence', 0.5))
        logger.info(f"Confidence閾値: {self.confidence_threshold}")
        
        # track_eventtype と detect_area を取得
        self.track_eventtype = settings.get('track_eventtype', 'class_detect')
        detect_area_str = settings.get('detect_area', '')
        self.detect_area_polygon = None
        
        # エリア判定設定を取得
        self.area_detect_type = settings.get('area_detect_type', 'center')
        area_detect_iou_threshold = settings.get('area_detect_iou_threshold', 0.5)
        self.area_detect_iou_threshold = float(area_detect_iou_threshold if area_detect_iou_threshold is not None else 0.5)
        
        # エリア検出判定方法を取得（デフォルト: track_ids_change）
        self.area_detect_method = settings.get('area_detect_method', 'track_ids_change')
        
        if self.track_eventtype == 'area_detect' and detect_area_str and SHAPELY_AVAILABLE:
            try:
                area_points = ast.literal_eval(detect_area_str)
                self.detect_area_polygon = Polygon(area_points)
                logger.info(f"=" * 60)
                logger.info(f"エリア検出設定:")
                logger.info(f"  - エリアポリゴン座標: {area_points}")
                logger.info(f"  - ポリゴン頂点数: {len(area_points)}")
                logger.info(f"  - 判定方法(area_detect_type): {self.area_detect_type}")
                if self.area_detect_type == 'iou':
                    logger.info(f"  - IoU閾値: {self.area_detect_iou_threshold}")
                logger.info(f"  - 検出方法(area_detect_method): {self.area_detect_method}")
                logger.info(f"=" * 60)
            except Exception as e:
                logger.error(f"detect_area解析エラー: {e}")
                self.detect_area_polygon = None
        
        logger.info(f"トラック間隔: {self.capture_track_interval_ms}ms")
        logger.info(f"検出対象クラス: {self.collect_classes}")
        logger.info(f"トラックイベントタイプ: {self.track_eventtype}")
        
        # タイムスタンプ管理
        self.last_track_time_ms = None
        self.last_capture_jpeg_time = None
        
        # capture.jpeg更新間隔（10分）
        self.capture_jpeg_interval = 600
        
        # イベント発火間隔管理（疎結合: detector を知らない）
        self.last_event_time_ms = 0
        self.event_interval_ms = self.capture_track_interval_ms  # collector 設定を使用
        logger.info(f"イベント発火間隔: {self.event_interval_ms}ms")
        
        # YOLOモデルパス
        self.model_path = settings.get('model_path', 'v9-c')
        logger.info(f"YOLOモデルパス: {self.model_path}")
        
        # area_detect用の状態管理（前回の領域内track_idセット）
        self.previous_area_track_ids = set()
        
        # class_count_change用: 前回のエリア内オブジェクト数
        self.previous_area_count = 0
        
        # 最新の侵入・退出ID（EventBridge用）
        self.intrusion_ids = []
        self.exit_ids = []
        
        # class_count_change用: 侵入数・退出数（EventBridge用）
        self.intrusion_count = 0
        self.exit_count = 0
        
        # class_count_change用: イベント発生フラグ（intrusion_ids/exit_idsが空でもイベント発行するため）
        self.area_event_triggered = False
        
        # エリア判定状態の定期ログ用（30秒に1回）
        self.last_area_status_log_ms = None
        self.area_status_log_interval_ms = 30000  # 30秒
        
        # 定期画像保存設定（環境変数で制御、デフォルト: False）
        enable_periodic_save_env = os.environ.get('ENABLE_PERIODIC_SAVE', 'false').lower()
        self.capture_track_image_flg = enable_periodic_save_env in ('true', '1', 'yes')
        self.capture_track_image_counter = int(settings.get('capture_track_image_counter', 25))
        
        # 画像保存用タイマー（時間ベース）
        self.last_periodic_save_time_ms = 0
        self.periodic_save_interval_ms = self.capture_track_interval_ms * self.capture_track_image_counter
        
        logger.info(f"定期画像保存: enabled={self.capture_track_image_flg}, interval={self.periodic_save_interval_ms}ms ({self.periodic_save_interval_ms/1000:.1f}秒)")
        
        # 仮想 Detector の取得/作成（一度だけ実行、既存があれば再利用）
        self.virtual_detector = get_or_create_collector_internal_detector(
            collector_id=self.collector_id,
            camera_id=camera_id,
            event_type=self.track_eventtype,
            collector_mode=self.collector_mode
        )
        if self.virtual_detector:
            self.virtual_detector_id = self.virtual_detector['detector_id']
            logger.info(f"仮想 Detector 取得完了: detector_id={self.virtual_detector_id}")
        else:
            self.virtual_detector_id = get_collector_internal_detector_id(self.collector_id)
            logger.warning(f"仮想 Detector の取得/作成に失敗しました。detector_id={self.virtual_detector_id} を使用します")
    
    def should_save_image_for_tracking(self, has_detector_trigger: bool, current_time_ms: int) -> tuple:
        """
        トラッキング時に画像を保存すべきかを判定（時間ベース）
        
        Args:
            has_detector_trigger: detectorがトリガーされたか
            current_time_ms: 現在時刻（ミリ秒）
        
        Returns:
            tuple[bool, str]: (保存すべきか, 保存理由)
                - (True, 'detector'): detector用に保存
                - (True, 'periodic'): 定期保存
                - (False, ''): 保存しない
        """
        # 1. detectorトリガーの場合は必ず保存
        if has_detector_trigger:
            self.last_periodic_save_time_ms = current_time_ms  # タイマーリセット
            return True, 'detector'
        
        # 2. 定期保存が無効な場合はスキップ
        if not self.capture_track_image_flg:
            return False, ''
        
        # 3. 時間ベースで定期保存判定
        if self.last_periodic_save_time_ms == 0:
            # 初回は保存
            self.last_periodic_save_time_ms = current_time_ms
            return True, 'periodic'
        
        elapsed_ms = current_time_ms - self.last_periodic_save_time_ms
        if elapsed_ms >= self.periodic_save_interval_ms:
            self.last_periodic_save_time_ms = current_time_ms
            return True, 'periodic'
        
        return False, ''
    
    def _is_in_area(self, detection: dict) -> bool:
        """
        バウンディングボックスがエリア内にあるか判定
        
        Args:
            detection: 検出情報（bbox, centerを含む）
            
        Returns:
            bool: エリア内ならTrue
        """
        if not self.detect_area_polygon or not SHAPELY_AVAILABLE:
            return False
        
        bbox = detection['bbox']  # [x1, y1, x2, y2]
        center = detection['center']  # [center_x, center_y]
        track_id = detection.get('track_id', 'unknown')
        class_name = detection.get('class', 'unknown')
        
        result = False
        
        if self.area_detect_type == 'center':
            # 中心点判定（高速）
            point = Point(center[0], center[1])
            result = self.detect_area_polygon.contains(point)
            logger.info(f"[エリア判定] ID={track_id}, class={class_name}, center=({center[0]:.0f},{center[1]:.0f}), 判定={'エリア内' if result else 'エリア外'} (center)")
        
        elif self.area_detect_type == 'intersects':
            # 一部でも重なり判定（高速）
            bbox_polygon = box(bbox[0], bbox[1], bbox[2], bbox[3])
            result = bbox_polygon.intersects(self.detect_area_polygon)
            logger.info(f"[エリア判定] ID={track_id}, class={class_name}, bbox={bbox}, 判定={'エリア内' if result else 'エリア外'} (intersects)")
        
        elif self.area_detect_type == 'iou':
            # IoU閾値判定（柔軟、やや低速）
            bbox_polygon = box(bbox[0], bbox[1], bbox[2], bbox[3])
            
            # 交差部分と和集合を計算
            try:
                intersection = bbox_polygon.intersection(self.detect_area_polygon)
                union = bbox_polygon.union(self.detect_area_polygon)
                
                intersection_area = intersection.area
                union_area = union.area
                
                if union_area == 0:
                    result = False
                else:
                    iou = intersection_area / union_area
                    result = iou >= self.area_detect_iou_threshold
                    logger.info(f"[エリア判定] ID={track_id}, class={class_name}, bbox={bbox}, IoU={iou:.3f}, 閾値={self.area_detect_iou_threshold}, 判定={'エリア内' if result else 'エリア外'} (iou)")
            except Exception as e:
                logger.error(f"IoU計算エラー: {e}")
                result = False
        else:
            # デフォルトは中心点判定
            point = Point(center[0], center[1])
            result = self.detect_area_polygon.contains(point)
            logger.info(f"[エリア判定] ID={track_id}, class={class_name}, center=({center[0]:.0f},{center[1]:.0f}), 判定={'エリア内' if result else 'エリア外'} (default:center)")
        
        return result
    
    def should_do_tracking(self, current_time_ms: int) -> bool:
        """
        トラッキング実行タイミング判定
        
        Args:
            current_time_ms: 現在時刻（ミリ秒）
            
        Returns:
            実行すべきかどうか
        """
        if self.last_track_time_ms is None:
            return True
        
        # capture_track_intervalが0の場合はトラッキングオフ
        if self.capture_track_interval_ms == 0:
            return False
        
        elapsed = current_time_ms - self.last_track_time_ms
        return elapsed >= self.capture_track_interval_ms
    
    def update_track_time(self, current_time_ms: int):
        """トラック時刻を更新"""
        self.last_track_time_ms = current_time_ms
    
    def should_update_capture_jpeg(self, current_time: datetime) -> bool:
        """capture.jpeg更新タイミング判定"""
        if self.last_capture_jpeg_time is None:
            return True
        
        elapsed = (current_time - self.last_capture_jpeg_time).total_seconds()
        return elapsed >= self.capture_jpeg_interval
    
    def update_capture_jpeg_time(self, current_time: datetime):
        """capture.jpeg更新時刻を更新"""
        self.last_capture_jpeg_time = current_time
    
    def check_event_conditions(self, current_time_ms: int, filtered_detections: list) -> bool:
        """
        イベント発生条件をチェック（疎結合: detector を知らない）
        
        Args:
            current_time_ms: 現在時刻（ミリ秒）
            filtered_detections: collect_classに合致する検出リスト
            
        Returns:
            bool: イベントを発火すべきか
        """
        # collect_classに合致するオブジェクトがない場合は何もしない
        if not filtered_detections:
            return False
        
        if self.track_eventtype == 'class_detect':
            # (1) class_detect の場合: オブジェクト検出あり → イベント発火
            if self._should_fire_event(current_time_ms):
                self.last_event_time_ms = current_time_ms
                logger.info(f"【ClassDetect】イベント発火: 検出数={len(filtered_detections)}")
                return True
            return False
        
        elif self.track_eventtype == 'area_detect':
            # (2) area_detect の場合
            if not self.detect_area_polygon or not SHAPELY_AVAILABLE:
                logger.warning("area_detect指定されていますが、ポリゴンが設定されていないか、Shapelyが利用できません")
                return False
            
            # 現在の領域内track_idセットを構築
            current_area_track_ids = set()
            for detection in filtered_detections:
                if self._is_in_area(detection):
                    current_area_track_ids.add(detection['track_id'])
            
            current_count = len(current_area_track_ids)
            should_fire = False
            
            if self.area_detect_method == 'track_ids_change':
                # ========================================
                # (2-1) track_ids_change モード
                # track_idの変化で侵入・退出を判定
                # ========================================
                if current_area_track_ids != self.previous_area_track_ids:
                    entered_ids = current_area_track_ids - self.previous_area_track_ids
                    exited_ids = self.previous_area_track_ids - current_area_track_ids
                    
                    # EventBridge用に侵入・退出IDを保存
                    self.intrusion_ids = list(entered_ids)
                    self.exit_ids = list(exited_ids)
                    
                    # 侵入数・退出数を設定
                    self.intrusion_count = len(entered_ids)
                    self.exit_count = len(exited_ids)
                    
                    if entered_ids or exited_ids:
                        self._log_area_change(filtered_detections, current_area_track_ids, 'track_ids_change', entered_ids, exited_ids)
                        should_fire = True
                else:
                    # 変化がなければ侵入・退出IDと数をクリア
                    self.intrusion_ids = []
                    self.exit_ids = []
                    self.intrusion_count = 0
                    self.exit_count = 0
            
            elif self.area_detect_method == 'class_count_change':
                # ========================================
                # (2-2) class_count_change モード
                # 数の増減で侵入・退出を判定
                # ========================================
                previous_count = self.previous_area_count
                
                if current_count != previous_count:
                    entered_count = max(0, current_count - previous_count)
                    exited_count = max(0, previous_count - current_count)
                    
                    # entered_ids / exited_ids は空配列（個体識別しない）
                    self.intrusion_ids = []
                    self.exit_ids = []
                    
                    # 侵入数・退出数を設定
                    self.intrusion_count = entered_count
                    self.exit_count = exited_count
                    
                    if entered_count > 0 or exited_count > 0:
                        logger.info(f"【🎯🎯🎯 エリア変化検出（class_count_change）🎯🎯🎯】前回数={previous_count}, 今回数={current_count}, 侵入数={entered_count}, 退出数={exited_count}")
                        self.area_event_triggered = True
                        should_fire = True
                else:
                    # 変化がなければクリア
                    self.intrusion_ids = []
                    self.exit_ids = []
                    self.intrusion_count = 0
                    self.exit_count = 0
                    self.area_event_triggered = False
            
            # 定期的に現在の状態をログ出力（30秒に1回）
            self._log_area_status_periodic(current_time_ms, filtered_detections, current_area_track_ids, current_count)
            
            # 状態を更新
            self.previous_area_track_ids = current_area_track_ids
            self.previous_area_count = current_count
            
            if should_fire:
                self.last_event_time_ms = current_time_ms
                logger.info(f"【AreaDetect】イベント発火")
            
            return should_fire
        
        return False
    
    def _should_fire_event(self, current_time_ms: int) -> bool:
        """イベント発火間隔チェック"""
        if self.last_event_time_ms == 0:
            return True
        return (current_time_ms - self.last_event_time_ms) >= self.event_interval_ms
    
    def _log_area_change(self, filtered_detections: list, current_area_track_ids: set, method: str, entered_ids: set = None, exited_ids: set = None):
        """エリア変化のログ出力"""
        inside_tracks = []
        outside_tracks = []
        for detection in filtered_detections:
            track_id = detection['track_id']
            class_name = detection['class']
            center_x, center_y = detection['center']
            confidence = detection['confidence']
            bbox = detection['bbox']
            
            track_info = f"ID={track_id}, class={class_name}, bbox={bbox}, center=({center_x:.0f},{center_y:.0f}), conf={confidence:.2f}"
            
            if track_id in current_area_track_ids:
                inside_tracks.append(track_info)
            else:
                outside_tracks.append(track_info)
        
        if entered_ids is not None and exited_ids is not None:
            logger.info(f"【🎯🎯🎯 エリア変化検出（{method}）🎯🎯🎯】侵入={list(entered_ids)}, 退出={list(exited_ids)}")
        logger.info(f"  - エリア内track（{len(inside_tracks)}件）: {inside_tracks if inside_tracks else 'なし'}")
        logger.info(f"  - エリア外track（{len(outside_tracks)}件）: {outside_tracks if outside_tracks else 'なし'}")
    
    def _log_area_status_periodic(self, current_time_ms: int, filtered_detections: list, current_area_track_ids: set, current_count: int):
        """定期的に現在の状態をログ出力（30秒に1回）"""
        should_log_status = (
            self.last_area_status_log_ms is None or
            (current_time_ms - self.last_area_status_log_ms) >= self.area_status_log_interval_ms
        )
        
        if should_log_status:
            inside_tracks = []
            outside_tracks = []
            for detection in filtered_detections:
                track_id = detection['track_id']
                class_name = detection['class']
                center_x, center_y = detection['center']
                confidence = detection['confidence']
                bbox = detection['bbox']
                
                track_info = f"ID={track_id}, class={class_name}, bbox={bbox}, center=({center_x:.0f},{center_y:.0f}), conf={confidence:.2f}"
                
                if track_id in current_area_track_ids:
                    inside_tracks.append(track_info)
                else:
                    outside_tracks.append(track_info)
            
            logger.info(f"【定期状態ログ】method={self.area_detect_method}, エリア内数={current_count}, track_ids={list(current_area_track_ids)}")
            logger.info(f"  - エリア内詳細（{len(inside_tracks)}件）: {inside_tracks if inside_tracks else 'なし'}")
            logger.info(f"  - エリア外詳細（{len(outside_tracks)}件）: {outside_tracks if outside_tracks else 'なし'}")
            self.last_area_status_log_ms = current_time_ms


def save_track_log(dynamodb, camera_id: str, collector_id: str, 
                   current_time: datetime, all_detections: list, filtered_detections: list,
                   file_id: str, image_width: int, image_height: int,
                   area_track_ids: set = None, detect_area_polygon = None,
                   entered_ids: set = None, exited_ids: set = None):
    """
    TRACK_LOG_TABLE にレコード保存（1フレームにつき1レコード）
    
    Args:
        dynamodb: DynamoDBリソース
        camera_id: カメラID
        collector_id: コレクターID (UUID)
        current_time: 現在時刻
        all_detections: 全検出情報リスト（track_alldata用）
        filtered_detections: フィルタ後の検出情報リスト（track_classdata用）
        file_id: ファイルID
        image_width: 画像幅
        image_height: 画像高さ
        area_track_ids: 領域内track_idセット（area_detectの場合）
        detect_area_polygon: 検出エリアポリゴン（area_detectの場合）
        entered_ids: 今回侵入したtrack_idセット（area_detectの場合）
        exited_ids: 今回退出したtrack_idセット（area_detectの場合）
        
    Returns:
        tuple: (track_log_id, track_data_dict)
            track_log_id: トラックログID（UUID）
            track_data_dict: DBに保存したデータ
    """
    try:
        import uuid
        
        track_table = dynamodb.Table(TRACK_LOG_TABLE)
        
        time_str = format_for_db(current_time)
        track_log_id = str(uuid.uuid4())
        
        # track_alldata: 全検出結果をMapに変換（key: track_id, value: track情報）
        track_alldata = {}
        for detection in all_detections:
            track_id = str(detection['track_id'])
            x1, y1, x2, y2 = detection['bbox']
            track_alldata[track_id] = {
                'track_id': track_id,
                'class': detection['class'],
                'confidence': Decimal(str(detection['confidence'])),
                'bbox': [int(x1), int(y1), int(x2), int(y2)],
                'center': [int(c) for c in detection['center']],
                'velocity': [Decimal(str(v)) for v in detection['velocity']],
                'track_status': detection['track_status']
            }
        
        # track_classdata: フィルタ後の検出結果をMapに変換
        track_classdata = {}
        for detection in filtered_detections:
            track_id = str(detection['track_id'])
            x1, y1, x2, y2 = detection['bbox']
            track_classdata[track_id] = {
                'track_id': track_id,
                'class': detection['class'],
                'confidence': Decimal(str(detection['confidence'])),
                'bbox': [int(x1), int(y1), int(x2), int(y2)],
                'center': [int(c) for c in detection['center']],
                'velocity': [Decimal(str(v)) for v in detection['velocity']],
                'track_status': detection['track_status']
            }
        
        # area_in_data / area_out_data: エリア判定に基づいて分類
        area_in_data = {}
        area_out_data = {}
        
        if area_track_ids is not None:
            for track_id, track_info in track_classdata.items():
                if int(track_id) in area_track_ids:
                    area_in_data[track_id] = track_info
                else:
                    area_out_data[track_id] = track_info
        
        # entered_ids, exited_ids を String（パイプ区切り）に変換
        entered_ids_str = '|'.join(str(tid) for tid in sorted(entered_ids)) if entered_ids else ''
        exited_ids_str = '|'.join(str(tid) for tid in sorted(exited_ids)) if exited_ids else ''
        entered_ids_count = len(entered_ids) if entered_ids else 0
        exited_ids_count = len(exited_ids) if exited_ids else 0
        
        # DynamoDBアイテム構築
        item = {
            'track_log_id': track_log_id,
            'camera_id': camera_id,
            'collector_id': collector_id,
            'file_id': file_id,
            'time': time_str,
            'track_alldata': track_alldata,
            'track_classdata': track_classdata,
            'area_in_data': area_in_data,
            'area_out_data': area_out_data,
            'area_in_count': len(area_in_data),
            'area_out_count': len(area_out_data),
            'entered_ids_count': entered_ids_count,
            'exited_ids_count': exited_ids_count
        }
        
        # 空文字列の場合はフィールドを保存しない（DynamoDBの制約）
        if entered_ids_str:
            item['entered_ids'] = entered_ids_str
        if exited_ids_str:
            item['exited_ids'] = exited_ids_str
        
        track_table.put_item(Item=item)
        
        logger.info(f"トラックログ保存: track_log_id={track_log_id}, file_id={file_id}, "
                   f"全検出数={len(all_detections)}, フィルタ後={len(filtered_detections)}, "
                   f"エリア内={len(area_in_data)}, エリア外={len(area_out_data)}, "
                   f"新規侵入={entered_ids_count}件[{entered_ids_str}], "
                   f"新規退出={exited_ids_count}件[{exited_ids_str}]")
        
        # EventBridge用にDBに保存したデータを返す
        track_data = {
            'time': time_str,
            'track_alldata': track_alldata,
            'track_classdata': track_classdata,
            'area_in_data': area_in_data,
            'area_out_data': area_out_data,
            'area_in_count': len(area_in_data),
            'area_out_count': len(area_out_data),
            'entered_ids': entered_ids_str,
            'entered_ids_count': entered_ids_count,
            'exited_ids': exited_ids_str,
            'exited_ids_count': exited_ids_count
        }
        
        return track_log_id, track_data
    
    except Exception as e:
        logger.error(f"トラックログ保存エラー: {e}")
        raise


def yolo_processing_worker(
    processing_queue: Queue,
    tracker: 'YoloDetector',
    manager: TrackingManager,
    s3, dynamodb,
    bucket_name: str,
    camera_id: str,
    image_save_executor: ThreadPoolExecutor,
    detector_executor: ThreadPoolExecutor,
    event_publisher: EventBridgePublisher,
    worker_stats: dict
):
    """
    YOLOトラッキング処理ワーカースレッド（単一スレッドで順次処理）
    
    Args:
        processing_queue: フレーム処理キュー
        tracker: YoloDetectorインスタンス
        manager: TrackingManagerインスタンス
        s3: S3クライアント
        dynamodb: DynamoDBリソース
        bucket_name: S3バケット名
        camera_id: カメラID
        image_save_executor: 画像保存用ThreadPoolExecutor
        detector_executor: Detector実行用ThreadPoolExecutor
        event_publisher: EventBridgePublisherインスタンス
        worker_stats: ワーカー統計情報（処理フレーム数など）
    """
    logger.info("🔧 YOLOワーカースレッド開始")
    processed_count = 0
    
    try:
        while True:
            # キューからフレームデータを取得（ブロッキング、タイムアウト付き）
            try:
                frame_data = processing_queue.get(timeout=1.0)
            except Empty:
                continue
            
            # 終了シグナル
            if frame_data is None:
                logger.info("🛑 YOLOワーカースレッド終了シグナル受信")
                break
            
            # フレームデータ取り出し
            frame_rgb = frame_data['frame_rgb']
            current_time = frame_data['current_time']
            current_time_ms = frame_data['current_time_ms']
            image_width = frame_data['image_width']
            image_height = frame_data['image_height']
            
            try:
                # YOLO推論実行（RGB形式で渡す）
                detections = tracker.detect(frame_rgb)
                
                # デバッグ: 検出結果を確認（信頼度付き）
                if detections:
                    det_summary = [f"{d['class']}({d['confidence']:.2f})" for d in detections[:5]]
                    logger.info(f"🔍 YOLO検出結果: {len(detections)}個 - {det_summary}{'...' if len(detections) > 5 else ''}")
                else:
                    logger.info(f"🔍 YOLO検出結果: 0個")
                
                # 指定クラス + confidence閾値でフィルタリング（共通関数使用）
                logger.info(f"🔍 フィルタ条件: classes={manager.collect_classes}, confidence>={manager.confidence_threshold}")
                
                filtered_detections = filter_detections_by_class(
                    detections,
                    manager.collect_classes,
                    manager.confidence_threshold
                )
                
                # フィルタ後の結果を詳細に表示
                if filtered_detections:
                    filtered_summary = [f"{d['class']}({d['confidence']:.2f})" for d in filtered_detections[:5]]
                    logger.info(f"✅ 最終判定: {len(filtered_detections)}個を検出 - {filtered_summary}{'...' if len(filtered_detections) > 5 else ''}")
                else:
                    logger.info(f"✅ 最終判定: 検出なし")
                
                # イベント発生条件をチェック（疎結合: detector を知らない）
                should_fire_event = manager.check_event_conditions(current_time_ms, filtered_detections)
                
                # 画像保存判定（イベント発火 or 定期保存）
                should_save, save_reason = manager.should_save_image_for_tracking(
                    has_detector_trigger=should_fire_event,
                    current_time_ms=current_time_ms
                )
                
                if should_save:
                    logger.info(f"画像保存: 理由={save_reason}, should_fire_event={should_fire_event}")
                    
                    # アノテーション用にBGR変換（OpenCV描画のため）
                    frame_bgr = cv2.cvtColor(frame_rgb, cv2.COLOR_RGB2BGR)
                    annotated_frame = tracker.annotate(frame_bgr, filtered_detections)
                    
                    # 画像保存を非同期で実行（別スレッド）
                    image_save_executor.submit(
                        save_image_async,
                        s3, dynamodb, bucket_name, camera_id,
                        manager, frame_rgb.copy(), annotated_frame.copy(),
                        current_time, detections, filtered_detections,
                        image_width, image_height,
                        detector_executor,
                        event_publisher,
                        should_fire_event=should_fire_event,
                        save_reason=save_reason
                    )
                
                processed_count += 1
                worker_stats['processed_frames'] = processed_count
                
            except Exception as e:
                logger.error(f"⚠️  YOLOワーカー処理エラー: {e}", exc_info=True)
    
    except Exception as e:
        logger.error(f"❌ YOLOワーカースレッドでエラー: {e}", exc_info=True)
    finally:
        logger.info(f"✅ YOLOワーカースレッド終了: 処理フレーム数={processed_count}")


def process_hls_stream_with_tracking(camera_id: str, bucket_name: str) -> None:
    """
    HLSストリームからトラッキング処理を実行（フレームスキップ型マルチスレッド版）
    
    Args:
        camera_id: カメラID
        bucket_name: S3バケット名
    
    Note:
        設定変更時はAPIがECSタスクを停止し、サービスが自動的に再起動する。
        起動時にDynamoDBから最新設定を読み込むため、ポーリングは不要。
    """
    # ThreadPoolExecutorを関数内で作成（再試行ループでも新規作成される）
    image_save_executor = ThreadPoolExecutor(max_workers=3, thread_name_prefix='ImageSave')
    detector_executor = ThreadPoolExecutor(max_workers=5, thread_name_prefix='Detector')
    
    # フレーム処理キュー（maxsize=1で最新フレームのみ保持）
    processing_queue = Queue(maxsize=1)
    
    # ワーカースレッド統計情報
    worker_stats = {'processed_frames': 0}
    
    # YOLOワーカースレッド（Noneで初期化、後で設定）
    yolo_worker_thread = None
    
    # フレームカウンター
    frame_count = 0
    skipped_frame_count = 0
    
    try:
        # 管理オブジェクト初期化
        manager = TrackingManager(camera_id, 'hlsYolo')
        
        # AWS クライアントの初期化
        s3 = get_s3_client()
        dynamodb = get_dynamodb_resource()
        
        # カメラ情報の取得
        camera_info = get_camera_info(camera_id)
        if not camera_info:
            logger.error(f"エラー: カメラID '{camera_id}' が見つかりません")
            return
        
        log_camera_info(camera_info)

        # HLSコネクターを作成してURLを取得
        try:
            connector = HlsConnectorFactory.create_from_info(camera_info, logger)
            hls_url, av_options = connector.get_hls_url()
        except ValueError as e:
            logger.error(f"コネクター作成エラー: {e}")
            return
        except Exception as e:
            logger.error(f"HLS URL取得エラー: {e}")
            return

        # YOLO Detector初期化
        logger.info("YOLO Detectorを初期化しています...")
        tracker = YoloDetector(model_path=manager.model_path)
        logger.info("YOLO Detectorの初期化が完了しました")

        # EventBridge Publisher初期化
        event_bus_name = os.environ.get('EVENT_BUS_NAME', 'default')
        event_publisher = EventBridgePublisher(
            create_boto3_session, 
            collector_type='hlsYolo',
            event_bus_name=event_bus_name
        )
        logger.info(f"EventBridgePublisher初期化完了: collector_type=hlsYolo, event_bus={event_bus_name}")

        # YOLOワーカースレッドを起動
        logger.info("🚀 YOLOワーカースレッドを起動しています...")
        yolo_worker_thread = threading.Thread(
            target=yolo_processing_worker,
            args=(
                processing_queue,
                tracker,
                manager,
                s3,
                dynamodb,
                bucket_name,
                camera_id,
                image_save_executor,
                detector_executor,
                event_publisher,
                worker_stats
            ),
            daemon=True,
            name='YOLOWorker'
        )
        yolo_worker_thread.start()
        logger.info("✅ YOLOワーカースレッドが起動しました")

        # HLS再接続ループ（ストリーム終了時は再接続、エラー時は外側に投げる）
        container = None
        hls_reconnect_count = 0
        
        while True:
            try:
                # HLS URLを取得（再取得が必要なコネクターの場合は毎回新しいURLを取得）
                if connector.needs_url_refresh:
                    try:
                        hls_url, av_options = connector.refresh_url()
                    except Exception as e:
                        logger.error(f"HLS URL再取得エラー: {e}")
                        raise
                
                # pyavによりHLSストリームを開く
                logger.info(f"📡 HLS接続開始（再接続回数: {hls_reconnect_count}）")
                container = av.open(hls_url, options=av_options)
                video_stream = container.streams.video[0]
                
                # ストリーム情報を表示
                logger.info(f"入力ストリーム情報:")
                logger.info(f"  - 解像度: {video_stream.width}x{video_stream.height}")
                logger.info(f"  - フレームレート: {video_stream.average_rate}")
                logger.info(f"  - コーデック: {video_stream.codec_context.name}")

                image_width = video_stream.width
                image_height = video_stream.height
                
                # 開始時刻を記録（FPS計算用）
                start_time = time.time()
                fps_frame_count = 0  # FPS計算用の別カウンター

                # 入力ストリーム内のフレームを取得
                logger.info("📹 HLSストリームのフレーム取得ループを開始します...")
                for frame in container.decode(video=0):
                    frame_count += 1
                    
                    current_time = now_utc()
                    current_time_ms = int(time.time() * 1000)
                    
                    # トラッキング実行タイミング判定（毎フレーム実行）
                    should_track = manager.should_do_tracking(current_time_ms)
                    
                    if should_track and manager.capture_track_interval_ms > 0:
                        # フレームをRGB形式のnumpy arrayで取得（BGR変換しない）
                        frame_rgb = frame.to_ndarray(format='rgb24')
                        
                        # キューが満杯なら古いフレームを破棄（フレームスキップ）
                        if processing_queue.full():
                            try:
                                old_frame = processing_queue.get_nowait()
                                skipped_frame_count += 1
                                logger.debug(f"⏭️  フレームスキップ: {old_frame['current_time']}")
                            except Empty:
                                pass
                        
                        # 最新フレームをキューに投入
                        frame_data = {
                            'frame_rgb': frame_rgb.copy(),  # コピーして安全に渡す
                            'current_time': current_time,
                            'current_time_ms': current_time_ms,
                            'image_width': image_width,
                            'image_height': image_height
                        }
                        processing_queue.put(frame_data)
                        
                        # トラック時刻を更新（ワーカーの完了を待たない）
                        manager.update_track_time(current_time_ms)
                    
                    # capture.jpeg更新（10分間隔）
                    if manager.should_update_capture_jpeg(current_time):
                        capture_and_save_capture_jpeg(
                            frame, current_time, camera_id, bucket_name, s3, dynamodb
                        )
                        manager.update_capture_jpeg_time(current_time)
                    
                    fps_frame_count += 1
                    if fps_frame_count % 100 == 0:
                        elapsed = time.time() - start_time
                        fps = fps_frame_count / elapsed if elapsed > 0 else 0
                        processed = worker_stats.get('processed_frames', 0)
                        logger.info(f"📊 取得フレーム数: {fps_frame_count}, 取得FPS: {fps:.2f}, 処理済み: {processed}, スキップ: {skipped_frame_count}")

                # ループが正常終了した場合（ストリーム終了）
                logger.warning(f"⚠️  HLSストリームのフレーム取得ループが終了しました（取得フレーム数: {fps_frame_count}）")
                
                # コンテナをクリーンアップ
                if container:
                    try:
                        container.close()
                        logger.info("✅ AVコンテナをクローズしました")
                    except Exception as e:
                        logger.warning(f"⚠️  AVコンテナのクローズに失敗: {e}")
                
                # 1秒待機後にHLS再接続
                hls_reconnect_count += 1
                logger.info("🔄 1秒待機後、HLSストリームを再接続します...")
                time.sleep(1)  # nosemgrep: arbitrary-sleep - 意図的な待機（HLS再接続間隔）
                # while Trueループの先頭に戻る（HLS再接続）
                
            except Exception as e:
                # その他のエラー（外側に投げる）
                logger.error(f"フレーム処理中にエラーが発生しました: {e}", exc_info=True)
                raise

    except Exception as e:
        logger.error(f"エラーが発生しました: {e}")
        logger.error(f"エラーの詳細: {str(e)}")
        raise
    finally:
        # YOLOワーカースレッドを停止
        logger.info("🛑 YOLOワーカースレッドをシャットダウン中...")
        try:
            # 終了シグナルを送信
            processing_queue.put(None)
            
            # ワーカースレッドの終了を待機（最大5秒）
            if yolo_worker_thread and yolo_worker_thread.is_alive():
                yolo_worker_thread.join(timeout=5.0)
                if yolo_worker_thread.is_alive():
                    logger.warning("⚠️  YOLOワーカースレッドがタイムアウトしました")
                else:
                    logger.info("✅ YOLOワーカースレッド シャットダウン完了")
        except Exception as e:
            logger.error(f"❌ YOLOワーカースレッド シャットダウンエラー: {e}")
        
        # ThreadPoolExecutorのクリーンアップ
        logger.info("ThreadPoolExecutorをシャットダウン中...")
        try:
            image_save_executor.shutdown(wait=True)
            logger.info("image_save_executor シャットダウン完了")
        except Exception as e:
            logger.error(f"image_save_executor シャットダウンエラー: {e}")
        
        try:
            detector_executor.shutdown(wait=True)
            logger.info("detector_executor シャットダウン完了")
        except Exception as e:
            logger.error(f"detector_executor シャットダウンエラー: {e}")


def upload_annotated_image(s3, bucket_name: str, s3_key: str, frame, is_bgr: bool = False) -> bool:
    """
    画像をS3にアップロード
    
    Args:
        s3: S3クライアント
        bucket_name: バケット名
        s3_key: S3キー
        frame: pyav.VideoFrame または numpy array (RGB or BGR)
        is_bgr: True の場合、BGRとして扱う（アノテーション画像用）
        
    Returns:
        成功したかどうか
    """
    try:
        # pyav.VideoFrameの場合はPIL Imageに変換
        if hasattr(frame, 'to_image'):
            img = frame.to_image()
        else:
            # numpy arrayの場合
            if is_bgr:
                # BGR → RGB 変換
                img_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                img = Image.fromarray(img_rgb)
            else:
                # RGB形式 → そのまま PIL に変換
                img = Image.fromarray(frame)
        
        # JPEGに変換
        img_byte_arr = io.BytesIO()
        img.save(img_byte_arr, format='JPEG', quality=95)
        img_bytes = img_byte_arr.getvalue()
        
        # S3アップロード
        return upload_to_s3_with_retry(s3, bucket_name, s3_key, img_bytes)
        
    except Exception as e:
        logger.error(f"画像アップロードエラー: {e}")
        return False


def save_image_async(
    s3, dynamodb, bucket_name: str, camera_id: str, 
    manager, frame, annotated_frame,
    current_time, detections, filtered_detections,
    image_width: int, image_height: int,
    detector_executor,
    event_publisher,
    should_fire_event: bool = False,
    save_reason: str = 'detector'
):
    """
    画像保存を非同期で実行（疎結合: detector を知らない）
    
    Args:
        s3: S3クライアント
        dynamodb: DynamoDBクライアント
        bucket_name: S3バケット名
        camera_id: カメラID
        manager: TrackingManagerインスタンス
        frame: 元画像フレーム
        annotated_frame: アノテーション付き画像フレーム
        current_time: 現在時刻
        save_reason: 保存理由 ('detector' or 'periodic')
        detections: 全検出結果
        filtered_detections: フィルター済み検出結果
        image_width: 画像幅
        image_height: 画像高さ
        detector_executor: detector実行用のThreadPoolExecutor（未使用、互換性のため残す）
        event_publisher: EventBridgePublisherインスタンス
        should_fire_event: イベントを発火すべきか（bool）
    """
    try:
        # S3パス生成（元画像）- collector_id を使用
        s3_key_orig, s3path_orig = generate_s3_path(
            camera_id, manager.collector_id, 'image', 
            current_time, bucket_name, 'jpeg'
        )
        
        # S3パス生成（アノテーション画像）- collector_id を使用
        s3_key_detect, s3path_detect = generate_s3_path(
            camera_id, manager.collector_id, 'image_detect', 
            current_time, bucket_name, 'jpeg'
        )
        
        # 元画像をS3にアップロード（RGB形式）
        if not upload_annotated_image(s3, bucket_name, s3_key_orig, frame, is_bgr=False):
            logger.error(f"元画像のアップロードに失敗: {s3path_orig}")
            return
        
        logger.info(f"元画像をS3にアップロード: {s3path_orig}")
        
        # アノテーション画像をS3にアップロード（BGR形式）
        if not upload_annotated_image(s3, bucket_name, s3_key_detect, annotated_frame, is_bgr=True):
            logger.error(f"アノテーション画像のアップロードに失敗: {s3path_detect}")
            return
        
        logger.info(f"アノテーション画像をS3にアップロード: {s3path_detect}")
        
        # FILE_TABLE に保存
        file_id = insert_file_record(
            dynamodb, camera_id, current_time, current_time,
            s3path_orig, manager.collector_id, 'image',
            s3path_detect=s3path_detect
        )
        
        if not file_id:
            logger.error(f"ファイルレコードの保存に失敗")
            return
        
        logger.info(f"ファイルレコード保存: {file_id}")
        
        # TRACK_LOG_TABLE に保存
        area_track_ids = manager.previous_area_track_ids if manager.track_eventtype == 'area_detect' else None
        # area_detectの場合、entered_ids と exited_ids を渡す
        entered_ids = set(manager.intrusion_ids) if manager.track_eventtype == 'area_detect' else None
        exited_ids = set(manager.exit_ids) if manager.track_eventtype == 'area_detect' else None
        
        track_log_id, track_data = save_track_log(
            dynamodb, camera_id, manager.collector_id,
            current_time, detections, filtered_detections,
            file_id, image_width, image_height,
            area_track_ids, manager.detect_area_polygon,
            entered_ids, exited_ids
        )
        
        logger.info(f"トラックログ保存: {track_log_id}")
        
        # EventBridgeイベントを発行（疎結合: 1回のみ、detector_id なし）
        if should_fire_event:
            if manager.track_eventtype == 'class_detect':
                # 1. ClassDetectEvent を発行
                if not filtered_detections:
                    logger.info("[ClassDetectEvent] filtered_detections が空のため、イベント発行をスキップ")
                else:
                    logger.info(f"【⭐️⭐️⭐️ EventBridge発行: ClassDetectEvent ⭐️⭐️⭐️】collector_id={manager.collector_id}")
                    event_publisher.publish_class_detect_event(
                        camera_id=camera_id,
                        collector_id=manager.collector_id,
                        file_id=file_id,
                        s3path=s3path_orig,
                        s3path_detect=s3path_detect,
                        track_log_id=track_log_id,
                        detections=detections,
                        filtered_detections=filtered_detections,
                        image_width=image_width,
                        image_height=image_height,
                        timestamp=current_time
                    )
            
            elif manager.track_eventtype == 'area_detect':
                # 2. AreaDetectEvent を発行
                intrusion_ids = manager.intrusion_ids
                exit_ids = manager.exit_ids
                
                # エリア変化がない場合はイベント発行しない
                has_area_change = bool(intrusion_ids or exit_ids or manager.area_event_triggered)
                
                if not has_area_change:
                    logger.info("[AreaDetectEvent] エリア変化がないため、イベント発行をスキップ")
                else:
                    # エリアポリゴンを座標リストに変換
                    area_polygon = None
                    if manager.detect_area_polygon and SHAPELY_AVAILABLE:
                        try:
                            coords = list(manager.detect_area_polygon.exterior.coords)
                            area_polygon = [[int(x), int(y)] for x, y in coords[:-1]]
                        except Exception as e:
                            logger.warning(f"エリアポリゴン座標の取得エラー: {e}")
                    
                    logger.info(f"【⭐️⭐️⭐️ EventBridge発行: AreaDetectEvent ⭐️⭐️⭐️】collector_id={manager.collector_id}, method={manager.area_detect_method}, intrusion_count={manager.intrusion_count}, exit_count={manager.exit_count}")
                    event_publisher.publish_area_detect_event(
                        camera_id=camera_id,
                        collector_id=manager.collector_id,
                        file_id=file_id,
                        s3path=s3path_orig,
                        s3path_detect=s3path_detect,
                        track_log_id=track_log_id,
                        time=track_data['time'],
                        track_alldata=track_data['track_alldata'],
                        track_classdata=track_data['track_classdata'],
                        area_in_data=track_data['area_in_data'],
                        area_out_data=track_data['area_out_data'],
                        area_in_count=track_data['area_in_count'],
                        area_out_count=track_data['area_out_count'],
                        intrusion_ids=intrusion_ids,
                        exit_ids=exit_ids,
                        area_polygon=area_polygon,
                        image_width=image_width,
                        image_height=image_height,
                        timestamp=current_time,
                        area_detect_method=manager.area_detect_method,
                        intrusion_count=manager.intrusion_count,
                        exit_count=manager.exit_count
                    )
                    
                    # イベント発行後にフラグをリセット
                    manager.area_event_triggered = False
        
        # detect-log 保存（仮想 Detector を使用）
        if should_fire_event and manager.virtual_detector_id:
            # file_data を構築（insert_file_record と同じ情報）
            file_data = {
                'file_id': file_id,
                'camera_id': camera_id,
                'collector_id': manager.collector_id,
                'file_type': 'image',
                's3path': s3path_orig,
                's3path_detect': s3path_detect,
                'start_time': format_for_db(current_time),
                'end_time': format_for_db(current_time)
            }
            # NOTE: insert_file_record は file_id のみ返却するため、ここで file_data を構築している
            #       将来的に insert_file_record が file_data 全体を返すように変更すれば、この重複は解消できる
            
            if manager.track_eventtype == 'class_detect':
                # ClassDetect の detect-log 保存
                if filtered_detections:
                    # 検出情報を構築（共通関数使用）
                    detections_data = build_class_detect_data(detections, filtered_detections)
                    
                    detect_log_result = save_class_detect_log(
                        detector_id=manager.virtual_detector_id,
                        file_data=file_data,
                        detections=detections_data,
                        track_log_id=track_log_id,
                        s3path_detect=s3path_detect
                    )
                    if detect_log_result:
                        logger.info(f"detect-log 保存完了 (class_detect): {detect_log_result.get('detect_log_id')}")
                    else:
                        logger.warning("detect-log 保存に失敗しました (class_detect)")
            
            elif manager.track_eventtype == 'area_detect':
                # AreaDetect の detect-log 保存
                intrusion_ids = manager.intrusion_ids
                exit_ids = manager.exit_ids
                intrusion_count = manager.intrusion_count
                exit_count = manager.exit_count
                
                # 変化があるかどうかの判定（IDs または Count で判定）
                has_area_change = bool(intrusion_ids or exit_ids or intrusion_count > 0 or exit_count > 0 or manager.area_event_triggered)
                
                if has_area_change:
                    # area_event を構築
                    # event_type は IDs または Count で判定（class_count_change モードでは IDs は空）
                    event_type = 'no_change'
                    has_intrusion = bool(intrusion_ids) or intrusion_count > 0
                    has_exit = bool(exit_ids) or exit_count > 0
                    
                    if has_intrusion and has_exit:
                        event_type = 'both'
                    elif has_intrusion:
                        event_type = 'intrusion'
                    elif has_exit:
                        event_type = 'exit'
                    
                    logger.info(f"detect-log 保存準備: event_type={event_type}, intrusion_count={intrusion_count}, exit_count={exit_count}, intrusion_ids={intrusion_ids}, exit_ids={exit_ids}")
                    
                    area_event = {
                        'type': event_type,
                        'intrusion_ids': list(intrusion_ids) if intrusion_ids else [],
                        'exit_ids': list(exit_ids) if exit_ids else [],
                        'intrusion_count': intrusion_count,
                        'exit_count': exit_count
                    }
                    
                    detect_log_result = save_area_detect_log(
                        detector_id=manager.virtual_detector_id,
                        file_data=file_data,
                        area_event=area_event,
                        area_in_data=track_data['area_in_data'],
                        area_out_data=track_data['area_out_data'],
                        area_in_count=track_data['area_in_count'],
                        area_out_count=track_data['area_out_count'],
                        area_detect_method=manager.area_detect_method,
                        track_log_id=track_log_id,
                        s3path_detect=s3path_detect
                    )
                    if detect_log_result:
                        logger.info(f"detect-log 保存完了 (area_detect): {detect_log_result.get('detect_log_id')}")
                    else:
                        logger.warning("detect-log 保存に失敗しました (area_detect)")
        
    except Exception as e:
        logger.error(f"画像保存処理でエラー: {e}", exc_info=True)


def capture_and_save_capture_jpeg(frame, current_time, camera_id, bucket_name, s3, dynamodb):
    """
    capture.jpegを更新
    
    Args:
        frame: キャプチャするフレーム
        current_time: 現在時刻
        camera_id: カメラID
        bucket_name: S3バケット名
        s3: S3クライアント
        dynamodb: DynamoDBリソース
    """
    try:
        # pyav.VideoFrameの場合はPIL Imageに変換
        if hasattr(frame, 'to_image'):
            img = frame.to_image()
        else:
            # numpy arrayの場合
            img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        
        img_byte_arr = io.BytesIO()
        img.save(img_byte_arr, format='JPEG')
        img_byte_arr = img_byte_arr.getvalue()

        s3_key = f"collect/{camera_id}/capture.jpg"
        s3path = f"s3://{bucket_name}/{s3_key}"

        upload_to_s3_with_retry(s3, bucket_name, s3_key, img_byte_arr)
        logger.info(f"capture.jpegを更新しました: {s3path}")

        # DynamoDBのcapture列を更新
        update_camera_capture_image(dynamodb, camera_id, s3path)
        
    except Exception as e:
        logger.error(f"capture.jpeg保存エラー: {e}")


@click.command()
@click.option("--camera_id", type=str, required=True, envvar="CAMERA_ID", help="カメラID")
@click.option("--bucket_name", type=str, required=True, envvar="BUCKET_NAME", help="S3バケット名")
def streaming(camera_id: str, bucket_name: str) -> None:
    """
    HLSストリーム（Kinesis Video StreamsまたはVSaaS）から
    YOLO11+BoT-SORTでトラッキングを行い、イベント発生時に結果をS3とDynamoDBに保存します

    \b
    - DynamoDBからカメラ情報とコレクター設定を取得
    - HLS URLを取得してストリーミング処理を実行
    - YOLO11でオブジェクト検出、BoT-SORTでトラッキング
    - イベント発生時のみ画像保存とトラック記録を実行
    - 設定変更時はAPIがECSタスクを停止し、サービスが自動的に再起動
    - エラー発生時は再試行（再接続対応）
    """
    # エラーが発生しても再試行を繰り返す無限ループ
    # 設定変更時はAPIがECSタスクを停止し、サービスが自動的にタスクを再起動する
    while True:
        try:
            logger.info(f"HLS+YOLOトラッキング処理（イベント駆動版）を開始します: カメラID={camera_id}")
            process_hls_stream_with_tracking(camera_id, bucket_name)
            # ✅ process_hls_stream_with_tracking内でHLS再接続ループが動いているため、
            # ここに到達するのは例外発生時のみ
            logger.warning("⚠️  process_hls_stream_with_tracking が予期せず正常終了しました")
            time.sleep(1)  # nosemgrep: arbitrary-sleep - 意図的な待機（再試行間隔）
        except Exception as e:
            logger.error(f"エラーが発生しました: {e}")
            logger.info(f"{RETRY_WAIT_SEC}秒待機後、処理を再試行します...")
            time.sleep(RETRY_WAIT_SEC)


if __name__ == "__main__":
    streaming()
