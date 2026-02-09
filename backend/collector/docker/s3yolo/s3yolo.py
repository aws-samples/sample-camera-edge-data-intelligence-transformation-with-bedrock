"""
S3 + YOLO 物体検出コレクター（Lambda関数）

S3に画像が保存されたタイミングでYOLO検出を実行し、
class_detectイベントを発行します。

Note:
    - 画像ファイルのみ対応（.jpg, .jpeg, .png）
    - class_detectのみ（area_detectは継続トラッキングが必要なため非対応）
    - 仮想Detectorを初回実行時に作成
"""

import boto3
import os
import json
from datetime import datetime, timezone
from botocore.exceptions import ClientError
import sys
import logging
import io
import numpy as np
from PIL import Image, ImageDraw, ImageFont

# shared.commonから共通関数をインポート
from shared.common import *
from shared.eventbridge_publisher import EventBridgePublisher
from shared.yolo_detector import YoloDetector, filter_detections_by_class, build_class_detect_data
from shared.detect_log_helper import (
    get_or_create_collector_internal_detector,
    get_collector_internal_detector_id,
    save_class_detect_log
)

# 環境変数の取得とエラーハンドリング
CAMERA_ID = os.environ.get('CAMERA_ID')
if not CAMERA_ID:
    print("ERROR: CAMERA_ID環境変数が設定されていません。")
    sys.exit(1)

COLLECTOR_ID = os.environ.get('COLLECTOR_ID')
if not COLLECTOR_ID:
    print("ERROR: COLLECTOR_ID環境変数が設定されていません。")
    sys.exit(1)

BUCKET_NAME = os.environ.get('BUCKET_NAME')
if not BUCKET_NAME:
    print("ERROR: BUCKET_NAME環境変数が設定されていません。")
    sys.exit(1)

# Initialize AWS clients
dynamodb = get_dynamodb_resource()
s3_client = get_s3_client()

# ロガーの設定
logger = setup_logger('s3Yolo')

# グローバル変数（Lambda warm start時に再利用）
_yolo_detector = None
_collector_settings = None
_virtual_detector_id = None


def get_yolo_detector(model_path: str = 'v9-s') -> YoloDetector:
    """
    YoloDetectorを取得（シングルトン、Lambda warm start対応）
    """
    global _yolo_detector
    if _yolo_detector is None:
        logger.info(f"YoloDetectorを初期化: model_path={model_path}")
        _yolo_detector = YoloDetector(model_path=model_path)
        logger.info("YoloDetector初期化完了")
    return _yolo_detector


def get_collector_settings() -> dict:
    """
    コレクター設定を取得（キャッシュ）
    """
    global _collector_settings
    if _collector_settings is None:
        from shared.database import get_collector_by_id
        _collector_settings = get_collector_by_id(COLLECTOR_ID)
        if not _collector_settings:
            raise ValueError(f"Collector not found: {COLLECTOR_ID}")
        logger.info(f"コレクター設定を取得: {_collector_settings}")
    return _collector_settings


def ensure_virtual_detector(camera_id: str, collector_mode: str) -> str:
    """
    仮想Detectorを取得/作成し、detector_idを返す
    """
    global _virtual_detector_id
    if _virtual_detector_id is None:
        virtual_detector = get_or_create_collector_internal_detector(
            collector_id=COLLECTOR_ID,
            camera_id=camera_id,
            event_type='class_detect',  # s3yoloは常にclass_detect
            collector_mode=collector_mode
        )
        if virtual_detector:
            _virtual_detector_id = virtual_detector['detector_id']
            logger.info(f"仮想Detector取得完了: detector_id={_virtual_detector_id}")
        else:
            _virtual_detector_id = get_collector_internal_detector_id(COLLECTOR_ID)
            logger.warning(f"仮想Detectorの取得/作成に失敗。detector_id={_virtual_detector_id}を使用")
    return _virtual_detector_id


def load_image_from_s3(source_bucket: str, source_key: str) -> tuple:
    """
    S3から画像を読み込み、numpy arrayとPIL Imageで返す
    
    Args:
        source_bucket: ソースS3バケット名
        source_key: ソースS3オブジェクトキー
        
    Returns:
        tuple: (image_rgb: np.ndarray, image_pil: PIL.Image, image_bytes: bytes)
    """
    try:
        # S3から画像データを取得
        response = s3_client.get_object(Bucket=source_bucket, Key=source_key)
        image_bytes = response['Body'].read()
        
        if len(image_bytes) == 0:
            raise ValueError(f"画像が空です: {source_key}")
        
        # PIL Imageに変換
        image_pil = Image.open(io.BytesIO(image_bytes))
        
        # RGB形式に変換（RGBA, Lなど他の形式の場合）
        if image_pil.mode != 'RGB':
            image_pil = image_pil.convert('RGB')
        
        # numpy array (RGB) に変換
        image_rgb = np.array(image_pil)
        
        logger.info(f"画像読み込み完了: {source_key}, サイズ={image_rgb.shape}")
        
        return image_rgb, image_pil, image_bytes
        
    except ClientError as e:
        logger.error(f"S3画像の取得に失敗: {e}")
        raise
    except Exception as e:
        logger.error(f"画像の読み込みに失敗: {e}")
        raise


def create_annotated_image(image_rgb: np.ndarray, filtered_detections: list) -> Image.Image:
    """
    検出結果をアノテーションした画像を作成
    
    Args:
        image_rgb: 元画像（RGB形式）
        filtered_detections: フィルタ後の検出結果
        
    Returns:
        アノテーション済み画像（PIL Image）
    """
    # numpy配列からPIL Imageに変換
    image_pil = Image.fromarray(image_rgb)
    draw = ImageDraw.Draw(image_pil)
    
    # デフォルトフォント（Lambda環境用）
    try:
        font = ImageFont.truetype("/usr/share/fonts/dejavu/DejaVuSans.ttf", 14)
    except (IOError, OSError):
        font = ImageFont.load_default()
    
    for det in filtered_detections:
        x1, y1, x2, y2 = [int(v) for v in det['bbox']]
        class_name = det['class']
        confidence = det['confidence']
        
        # ボックス描画（緑色）
        color = (0, 255, 0)
        draw.rectangle([x1, y1, x2, y2], outline=color, width=2)
        
        # ラベル描画
        label = f"{class_name} {confidence:.2f}"
        # テキストサイズを取得
        bbox = draw.textbbox((0, 0), label, font=font)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]
        
        # ラベル背景
        draw.rectangle([x1, y1 - text_height - 5, x1 + text_width + 4, y1], fill=color)
        # ラベルテキスト
        draw.text((x1 + 2, y1 - text_height - 3), label, fill=(255, 255, 255), font=font)
    
    return image_pil


def save_images_to_s3(
    image_rgb: np.ndarray,
    annotated_pil: Image.Image,
    camera_id: str,
    collector_id: str,
    timestamp: datetime
) -> tuple:
    """
    元画像とアノテーション画像をS3に保存
    
    Returns:
        tuple: (s3path_orig, s3path_detect, s3_key_orig, s3_key_detect)
    """
    # 元画像のS3パス生成
    s3_key_orig, s3path_orig = generate_s3_path(
        camera_id, collector_id, 'image',
        timestamp, BUCKET_NAME, 'jpeg'
    )
    
    # アノテーション画像のS3パス生成
    s3_key_detect, s3path_detect = generate_s3_path(
        camera_id, collector_id, 'image_detect',
        timestamp, BUCKET_NAME, 'jpeg'
    )
    
    # 元画像をJPEGに変換してアップロード
    image_pil = Image.fromarray(image_rgb)
    img_byte_arr = io.BytesIO()
    image_pil.save(img_byte_arr, format='JPEG', quality=95)
    img_bytes_orig = img_byte_arr.getvalue()
    
    if not upload_to_s3_with_retry(s3_client, BUCKET_NAME, s3_key_orig, img_bytes_orig, 'image/jpeg'):
        raise Exception(f"元画像のS3アップロードに失敗: {s3path_orig}")
    logger.info(f"元画像をS3に保存: {s3path_orig}")
    
    # アノテーション画像をJPEGに変換してアップロード
    annotated_byte_arr = io.BytesIO()
    annotated_pil.save(annotated_byte_arr, format='JPEG', quality=95)
    annotated_bytes = annotated_byte_arr.getvalue()
    
    if not upload_to_s3_with_retry(s3_client, BUCKET_NAME, s3_key_detect, annotated_bytes, 'image/jpeg'):
        raise Exception(f"アノテーション画像のS3アップロードに失敗: {s3path_detect}")
    logger.info(f"アノテーション画像をS3に保存: {s3path_detect}")
    
    return s3path_orig, s3path_detect, s3_key_orig, s3_key_detect


def process_s3_image(source_bucket: str, source_key: str, event_time: str, event_publisher=None):
    """
    S3画像を処理してYOLO検出を実行
    
    Args:
        source_bucket: ソースS3バケット名
        source_key: ソースS3オブジェクトキー
        event_time: イベント発生時刻
        event_publisher: EventBridgePublisher（オプション）
        
    Returns:
        処理結果の辞書
    """
    try:
        # カメラ情報を取得
        camera_info = get_camera_info(CAMERA_ID)
        if not camera_info:
            logger.error(f"カメラ情報が見つかりません: {CAMERA_ID}")
            return {'statusCode': 400, 'error': f'カメラ情報が見つかりません: {CAMERA_ID}'}

        # カメラタイプを検証（s3タイプをサポート）
        if camera_info.get('type') != 's3':
            logger.error(f"サポートされていないカメラタイプ: {camera_info.get('type')}")
            return {'statusCode': 400, 'error': f'サポートされていないカメラタイプ: {camera_info.get("type")}'}

        logger.info(f"カメラ情報取得: {CAMERA_ID} (type: {camera_info.get('type')})")

        # イベント時刻をdatetimeに変換
        if isinstance(event_time, str):
            timestamp = datetime.fromisoformat(event_time.replace('Z', '+00:00'))
        elif isinstance(event_time, datetime):
            timestamp = event_time
        else:
            from shared.timezone_utils import now_utc
            timestamp = now_utc()
        
        logger.info(f"イベント時刻: {timestamp}")

        # コレクター設定を取得
        settings = get_collector_settings()
        
        # 設定値を取得（カンマまたは|区切り）
        collect_class_str = settings.get('collect_class', 'person')
        import re
        collect_classes = [c.strip() for c in re.split(r'[,|]', collect_class_str) if c.strip()]
        confidence_threshold = float(settings.get('confidence', 0.5))
        model_path = settings.get('model_path', 'v9-s')
        collector_mode = settings.get('collector_mode', 'image')
        
        logger.info(f"検出設定: collect_classes={collect_classes}, confidence={confidence_threshold}, model={model_path}")

        # 仮想Detectorを取得/作成
        detector_id = ensure_virtual_detector(CAMERA_ID, collector_mode)
        
        # YoloDetectorを取得
        detector = get_yolo_detector(model_path)
        
        # S3から画像を読み込み
        image_rgb, image_pil, image_bytes = load_image_from_s3(source_bucket, source_key)
        image_height, image_width = image_rgb.shape[:2]
        
        # captureフィールドの確認と初回画像保存処理
        capture_path = camera_info.get('capture')
        if not capture_path:
            logger.info(f"カメラ {CAMERA_ID} のcaptureが未設定のため、初回キャプチャ画像を保存")
            try:
                s3_key_capture = f"collect/{CAMERA_ID}/capture.jpg"
                s3path_capture = f"s3://{BUCKET_NAME}/{s3_key_capture}"
                
                # 元画像をcaptureとして保存
                img_byte_arr = io.BytesIO()
                image_pil.save(img_byte_arr, format='JPEG', quality=95)
                capture_bytes = img_byte_arr.getvalue()
                
                if upload_to_s3_with_retry(s3_client, BUCKET_NAME, s3_key_capture, capture_bytes, 'image/jpeg'):
                    logger.info(f"初回キャプチャ画像を保存: {s3path_capture}")
                    if update_camera_capture_image(dynamodb, CAMERA_ID, s3path_capture):
                        logger.info(f"DynamoDBのcaptureフィールドを更新: {CAMERA_ID}")
            except Exception as e:
                logger.error(f"初回キャプチャ画像の保存エラー: {e}")
        
        # YOLO検出実行
        logger.info("YOLO検出を実行中...")
        detections = detector.detect(image_rgb)
        logger.info(f"YOLO検出完了: {len(detections)}個の検出")
        
        # クラス+信頼度でフィルタリング
        filtered_detections = filter_detections_by_class(
            detections, collect_classes, confidence_threshold
        )
        logger.info(f"フィルタ後: {len(filtered_detections)}個の検出")
        
        # 検出がない場合は早期リターン
        if not filtered_detections:
            logger.info("フィルタ後の検出がないため、処理をスキップ")
            return {
                'statusCode': 200,
                'message': '検出なし',
                'detection_count': 0,
                'source_path': f"s3://{source_bucket}/{source_key}"
            }
        
        # アノテーション画像を作成
        annotated_bgr = create_annotated_image(image_rgb, filtered_detections)
        
        # 画像をS3に保存
        s3path_orig, s3path_detect, _, _ = save_images_to_s3(
            image_rgb, annotated_bgr, CAMERA_ID, COLLECTOR_ID, timestamp
        )
        
        # FILE_TABLEにレコードを挿入
        file_id = insert_file_record(
            dynamodb, CAMERA_ID, timestamp, timestamp,
            s3path_orig, COLLECTOR_ID, 'image',
            s3path_detect=s3path_detect
        )
        
        if not file_id:
            logger.error("ファイルレコードの保存に失敗")
            return {'statusCode': 500, 'error': 'ファイルレコードの保存に失敗'}
        
        logger.info(f"ファイルレコード保存: file_id={file_id}")
        
        # detect-log保存用のデータを構築
        detections_data = build_class_detect_data(detections, filtered_detections)
        
        # file_dataを構築
        file_data = {
            'file_id': file_id,
            'camera_id': CAMERA_ID,
            'collector_id': COLLECTOR_ID,
            'file_type': 'image',
            's3path': s3path_orig,
            's3path_detect': s3path_detect,
            'start_time': format_for_db(timestamp),
            'end_time': format_for_db(timestamp)
        }
        
        # detect-log保存
        detect_log_result = save_class_detect_log(
            detector_id=detector_id,
            file_data=file_data,
            detections=detections_data,
            track_log_id=None,  # s3yoloではtrack_logなし
            s3path_detect=s3path_detect
        )
        
        if detect_log_result:
            logger.info(f"detect-log保存完了: detect_log_id={detect_log_result.get('detect_log_id')}")
        else:
            logger.warning("detect-log保存に失敗")
        
        # EventBridge ClassDetectEvent発行
        if event_publisher and filtered_detections:
            try:
                logger.info(f"ClassDetectEvent発行: collector_id={COLLECTOR_ID}")
                event_publisher.publish_class_detect_event(
                    camera_id=CAMERA_ID,
                    collector_id=COLLECTOR_ID,
                    file_id=file_id,
                    s3path=s3path_orig,
                    s3path_detect=s3path_detect,
                    track_log_id=None,
                    detections=detections,
                    filtered_detections=filtered_detections,
                    image_width=image_width,
                    image_height=image_height,
                    timestamp=timestamp
                )
                logger.info("ClassDetectEvent発行完了")
            except Exception as e:
                logger.error(f"EventBridge発行エラー: {e}")
        
        return {
            'statusCode': 200,
            'message': 'YOLO検出処理が正常に完了しました',
            'file_id': file_id,
            's3path': s3path_orig,
            's3path_detect': s3path_detect,
            'detection_count': len(filtered_detections),
            'source_path': f"s3://{source_bucket}/{source_key}"
        }
        
    except Exception as e:
        logger.error(f"画像処理中にエラーが発生: {e}")
        import traceback
        logger.error(f"詳細: {traceback.format_exc()}")
        return {'statusCode': 500, 'error': f'処理中にエラーが発生: {str(e)}'}


def lambda_handler(event, context):
    """
    Lambda関数のメインハンドラー
    S3イベントを受け取り、YOLO検出を実行する
    """
    logger.info(f"Lambda関数が開始されました")
    logger.info(f"環境変数 - CAMERA_ID: {CAMERA_ID}, COLLECTOR_ID: {COLLECTOR_ID}, BUCKET_NAME: {BUCKET_NAME}")
    logger.info(f"受信イベント: {json.dumps(event, default=str, ensure_ascii=False)}")

    # EventBridgePublisherを初期化
    event_publisher = None
    try:
        event_publisher = EventBridgePublisher(
            create_boto3_session_func=create_boto3_session,
            collector_type='s3Yolo',
            event_bus_name=os.environ.get('EVENT_BUS_NAME', 'default')
        )
        logger.info(f"EventBridgePublisher初期化完了: collector_type=s3Yolo")
    except Exception as e:
        logger.warning(f"EventBridgePublisher初期化に失敗（処理は継続）: {e}")
        event_publisher = None

    try:
        # EventBridgeからのS3イベントを解析
        if 'detail' in event and 'bucket' in event['detail'] and 'object' in event['detail']:
            # EventBridge経由のS3イベント
            detail = event['detail']
            source_bucket = detail['bucket']['name']
            source_key = detail['object']['key']
            event_time = event.get('time', format_for_db(now_utc()))
            
            logger.info(f"EventBridge S3イベント:")
            logger.info(f"  Bucket: {source_bucket}")
            logger.info(f"  Key: {source_key}")
            logger.info(f"  EventTime: {event_time}")
            
        elif 'Records' in event:
            # 直接のS3イベント（テスト用）
            if len(event['Records']) == 0:
                return {'statusCode': 400, 'body': json.dumps({'error': 'レコードが空です'})}
            
            record = event['Records'][0]
            if 's3' not in record:
                return {'statusCode': 400, 'body': json.dumps({'error': 'S3イベントではありません'})}
            
            s3_info = record['s3']
            source_bucket = s3_info['bucket']['name']
            source_key = s3_info['object']['key']
            event_time = record.get('eventTime', format_for_db(now_utc()))
            
            logger.info(f"直接S3イベント:")
            logger.info(f"  Bucket: {source_bucket}")
            logger.info(f"  Key: {source_key}")
            logger.info(f"  EventTime: {event_time}")
            
        else:
            # テスト用のマニュアルイベント
            source_bucket = event.get('source_bucket', 'test-bucket')
            source_key = event.get('source_key', 'test/file.jpg')
            event_time = event.get('event_time', format_for_db(now_utc()))
            
            logger.info(f"テストイベント:")
            logger.info(f"  Bucket: {source_bucket}")
            logger.info(f"  Key: {source_key}")
            logger.info(f"  EventTime: {event_time}")

        # 画像ファイルのみ処理
        key_lower = source_key.lower()
        if not (key_lower.endswith('.jpg') or key_lower.endswith('.jpeg') or key_lower.endswith('.png')):
            logger.info(f"画像ファイルではないためスキップ: {source_key}")
            return {
                'statusCode': 200,
                'body': json.dumps({'message': '画像ファイルではないためスキップ'}, ensure_ascii=False)
            }

        # YOLO検出処理を実行
        result = process_s3_image(source_bucket, source_key, event_time, event_publisher)
        
        logger.info(f"処理結果: {result}")
        
        return {
            'statusCode': result['statusCode'],
            'body': json.dumps(result, ensure_ascii=False)
        }

    except Exception as e:
        logger.error(f"Lambda関数でエラーが発生: {e}")
        import traceback
        logger.error(f"詳細: {traceback.format_exc()}")
        return {
            'statusCode': 500,
            'body': json.dumps({'error': f'Lambda関数でエラーが発生: {str(e)}'}, ensure_ascii=False)
        }


# ローカルテスト用
if __name__ == "__main__":
    test_event = {
        "source_bucket": "test-source-bucket",
        "source_key": "endpoint/test-camera/sample.jpg",
        "event_time": format_for_db(now_utc())
    }
    
    result = lambda_handler(test_event, None)
    print(f"テスト結果: {json.dumps(result, indent=2, ensure_ascii=False)}")
