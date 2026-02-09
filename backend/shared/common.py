#!/usr/bin/env python3
"""
Cedix システム用の共通ライブラリ

このモジュールは以下の機能を提供します:
- DynamoDBとの連携（カメラ情報、ファイル情報の管理）
- S3への画像・動画アップロード
- Kinesis Video Streamsとの連携
- ログ設定
- 各種ユーティリティ関数

各コレクター（hlsRec、hlsYolo、s3Rec）で使用される共通の機能を提供します：
- AWS クライアント作成
- DynamoDB操作
- S3操作
- ロギング設定
- タイムゾーン設定
- ファイルレコード管理
- コレクター設定の動的取得

注意
このプログラムは
../hlsrecimage/hlsrecimage.py
../getkvsimage/getkvsimage.py
../getkvsclip/getkvsclip.py
で利用されています。

各コレクターで使用される共通の機能を提供します：
- AWS クライアント作成
- DynamoDB操作
- S3操作
- ロギング設定
- タイムゾーン設定
- ファイルレコード管理
"""

import os
import boto3
import logging
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from botocore.exceptions import ClientError, EndpointConnectionError
from typing import Optional, Dict, Any, List

# タイムゾーン設定（新ユーティリティを使用）
from .timezone_config import UTC, DISPLAY_TIMEZONE, JST
from .timezone_utils import (
    now_utc, now_utc_str, format_for_db, format_for_display,
    parse_display_str, parse_db_str, parse_any_str, db_str_to_display_str
)

# AWS_REGION環境変数の取得とエラーハンドリング
REGION = os.environ.get('AWS_REGION')
if not REGION:
    print("ERROR: AWS_REGION環境変数が設定されていません。")
    print("正しいAWSリージョンを設定してください。")
    sys.exit(1)

# DynamoDBテーブル名定数
PLACE_TABLE = "cedix-place"
CAMERA_TABLE = "cedix-camera"
FILE_TABLE = "cedix-file"
CAMERA_COLLECTOR_TABLE = "cedix-collector"
TAG_CATEGORY_TABLE = "cedix-tag-category"
TAG_TABLE = "cedix-tag"
TRACK_LOG_TABLE = "cedix-track-log"
TEST_MOVIE_TABLE = "cedix-test-movie"
BOOKMARK_TABLE = "cedix-bookmark"
BOOKMARK_DETAIL_TABLE = "cedix-bookmark-detail"

# 検出関連のDynamoDBテーブル名
DETECTOR_TABLE = "cedix-detector"
DETECT_LOG_TABLE = "cedix-detect-log"
DETECT_LOG_TAG_TABLE = "cedix-detect-log-tag"
DETECT_TAG_TIMESERIES_TABLE = "cedix-detect-tag-timeseries"


# リトライ設定
RETRY_WAIT_SEC = 5  # エラー発生時の再試行までの待機時間（秒）

def setup_logger(name: str, level: int = logging.INFO) -> logging.Logger:
    """
    ロガーを設定します（Lambda環境対応）
    
    Args:
        name: ロガー名
        level: ログレベル
        
    Returns:
        設定されたロガー
    """
    logger = logging.getLogger(name)
    
    # 既存のハンドラーをクリア（Lambda環境対策）
    if logger.handlers:
        logger.handlers.clear()
    
    # ハンドラーを明示的に追加
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    )
    logger.addHandler(handler)
    logger.setLevel(level)
    
    # 親ロガーへの伝播を防ぐ（重複出力を防止）
    logger.propagate = False
    
    return logger


def create_boto3_session(access_key: Optional[str] = None, secret_access_key: Optional[str] = None, region_name: Optional[str] = None) -> boto3.Session:
    """
    boto3セッションを作成します
    
    Args:
        access_key: AWSアクセスキー（オプション）
        secret_access_key: AWSシークレットアクセスキー（オプション）
        region_name: AWSリージョン（オプション、指定がない場合はREGION環境変数を使用）
        
    Returns:
        boto3.Sessionオブジェクト
    """
    session_params = {'region_name': region_name or REGION}
    
    if access_key and secret_access_key:
        session_params.update({
            'aws_access_key_id': access_key,
            'aws_secret_access_key': secret_access_key
        })
    
    print(f"create_boto3_session session_params: {session_params}")

    return boto3.Session(**session_params)

def get_s3_client(signature_version: Optional[str] = None) -> boto3.client:
    """
    S3クライアントを作成します
    
    Args:
        signature_version: 署名バージョン（オプション。指定時のみConfigを適用）
        
    Returns:
        boto3.client: S3クライアント
    """
    from botocore.client import Config
    session = create_boto3_session()
    
    # リージョン付きエンドポイントを使用（CORSのため）
    # bucket.s3.region.amazonaws.com 形式のURLを生成
    region = REGION
    endpoint_url = f"https://s3.{region}.amazonaws.com"
    
    config_params = {'s3': {'addressing_style': 'virtual'}}
    if signature_version:
        config_params['signature_version'] = signature_version
    
    return session.client('s3', endpoint_url=endpoint_url, config=Config(**config_params))

def get_dynamodb_resource() -> boto3.resource:
    """
    DynamoDBリソースを作成します
    
    Returns:
        boto3.resource: DynamoDBリソース
    """
    session = create_boto3_session()
    return session.resource('dynamodb')

def get_kinesis_video_client(camera_info: Optional[Dict[str, Any]] = None) -> boto3.client:
    """Kinesis Video Streamsのクライアントを作成"""
    access_key = None
    secret_key = None
    region_name = None
    
    # カメラ情報からAWSキーとリージョンを取得
    if camera_info and camera_info.get('type') == 'kinesis':
        access_key = (camera_info.get('aws_access_key') or '').strip()
        secret_key = (camera_info.get('aws_secret_access_key') or '').strip()
        region_name = (camera_info.get('aws_region') or '').strip()
        
        # アクセスキーとシークレットキーは両方設定されている場合のみ使用
        if not (access_key and secret_key):
            access_key = None
            secret_key = None
        
        # リージョンは単独でも使用可能
        if not region_name:
            region_name = None
    
    session = create_boto3_session(access_key, secret_key, region_name)
    return session.client('kinesisvideo')

def get_sts_client() -> boto3.client:
    """
    STSクライアントを作成します
    
    Returns:
        boto3.client: STSクライアント
    """
    session = create_boto3_session()
    return session.client('sts')

def get_stepfunctions_client() -> boto3.client:
    """
    Step Functionsクライアントを作成します
    
    Returns:
        boto3.client: Step Functionsクライアント
    """
    session = create_boto3_session()
    return session.client('stepfunctions')

def get_data_endpoint(stream_arn: str, api_name: str, camera_info: Optional[Dict[str, Any]] = None) -> str:
    """
    データエンドポイントを取得
    
    Args:
        stream_arn: ストリームARN
        api_name: API名 ('GET_IMAGES', 'GET_HLS_STREAMING_SESSION_URL')
        camera_info: カメラ情報（AWSキー取得用）
        
    Returns:
        データエンドポイントURL
    """
    client = get_kinesis_video_client(camera_info)
    response = client.get_data_endpoint(
        StreamARN=stream_arn,
        APIName=api_name
    )
    return response['DataEndpoint']

def get_camera_info(camera_id: str) -> Optional[Dict[str, Any]]:
    """
    カメラ情報をDynamoDBから取得
    
    Args:
        camera_id: カメラID
        
    Returns:
        カメラ情報の辞書、見つからない場合はNone
    """
    logger = logging.getLogger(__name__)
    session = create_boto3_session()
    dynamodb = session.resource('dynamodb')
    camera_table = dynamodb.Table(CAMERA_TABLE)
    
    try:
        response = camera_table.get_item(
            Key={'camera_id': camera_id}
        )
        
        if 'Item' not in response:
            logger.error(f"カメラが見つかりません: {camera_id}")
            return None
        
        return response['Item']
    except Exception as e:
        logger.error(f"カメラ情報の取得中にエラーが発生しました: {e}")
        return None

def upload_to_s3_with_retry(
    s3_client: boto3.client,
    bucket: str,
    key: str,
    body: bytes,
    content_type: str = 'image/jpeg',
    max_retries: int = 3
) -> bool:
    """
    S3への画像アップロードをリトライ機能付きで実行
    
    Args:
        s3_client: S3クライアント
        bucket: バケット名
        key: S3キー
        body: アップロードするデータ
        content_type: コンテンツタイプ
        max_retries: 最大リトライ回数
        
    Returns:
        成功した場合True
    """
    logger = logging.getLogger(__name__)
    
    for attempt in range(max_retries):
        try:
            s3_client.put_object(
                Bucket=bucket,
                Key=key,
                Body=body,
                ContentType=content_type
            )
            return True
        except (ClientError, EndpointConnectionError) as e:
            if attempt < max_retries - 1:
                wait_time = 2 ** attempt  # 指数バックオフ
                logger.warning(f"S3アップロード失敗 (試行 {attempt + 1}/{max_retries}): {e}")
                logger.info(f"  {wait_time}秒後に再試行します...")
                time.sleep(wait_time)
            else:
                logger.error(f"S3アップロードが{max_retries}回失敗しました: {e}")
                raise
        except Exception as e:
            # SSL/TLS関連エラーもリトライ対象に含める
            if "SSL" in str(e) or "TLS" in str(e) or "connection" in str(e).lower():
                if attempt < max_retries - 1:
                    wait_time = 2 ** attempt  # 指数バックオフ
                    logger.warning(f"S3接続エラー (試行 {attempt + 1}/{max_retries}): {e}")
                    logger.info(f"  {wait_time}秒後に再試行します...")
                    time.sleep(wait_time)
                else:
                    logger.error(f"S3接続エラーが{max_retries}回失敗しました: {e}")
                    raise
            else:
                # その他の予期しないエラーはすぐに諦める
                logger.error(f"予期しないエラーでS3アップロード失敗: {e}")
                raise
    
    return False

def insert_file_record(
    dynamodb: boto3.resource,
    camera_id: str,
    start_time: datetime,
    end_time: datetime,
    s3path: str,
    collector_id: str,
    file_type: str,
    s3path_detect: Optional[str] = None
) -> Optional[str]:
    """
    DynamoDBにファイルレコードを挿入
    
    Args:
        dynamodb: DynamoDBリソース
        camera_id: カメラID
        start_time: 開始時刻
        end_time: 終了時刻
        s3path: S3パス（元画像/動画）
        collector_id: コレクターID (UUID)
        file_type: ファイルタイプ ('image', 'video')
        s3path_detect: S3パス（アノテーション画像/動画）
        
    Returns:
        ファイルID、失敗した場合はNone
    """
    logger = logging.getLogger(__name__)
    file_table = dynamodb.Table(FILE_TABLE)
    file_id = f"file-{uuid.uuid4().hex[:8]}"
    collector_id_file_type = f"{collector_id}|{file_type}"
    
    # ✅ UTC（タイムゾーン情報なし）で保存
    item = {
        'file_id': file_id,
        'start_time': format_for_db(start_time),  # UTC文字列に変換
        'camera_id': camera_id,
        'end_time': format_for_db(end_time),  # UTC文字列に変換
        's3path': s3path,
        'collector_id': collector_id,
        'file_type': file_type,
        'collector_id_file_type': collector_id_file_type
    }
    
    # s3path_detectがある場合は追加
    if s3path_detect:
        item['s3path_detect'] = s3path_detect
    
    try:
        file_table.put_item(Item=item)
        logger.info(f"DynamoDBにファイルレコードを挿入しました: {file_id}")
        return file_id
    except Exception as e:
        logger.error(f"DynamoDBへのファイルレコード挿入中にエラーが発生しました: {e}")
        return None

def update_camera_capture_image(
    dynamodb: boto3.resource,
    camera_id: str,
    s3path: str
) -> bool:
    """
    DynamoDBのカメラテーブルのキャプチャ画像列を更新
    
    Args:
        dynamodb: DynamoDBリソース
        camera_id: カメラID
        s3path: S3パス
        
    Returns:
        成功した場合True
    """
    logger = logging.getLogger(__name__)
    camera_table = dynamodb.Table(CAMERA_TABLE)
    
    try:
        camera_table.update_item(
            Key={'camera_id': camera_id},
            UpdateExpression='SET capture = :val1',
            ExpressionAttributeValues={':val1': s3path}
        )
        logger.info(f"DynamoDBのcapture列を更新しました: {s3path}")
        return True
    except Exception as e:
        logger.error(f"DynamoDB更新中にエラーが発生しました: {e}")
        return False

def generate_s3_path(camera_id: str, collector_id: str, file_type: str, timestamp: datetime, bucket_name: str, file_extension: str = 'jpg') -> tuple[str, str]:
    """
    S3パスを生成（collector_id ベース）

    Args:
        camera_id: カメラID
        collector_id: コレクターID (UUID)
        file_type: ファイルタイプ（'image' または 'video'）
        timestamp: タイムスタンプ
        bucket_name: S3バケット名  
        file_extension: ファイル拡張子
        
    Returns:
        (S3キー, S3パス)のタプル
    """
    dt = timestamp.astimezone(JST)
    
    if file_type == 'video':
        # 動画の場合: collect/camera_id/collector_id/video/YYYYMMDD/HHMM/video.{拡張子}
        s3_key = f"collect/{camera_id}/{collector_id}/{file_type}/{dt.strftime('%Y%m%d')}/{dt.strftime('%H%M')}/video.{file_extension}"
    else:
        # 画像の場合: collect/camera_id/collector_id/image/YYYYMMDD/HHMM/image_{秒}.{拡張子}
        s3_key = f"collect/{camera_id}/{collector_id}/{file_type}/{dt.strftime('%Y%m%d')}/{dt.strftime('%H%M')}/image_{dt.strftime('%S')}.{file_extension}"
    
    s3path = f"s3://{bucket_name}/{s3_key}"
    return s3_key, s3path

def should_use_eventbridge(collector_id: str) -> bool:
    """
    指定されたcollector_idのコレクターがEventBridgeを使用すべきかを判定
    
    Args:
        collector_id: コレクターID (UUID)
    
    Returns:
        bool: EventBridgeを使用すべき場合True
        
    Note:
        - hlsYolo: False（コレクター自身がイベント発火）
        - その他: True（S3イベント駆動）
    """
    from shared.database import get_collector_by_id
    
    collector_info = get_collector_by_id(collector_id)
    if not collector_info:
        # コレクターが見つからない場合はFalse（安全側）
        logger = logging.getLogger(__name__)
        logger.warning(f"Collector not found for collector_id={collector_id}")
        return False
    
    collector_name = collector_info.get('collector')
    
    # コレクター自身がイベントを発火するタイプ（EventBridge不要）
    INTERNAL_EVENT_COLLECTORS = ['hlsYolo']
    
    return collector_name not in INTERNAL_EVENT_COLLECTORS

def validate_camera_type(camera_info: Dict[str, Any], expected_type: str = 'kinesis') -> bool:
    """
    カメラタイプを検証
    
    Args:
        camera_info: カメラ情報
        expected_type: 期待するカメラタイプ
        
    Returns:
        有効な場合True
    """
    logger = logging.getLogger(__name__)
    
    if camera_info['type'] != expected_type:
        logger.error(f"サポートされていないカメラタイプです: {camera_info['type']}")
        return False
    
    if expected_type == 'kinesis':
        stream_arn = camera_info.get('kinesis_streamarn')
        if not stream_arn:
            logger.error("KinesisストリームARNが設定されていません")
            return False
    
    return True

def log_camera_info(camera_info: Dict[str, Any]) -> None:
    """
    カメラ情報をログ出力
    
    Args:
        camera_info: カメラ情報
    """
    logger = logging.getLogger(__name__)
    logger.info(f"カメラ情報:")
    logger.info(f"  - 名前: {camera_info.get('name', 'N/A')}")
    logger.info(f"  - タイプ: {camera_info.get('type', 'N/A')}")
    logger.info(f"  - 場所ID: {camera_info.get('place_id', 'N/A')}")
    
    if camera_info.get('type') == 'kinesis':
        logger.info(f"  - KinesisストリームARN: {camera_info.get('kinesis_streamarn', 'N/A')}")

def create_kinesis_archived_media_client(endpoint: str, camera_info: Optional[Dict[str, Any]] = None) -> boto3.client:
    """
    Kinesis Video Archived Media クライアントを作成
    
    Args:
        endpoint: エンドポイントURL
        camera_info: カメラ情報（AWSキーとリージョン取得用）
        
    Returns:
        Kinesis Video Archived Media クライアント
    """
    access_key = None
    secret_key = None
    region_name = None
    
    # カメラ情報からAWSキーとリージョンを取得
    if camera_info and camera_info.get('type') == 'kinesis':
        access_key = (camera_info.get('aws_access_key') or '').strip()
        secret_key = (camera_info.get('aws_secret_access_key') or '').strip()
        region_name = (camera_info.get('aws_region') or '').strip()
        
        # アクセスキーとシークレットキーは両方設定されている場合のみ使用
        if not (access_key and secret_key):
            access_key = None
            secret_key = None
        
        # リージョンは単独でも使用可能
        if not region_name:
            region_name = None
    
    session = create_boto3_session(access_key, secret_key, region_name)
    return session.client(
        'kinesis-video-archived-media',
        endpoint_url=endpoint
    )

def format_time_jst(dt: datetime) -> str:
    """
    日時をJST（表示用タイムゾーン）フォーマットで文字列に変換
    
    Args:
        dt: 日時オブジェクト
        
    Returns:
        フォーマットされた文字列（JST）
        
    Note:
        この関数はtimezone_utils.format_for_displayのエイリアスです
    """
    return format_for_display(dt)

def parse_s3_path(s3path: str) -> tuple[str, str]:
    """
    S3パスからバケット名とキーを抽出
    
    Args:
        s3path: S3パス (s3://bucket/key 形式)
        
    Returns:
        (バケット名, キー)のタプル
    """
    if s3path.startswith('s3://'):
        s3path = s3path[5:]
    bucket, key = s3path.split('/', 1)
    return bucket, key

def get_file_data(s3_key: str, bucket_name: str) -> Optional[Dict[str, Any]]:
    """
    S3キーから FILE_TABLE_NAME テーブルのファイルデータを取得
    
    Args:
        s3_key: S3キー (例: "collect/cam-001/hlsRec/image/20241201/1430/image_45.jpg") 
               または完全なS3パス (例: "s3://bucket/key")
        bucket_name: S3バケット名
        
    Returns:
        ファイルデータの辞書、見つからない場合はNone
    """
    logger = logging.getLogger(__name__)
    
    try:
        # s3_keyが既に完全なS3パス形式かチェック
        if s3_key.startswith('s3://'):
            # 完全なS3パスが渡された場合はそのまま使用
            s3path = s3_key
            print(f"s3path (from full path): {s3path}")
        else:
            # キーのみが渡された場合はバケット名と結合
            s3path = f"s3://{bucket_name}/{s3_key}"
            print(f"s3path (constructed): {s3path}")
        
        # DynamoDBクライアントを作成
        session = create_boto3_session()
        dynamodb = session.resource('dynamodb')
        file_table = dynamodb.Table(FILE_TABLE)
        
        # s3path GSI (globalindex2) を使ってクエリ
        response = file_table.query(
            IndexName='globalindex2',
            KeyConditionExpression='s3path = :s3path',
            ExpressionAttributeValues={
                ':s3path': s3path
            }
        )
        
        items = response.get('Items', [])
        
        if not items:
            logger.warning(f"S3パスに対応するファイルデータが見つかりません: {s3path}")
            return None
        
        if len(items) > 1:
            logger.warning(f"複数のファイルレコードが見つかりました。最初のものを返します: {s3path}")
        
        file_data = items[0]
        logger.info(f"ファイルデータを取得しました: file_id={file_data.get('file_id')}")
        return file_data
        
    except Exception as e:
        logger.error(f"ファイルデータの取得中にエラーが発生しました: {e}")
        return None

def get_previous_file_data(collector_id: str, file_type: str, start_time: str) -> Optional[Dict[str, Any]]:
    """
    指定されたファイルの1つ前のファイルデータを取得
    
    Args:
        collector_id: コレクターID
        file_type: ファイルタイプ ('image', 'video')
        start_time: 現在のファイルの開始時刻
        
    Returns:
        1つ前のファイルデータの辞書、見つからない場合はNone
    """
    logger = logging.getLogger(__name__)
    
    try:
        # DynamoDBクライアントを作成
        session = create_boto3_session()
        dynamodb = session.resource('dynamodb')
        file_table = dynamodb.Table(FILE_TABLE)
        
        # 検索キーを構築
        collector_id_file_type = f"{collector_id}|{file_type}"
        
        # GSI-1で現在のstart_timeより前のデータを逆順で取得
        response = file_table.query(
            IndexName='globalindex1',  # GSI-1
            KeyConditionExpression='collector_id_file_type = :key AND start_time < :current_time',
            ExpressionAttributeValues={
                ':key': collector_id_file_type,
                ':current_time': start_time
            },
            ScanIndexForward=False,  # 逆順（新しい順）
            Limit=1  # 1件のみ取得
        )
        
        items = response.get('Items', [])
        
        if not items:
            logger.info(f"前のファイルデータが見つかりません: {collector_id_file_type}, start_time < {start_time}")
            return None
        
        previous_file_data = items[0]
        logger.info(f"前のファイルデータを取得しました: file_id={previous_file_data.get('file_id')}, start_time={previous_file_data.get('start_time')}")
        return previous_file_data
        
    except Exception as e:
        logger.error(f"前のファイルデータの取得中にエラーが発生しました: {e}")
        return None

def get_detector_settings(collector_id: str, file_type: str, detector: str) -> Optional[Dict[str, Any]]:
    """
    DynamoDBからDetector設定を取得
    
    Args:
        collector_id: コレクターID
        file_type: ファイルタイプ
        detector: 検出器名 ('bedrock', 'yolo', 'nova' など)
        
    Returns:
        Detector設定の辞書、見つからない場合はNone
    """
    logger = logging.getLogger(__name__)
    
    try:
        session = create_boto3_session()
        dynamodb = session.resource('dynamodb')
        detector_table = dynamodb.Table(DETECTOR_TABLE)
        
        # collector_id_file_typeでクエリ
        collector_id_file_type = f"{collector_id}|{file_type}"
        
        response = detector_table.query(
            IndexName='globalindex1',
            KeyConditionExpression='collector_id_file_type = :cft',
            ExpressionAttributeValues={
                ':cft': collector_id_file_type
            }
        )
        
        items = response.get('Items', [])   
        
        # Filter by detector
        matching_items = [item for item in items if item.get('detector') == detector]
        
        if not matching_items:
            logger.error(f"Detector設定が見つかりません: collector_id={collector_id}, file_type={file_type}, detector={detector}")
            return None
        
        # 最初の項目を返す（キーが一意なので1件のはず）
        item = matching_items[0]
        logger.info(f"Detector設定を取得しました: {item['detector_id']}")
        return item
        
    except Exception as e:
        logger.error(f"Detector設定の取得中にエラーが発生しました: {e}")
        return None

def save_detect_log(
    detector_id: str,
    detect_result: str,
    detect_notify: bool,
    detect_notify_reason: str,
    detect_tags: List[str],
    file_data: Dict[str, Any],
    detector: str,
    track_log_id: Optional[str] = None,
    s3path_detect: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """
    検出結果をDynamoDBに保存
    
    Args:
        detector_id: 検出器ID
        detect_result: 検出結果の詳細
        detect_notify: 通知フラグ
        detect_notify_reason: 通知理由
        detect_tags: 検出タグのリスト
        file_data: FILE_TABLE テーブルのファイルデータ
        detector: 検出器名 ('bedrock', 'yolo', 'nova' など)
        track_log_id: トラックログID（hlsYoloから呼ばれた場合）
        s3path_detect: 検出結果画像のS3パス（オプション）
        
    Returns:
        成功時は保存したデータ、失敗時はNone
    """
    logger = logging.getLogger(__name__)
    
    try:
        session = create_boto3_session()
        dynamodb = session.resource('dynamodb')
        detect_log_table = dynamodb.Table(DETECT_LOG_TABLE)
        
        # file_dataから必要な情報を取得
        file_id = file_data.get('file_id')
        s3path = file_data.get('s3path')
        camera_id = file_data.get('camera_id')
        collector_id = file_data.get('collector_id')
        file_type = file_data.get('file_type')
        start_time = file_data.get('start_time')
        end_time = file_data.get('end_time')
        
        if not all([file_id, s3path, camera_id, collector_id, file_type, start_time]):
            logger.error("file_dataに必要な情報が不足しています")
            return None
        
        # Get collector name from collector_id for logging
        from .database import get_collector_by_id
        collector_obj = get_collector_by_id(collector_id)
        collector = collector_obj.get('collector', 'unknown') if collector_obj else 'unknown'
        
        # カメラ情報を取得
        camera_info = get_camera_info(camera_id)
        
        # 場所情報を取得
        place_id = camera_info.get('place_id', 'unknown') if camera_info else 'unknown'
        camera_name = camera_info.get('name', 'unknown') if camera_info else 'unknown'
        
        # 場所名を取得
        place_name = 'unknown'
        if place_id != 'unknown':
            try:
                place_table = dynamodb.Table(PLACE_TABLE)
                place_response = place_table.get_item(Key={'place_id': place_id})
                if 'Item' in place_response:
                    place_name = place_response['Item'].get('name', 'unknown')
            except:
                pass
        
        # end_timeがない場合はstart_timeと同じにする（画像ファイルの場合など）
        if not end_time:
            end_time = start_time
        
        # ✅ start_time/end_timeを確実にUTC文字列に統一
        # file_dataから取得した時刻は、UTC（新データ）またはJST（旧データ）の可能性がある
        # parse_any_strで柔軟にパースし、format_for_dbでUTCに統一
        start_time_utc = format_for_db(parse_any_str(start_time))
        end_time_utc = format_for_db(parse_any_str(end_time))
        
        # ログID生成
        detect_log_id = f"log-{uuid.uuid4().hex[:8]}"
        
        # タグをセット形式に変換（空の場合は空のリストで保存）
        if detect_tags:
            # タグがある場合はセット形式で保存
            detect_tag = set(detect_tags)
        else:
            # タグが空の場合は空のリストで保存
            detect_tag = []
        
        # 結合キー
        collector_id_file_type = f"{collector_id}|{file_type}"
        collector_id_detector_id = f"{collector_id}|{detector_id}"  # GSI-5用
        
        # 通知フラグを文字列に変換
        notify_flg = 'true' if detect_notify else 'false'
        
        # DynamoDBアイテム
        item = {
            'detect_log_id': detect_log_id,
            'detector_id': detector_id,
            'file_id': file_id,
            's3path': s3path,
            'collector': collector,  # ログ情報として残す
            'collector_id': collector_id,  # 新設計: collector_idを追加
            'start_time': start_time_utc,  # ✅ UTC文字列
            'end_time': end_time_utc,  # ✅ UTC文字列
            'detect_result': detect_result,
            'detect_tag': detect_tag,
            'detect_notify_flg': notify_flg,
            'detect_notify_reason': detect_notify_reason,
            'place_id': place_id,
            'place_name': place_name,
            'camera_id': camera_id,
            'camera_name': camera_name,
            'file_type': file_type,
            'detector': detector,
            'collector_id_file_type': collector_id_file_type,
            'collector_id_detector_id': collector_id_detector_id,  # GSI-5用
        }
        
        # オプショナルフィールドを追加
        if track_log_id:
            item['track_log_id'] = track_log_id
        
        if s3path_detect:
            item['s3path_detect'] = s3path_detect
        
        # DynamoDBに保存
        detect_log_table.put_item(Item=item)
        logger.info(f"検出ログを保存しました: {detect_log_id}")
        
        # タグテーブルに一意のタグを保存（3パターン: TAG, PLACE|{place_id}, CAMERA|{camera_id}）
        if detect_tags:
            detect_tag_table = dynamodb.Table(DETECT_LOG_TAG_TABLE)
            for tag in detect_tags:
                # (1) 全体タグ（data_type = "TAG"）
                try:
                    detect_tag_table.put_item(
                        Item={'data_type': 'TAG', 'detect_tag_name': tag},
                        ConditionExpression='attribute_not_exists(data_type) AND attribute_not_exists(detect_tag_name)'
                    )
                    logger.info(f"新しいタグを保存しました (TAG): {tag}")
                except ClientError as e:
                    if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
                        logger.debug(f"タグは既に存在します (TAG): {tag}")
                    else:
                        logger.warning(f"タグ保存エラー (TAG): {tag}, エラー: {e}")
                except Exception as e:
                    logger.warning(f"タグ保存エラー (TAG): {tag}, エラー: {e}")
                
                # (2) 場所別タグ（data_type = "PLACE|{place_id}"）
                if place_id and place_id != 'unknown':
                    try:
                        detect_tag_table.put_item(
                            Item={'data_type': f'PLACE|{place_id}', 'detect_tag_name': tag},
                            ConditionExpression='attribute_not_exists(data_type) AND attribute_not_exists(detect_tag_name)'
                        )
                        logger.info(f"新しいタグを保存しました (PLACE|{place_id}): {tag}")
                    except ClientError as e:
                        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
                            logger.debug(f"タグは既に存在します (PLACE|{place_id}): {tag}")
                        else:
                            logger.warning(f"タグ保存エラー (PLACE|{place_id}): {tag}, エラー: {e}")
                    except Exception as e:
                        logger.warning(f"タグ保存エラー (PLACE|{place_id}): {tag}, エラー: {e}")
                
                # (3) カメラ別タグ（data_type = "CAMERA|{camera_id}"）
                if camera_id:
                    try:
                        detect_tag_table.put_item(
                            Item={'data_type': f'CAMERA|{camera_id}', 'detect_tag_name': tag},
                            ConditionExpression='attribute_not_exists(data_type) AND attribute_not_exists(detect_tag_name)'
                        )
                        logger.info(f"新しいタグを保存しました (CAMERA|{camera_id}): {tag}")
                    except ClientError as e:
                        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
                            logger.debug(f"タグは既に存在します (CAMERA|{camera_id}): {tag}")
                        else:
                            logger.warning(f"タグ保存エラー (CAMERA|{camera_id}): {tag}, エラー: {e}")
                    except Exception as e:
                        logger.warning(f"タグ保存エラー (CAMERA|{camera_id}): {tag}, エラー: {e}")
        
        return item
        
    except Exception as e:
        logger.error(f"検出ログ保存エラー: {e}")
        return None

def save_tag_timeseries(detect_log_data: Dict[str, Any]) -> bool:
    """
    検出結果から時系列データを作成・更新
    
    Args:
        detect_log_data: save_detect_logから返された検出ログデータ
        
    Returns:
        成功時True
    """
    logger = logging.getLogger(__name__)
    
    try:
        from datetime import datetime
        import boto3
        from botocore.exceptions import ClientError
        
        session = create_boto3_session()
        dynamodb = session.resource('dynamodb')
        timeseries_table = dynamodb.Table(DETECT_TAG_TIMESERIES_TABLE)
        
        # detect_log_dataから必要な情報を取得
        start_time_str = detect_log_data.get('start_time')
        detect_tags = detect_log_data.get('detect_tag', [])
        place_id = detect_log_data.get('place_id')
        place_name = detect_log_data.get('place_name')
        camera_id = detect_log_data.get('camera_id')
        camera_name = detect_log_data.get('camera_name')
        
        if not start_time_str:
            logger.error("start_timeが見つかりません")
            return False
            
        # ✅ start_timeをUTC datetimeに変換
        # detect_log_dataのstart_timeは既にUTC文字列（タイムゾーン情報なし）
        current_time = parse_db_str(start_time_str)
        
        # 検出されたタグがない場合は何もしない
        if not detect_tags:
            logger.info("検出されたタグがないため、時系列データの更新をスキップします")
            return True
            
        # detect_tagがsetの場合はlistに変換
        if isinstance(detect_tags, set):
            detect_tags = list(detect_tags)
        
        # 各タグに対して処理
        for tag in detect_tags:
            # ステップ1: 時間範囲とtime_keyを計算
            time_ranges = _calculate_time_ranges(current_time)
            
            # ステップ2: 各粒度・データタイプで更新
            for granularity, time_info in time_ranges.items():
                
                                 # (1) タグごとの時系列
                 _update_timeseries_record(
                     timeseries_table, tag, None, None,
                     time_info['time_key'], time_info['start_time'], time_info['end_time'],
                     granularity, 'TAG'
                 )
                 
                 # (2) 場所＞タグごとの時系列
                 if place_id:
                     place_tag_key = f"{place_id}|{tag}"
                     _update_timeseries_record(
                         timeseries_table, place_tag_key, place_id, None,
                         time_info['time_key'], time_info['start_time'], time_info['end_time'],
                         granularity, 'PLACE'
                     )
                 
                 # (3) カメラ＞タグごとの時系列
                 if camera_id:
                     camera_tag_key = f"{camera_id}|{tag}"
                     _update_timeseries_record(
                         timeseries_table, camera_tag_key, place_id, camera_id,
                         time_info['time_key'], time_info['start_time'], time_info['end_time'],
                         granularity, 'CAMERA'
                     )
        
        logger.info(f"時系列データの更新が完了しました: {len(detect_tags)}個のタグ")
        return True
        
    except Exception as e:
        logger.error(f"時系列データ更新エラー: {e}")
        return False
        
def _calculate_time_ranges(current_time: datetime) -> Dict[str, Dict[str, str]]:
    """
    現在時刻（UTC）から各粒度の時間範囲を計算
    
    Args:
        current_time: 基準となる現在時刻（UTC）
        
    Returns:
        各粒度の時間情報辞書（全てUTC）
        
    Note:
        - time_key, start_time, end_time は全てUTCで計算される
        - DynamoDBにはUTC（タイムゾーン情報なし）で保存される
    """
    from datetime import datetime
    
    # ✅ UTC時刻で計算
    # MINUTE (5分単位)
    minute_start = current_time.replace(minute=(current_time.minute // 5) * 5, second=0, microsecond=0)
    minute_end = minute_start.replace(minute=minute_start.minute + 4, second=59, microsecond=999999)
    
    # HOUR (1時間単位)
    hour_start = current_time.replace(minute=0, second=0, microsecond=0)
    hour_end = hour_start.replace(minute=59, second=59, microsecond=999999)
    
    # DAY (1日単位)
    day_start = current_time.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start.replace(hour=23, minute=59, second=59, microsecond=999999)
    
    # ✅ UTC文字列（タイムゾーン情報なし）で返す
    return {
        'MINUTE': {
            'time_key': f"MINUTE|{format_for_db(minute_start)[:-3]}",  # YYYY-MM-DDTHH:MM
            'start_time': format_for_db(minute_start),
            'end_time': format_for_db(minute_end)
        },
        'HOUR': {
            'time_key': f"HOUR|{format_for_db(hour_start)[:-6]}",  # YYYY-MM-DDTHH
            'start_time': format_for_db(hour_start),
            'end_time': format_for_db(hour_end)
        },
        'DAY': {
            'time_key': f"DAY|{format_for_db(day_start)[:10]}",  # YYYY-MM-DD
            'start_time': format_for_db(day_start),
            'end_time': format_for_db(day_end)
        }
    }

def _update_timeseries_record(
    table, tag_name: str, place_id: str, camera_id: str,
    time_key: str, start_time: str, end_time: str, granularity: str, data_type: str
) -> None:
    """
    時系列レコードをアトミックに更新
    
    Args:
        table: DynamoDBテーブル
        tag_name: タグ名（PKまたは結合キー）
        place_id: 場所ID
        camera_id: カメラID
        time_key: 時間キー（SK）
        start_time: 開始時間
        end_time: 終了時間
        granularity: 粒度
        data_type: データタイプ
    """
    logger = logging.getLogger(__name__)
    
    try:
        # 更新式とその属性値を準備
        update_expression = "ADD #count :inc SET #start_time = :start_time, #end_time = :end_time, #granularity = :granularity, #data_type = :data_type"
        expression_attribute_names = {
            '#count': 'count',
            '#start_time': 'start_time',
            '#end_time': 'end_time',
            '#granularity': 'granularity',
            '#data_type': 'data_type'
        }
        expression_attribute_values = {
            ':inc': 1,
            ':start_time': start_time,
            ':end_time': end_time,
            ':granularity': granularity,
            ':data_type': data_type
        }
        
        # データタイプに応じて追加属性を設定
        if data_type in ['PLACE', 'CAMERA'] and place_id:
            update_expression += ", #place_id = :place_id"
            expression_attribute_names.update({
                '#place_id': 'place_id'
            })
            expression_attribute_values.update({
                ':place_id': place_id
            })
            
        if data_type == 'CAMERA' and camera_id:
            update_expression += ", #camera_id = :camera_id"
            expression_attribute_names.update({
                '#camera_id': 'camera_id'
            })
            expression_attribute_values.update({
                ':camera_id': camera_id
            })
        
        # データタイプに応じてGSI用の結合キーを設定
        if data_type == 'PLACE' and place_id:
            update_expression += ", #place_tag_key = :place_tag_key"
            expression_attribute_names['#place_tag_key'] = 'place_tag_key'
            expression_attribute_values[':place_tag_key'] = f"{place_id}|{tag_name.split('|')[-1] if '|' in tag_name else tag_name}"
            
        elif data_type == 'CAMERA' and camera_id:
            update_expression += ", #camera_tag_key = :camera_tag_key"
            expression_attribute_names['#camera_tag_key'] = 'camera_tag_key'
            expression_attribute_values[':camera_tag_key'] = f"{camera_id}|{tag_name.split('|')[-1] if '|' in tag_name else tag_name}"
        
        # DynamoDBレコードを更新
        table.update_item(
            Key={
                'tag_name': tag_name,
                'time_key': time_key
            },
            UpdateExpression=update_expression,
            ExpressionAttributeNames=expression_attribute_names,
            ExpressionAttributeValues=expression_attribute_values
        )
        
        logger.debug(f"時系列レコード更新成功: {tag_name} | {time_key} | {data_type}")
        
    except Exception as e:
        logger.error(f"時系列レコード更新エラー: {tag_name} | {time_key} | {data_type} - {e}")
        raise

def get_s3_object(bucket: str, key: str) -> Optional[bytes]:
    """
    S3からオブジェクトデータを取得
    
    Args:
        bucket: S3バケット名
        key: S3キー
        
    Returns:
        オブジェクトのバイナリデータ、失敗時はNone
    """
    logger = logging.getLogger(__name__)
    
    try:
        session = create_boto3_session()
        s3_client = session.client('s3')
        response = s3_client.get_object(Bucket=bucket, Key=key)
        data = response['Body'].read()
        logger.info(f"S3オブジェクト取得成功: {len(data)} bytes")
        return data
    except Exception as e:
        logger.error(f"S3オブジェクト取得エラー: {e}")
        return None


# ============================================================================
# CloudFormation モック関数群
# ============================================================================

def is_camera_resource_deploy_enabled() -> bool:
    """
    カメラリソースのデプロイが有効かチェック
    
    環境変数 CAMERA_RESOURCE_DEPLOY が 'on' の場合、デプロイが有効
    デフォルトは 'on'（デプロイ実行）
    
    Returns:
        bool: デプロイが有効な場合True
    """
    return os.environ.get('CAMERA_RESOURCE_DEPLOY', 'on').lower() == 'on'


def is_collection_resource_deploy_enabled() -> bool:
    """
    コレクションリソースのデプロイが有効かチェック
    
    環境変数 COLLECTION_RESOURCE_DEPLOY が 'on' の場合、デプロイが有効
    デフォルトは 'on'（デプロイ実行）
    
    Returns:
        bool: デプロイが有効な場合True
    """
    return os.environ.get('COLLECTION_RESOURCE_DEPLOY', 'on').lower() == 'on'


def is_detector_resource_deploy_enabled() -> bool:
    """
    Detectorリソースのデプロイが有効かチェック
    
    環境変数 DETECTOR_RESOURCE_DEPLOY が 'on' の場合、デプロイが有効
    デフォルトは 'on'（デプロイ実行）
    
    Returns:
        bool: デプロイが有効な場合True
    """
    return os.environ.get('DETECTOR_RESOURCE_DEPLOY', 'on').lower() == 'on'


def is_cloudformation_mock_mode() -> bool:
    """
    CloudFormationがモックモードかチェック（後方互換性のため残存）
    
    環境変数 CLOUDFORMATION_DEPLOY_MODE が 'dev' の場合、モックモードとなる
    デフォルトは 'prod'（実際のCloudFormation実行）
    
    注意: 新しいコードでは is_camera_resource_deploy_enabled() や
         is_collection_resource_deploy_enabled() を使用してください
    
    Returns:
        bool: モックモードの場合True
    """
    mode = os.environ.get('CLOUDFORMATION_DEPLOY_MODE', 'prod').lower()
    return mode == 'dev'


def get_mock_stack_name(prefix: str) -> str:
    """
    モック用のスタック名を生成
    
    Args:
        prefix: スタック名のプレフィックス
        
    Returns:
        str: モック用スタック名
    """
    timestamp = now_utc().strftime('%Y%m%d%H%M%S')
    return f"mock-{prefix}-{timestamp}"


def mock_deploy_cloudformation_template(stack_name: str, template_file: str, parameters: list) -> Optional[str]:
    """
    CloudFormationデプロイのモック
    
    実際のデプロイは行わず、即座に成功を返す
    
    Args:
        stack_name: スタック名
        template_file: テンプレートファイルパス
        parameters: パラメータリスト
        
    Returns:
        str: スタック名（常に成功）
    """
    print("=" * 80)
    print("  [MOCK MODE] CloudFormation デプロイ処理はスキップされます")
    print("=" * 80)
    print(f"[MOCK MODE] Stack name: {stack_name}")
    print(f"[MOCK MODE] Template: {template_file}")
    print(f"[MOCK MODE] Parameters: {len(parameters)} parameters")
    for param in parameters:
        print(f"[MOCK MODE]   - {param.get('ParameterKey')}: {param.get('ParameterValue')}")
    print(f"[MOCK MODE] ✓ デプロイ成功（モック）")
    print("=" * 80)
    return stack_name


def mock_check_stack_completion(stack_name: str) -> tuple:
    """
    スタック完了チェックのモック（即座に成功を返す）
    
    Args:
        stack_name: スタック名
        
    Returns:
        tuple: (status, message) - 常に成功ステータス
    """
    print(f"[MOCK MODE] Stack completion check: {stack_name} -> SUCCESS")
    return ('SUCCESS', f'Mock stack {stack_name} is complete (CREATE_COMPLETE)')


def mock_check_stack_creation(stack_name: str) -> tuple:
    """
    スタック作成チェックのモック
    
    Args:
        stack_name: スタック名
        
    Returns:
        tuple: (status, message) - 常に作成完了ステータス
    """
    print(f"[MOCK MODE] Stack creation check: {stack_name} -> CREATE_COMPLETE")
    return ('CREATE_COMPLETE', f'Mock stack {stack_name} is created')


def mock_delete_cloudformation_stack(stack_name: str) -> Optional[str]:
    """
    CloudFormation削除のモック
    
    実際の削除は行わず、即座に成功を返す
    
    Args:
        stack_name: スタック名
        
    Returns:
        str: スタック名（常に成功）
    """
    print("=" * 80)
    print("  [MOCK MODE] CloudFormation 削除処理はスキップされます")
    print("=" * 80)
    print(f"[MOCK MODE] Stack name: {stack_name}")
    print(f"[MOCK MODE] ✓ 削除成功（モック）")
    print("=" * 80)
    return stack_name


def mock_get_stack_info(stack_name: str) -> Optional[dict]:
    """
    スタック情報取得のモック
    
    Args:
        stack_name: スタック名
        
    Returns:
        dict: モックのスタック情報
    """
    print(f"[MOCK MODE] Get stack info: {stack_name}")
    return {
        'StackName': stack_name,
        'StackStatus': 'CREATE_COMPLETE',
        'CreationTime': now_utc(),
        'Outputs': [
            {'OutputKey': 'MockOutput1', 'OutputValue': 'mock-value-1'},
            {'OutputKey': 'MockOutput2', 'OutputValue': 'mock-value-2'},
            {'OutputKey': 'TaskDefinitionArn', 'OutputValue': f'arn:aws:ecs:ap-northeast-1:123456789012:task-definition/{stack_name}:1'},
            {'OutputKey': 'ServiceName', 'OutputValue': f'{stack_name}-service'}
        ]
    }


# ============================================================================
# CloudFormation 実関数群（モードチェック対応）
# ============================================================================

def check_stack_completion(stack_name: str):
    """CloudFormationスタックの状態をチェック"""
    # モックモードチェック
    if is_cloudformation_mock_mode():
        return mock_check_stack_completion(stack_name)
    
    # create_boto3_session経由でセッション作成
    session = create_boto3_session()
    cloudformation_client = session.client('cloudformation')
    
    try:
        response = cloudformation_client.describe_stacks(StackName=stack_name)
        stack_status = response['Stacks'][0]['StackStatus']
        
        # 完了状態をチェック
        if stack_status.endswith('_COMPLETE'):
            if stack_status in ['CREATE_COMPLETE', 'UPDATE_COMPLETE']:
                return 'SUCCESS', stack_status
            else:
                return 'FAILED', stack_status
        
        # 失敗状態をチェック
        elif stack_status.endswith('_FAILED') or stack_status.endswith('_ROLLBACK_COMPLETE'):
            return 'FAILED', stack_status
        
        # 進行中の場合
        elif stack_status.endswith('_IN_PROGRESS'):
            return 'IN_PROGRESS', stack_status
        
        else:
            return 'UNKNOWN', stack_status
            
    except ClientError as e:
        if 'does not exist' in str(e):
            return 'NOT_FOUND', 'スタックが見つかりません'
        else:
            return 'ERROR', f'スタック状態の取得に失敗: {e}'
    except Exception as e:
        return 'ERROR', f'予期しないエラー: {e}'

def show_stack_outputs(stack_name: str):
    """スタックの出力を表示"""
    session = create_boto3_session()
    cloudformation_client = session.client('cloudformation')
    
    try:
        stack_info = cloudformation_client.describe_stacks(StackName=stack_name)
        outputs = stack_info['Stacks'][0].get('Outputs', [])
        
        print()
        print("📋 スタック出力:")
        if outputs:
            for output in outputs:
                print(f"  {output['OutputKey']}: {output['OutputValue']}")
        else:
            print("  出力はありません")
            
    except Exception as e:
        print(f"⚠️  スタック出力の取得に失敗しました: {e}")

def get_parameter_from_store(parameter_name: str):
    """Parameter Storeからパラメータを取得"""
    try:
        # create_boto3_session経由でセッション作成
        session = create_boto3_session()
        ssm_client = session.client('ssm')
        
        response = ssm_client.get_parameter(Name=parameter_name)
        return response['Parameter']['Value']
    except Exception as e:
        print(f"Error: パラメータ {parameter_name} が取得できませんでした: {e}")
        return None

def get_latest_ecr_image_uri(repository_uri: str):
    """ECRリポジトリから最新のイメージURIを取得
    
    Args:
        repository_uri: ECRリポジトリURI（タグなし）または完全なイメージURI（タグ付き）
        
    Returns:
        str: タグ付きイメージURI、または None（エラー時）
    """
    try:
        # すでにタグ付きURI（CDK Asset Repositoryなど）かチェック
        if ':' in repository_uri.split('/')[-1]:
            # 最後の要素にコロンがある = タグ付き
            print(f"使用するイメージ（タグ付きURI）: {repository_uri}")
            return repository_uri
        
        # タグなしの場合、ECRから最新イメージを取得
        session = create_boto3_session()
        ecr_client = session.client('ecr')
        
        # リポジトリ名を抽出
        repository_name = repository_uri.split('/')[-1]
        
        # 全てのタグ付きイメージを取得
        response = ecr_client.describe_images(
            repositoryName=repository_name,
            filter={'tagStatus': 'TAGGED'}
        )
        
        images = response.get('imageDetails', [])
        if not images:
            print(f"Warning: ECRリポジトリ {repository_name} にタグ付きイメージが見つかりません")
            return None
        
        # latestタグがあるかチェック
        for image in images:
            image_tags = image.get('imageTags', [])
            if 'latest' in image_tags:
                print(f"latestタグを発見しました")
                return f"{repository_uri}:latest"
        
        # latestがない場合、最新のプッシュ日時でソート
        images_sorted = sorted(images, key=lambda x: x['imagePushedAt'], reverse=True)
        
        # 最新イメージのタグを取得
        latest_image = images_sorted[0]
        image_tags = latest_image.get('imageTags', [])
        
        if image_tags:
            latest_tag = image_tags[0]  # 最初のタグを使用
            print(f"最新イメージのタグを使用します: {latest_tag}")
            return f"{repository_uri}:{latest_tag}"
        else:
            print(f"Warning: 最新イメージにタグが付いていません")
            return None
            
    except Exception as e:
        print(f"Error: ECRから最新イメージURIの取得に失敗しました: {e}")
        return None

def get_multiple_parameters(parameter_mapping: dict) -> tuple[dict, list]:
    """
    Parameter Storeから複数のパラメータを一括取得
    
    Args:
        parameter_mapping: {'parameter_name': 'parameter_path'} の辞書
        
    Returns:
        tuple: (取得成功したパラメータの辞書, 取得失敗したパラメータ名のリスト)
    """
    parameter_values = {}
    missing_parameters = []
    
    for param_name, param_path in parameter_mapping.items():
        value = get_parameter_from_store(param_path)
        if value:
            parameter_values[param_name] = value
        else:
            missing_parameters.append(param_name)
    
    return parameter_values, missing_parameters

def deploy_cloudformation_template(stack_name: str, template_file: str, parameters: list, resource_type: str = 'collection') -> Optional[str]:
    """
    CloudFormationテンプレートをデプロイ（作成または更新）
    
    Args:
        stack_name: スタック名
        template_file: テンプレートファイルのパス
        parameters: CloudFormationパラメータのリスト
        resource_type: リソースタイプ ('camera' または 'collection')
        
    Returns:
        成功時はスタック名、失敗時はNone
    """
    # リソースタイプごとのデプロイ制御チェック
    if resource_type == 'camera' and not is_camera_resource_deploy_enabled():
        print(f"⚠️  CAMERA_RESOURCE_DEPLOY=off: カメラリソースのデプロイをスキップします")
        return mock_deploy_cloudformation_template(stack_name, template_file, parameters)
    elif resource_type == 'collection' and not is_collection_resource_deploy_enabled():
        print(f"⚠️  COLLECTION_RESOURCE_DEPLOY=off: コレクションリソースのデプロイをスキップします")
        return mock_deploy_cloudformation_template(stack_name, template_file, parameters)
    
    # 後方互換性: 旧環境変数チェック
    if is_cloudformation_mock_mode():
        print(f"⚠️  CLOUDFORMATION_DEPLOY_MODE=dev: デプロイをスキップします（非推奨：新しい環境変数を使用してください）")
        return mock_deploy_cloudformation_template(stack_name, template_file, parameters)
    
    try:
        session = create_boto3_session()
        cloudformation_client = session.client('cloudformation')
        
        # テンプレートファイルを読み込み
        with open(template_file, 'r') as f:
            template_body = f.read()
        
        # スタックが存在するかチェック
        stack_exists = False
        try:
            cloudformation_client.describe_stacks(StackName=stack_name)
            stack_exists = True
            print(f"既存のスタック '{stack_name}' を更新します...")
        except cloudformation_client.exceptions.ClientError as e:
            if 'does not exist' in str(e):
                print(f"新しいスタック '{stack_name}' を作成します...")
                stack_exists = False
            else:
                raise e
        
        # スタックの作成または更新
        if stack_exists:
            # スタックを更新
            try:
                response = cloudformation_client.update_stack(
                    StackName=stack_name,
                    TemplateBody=template_body,
                    Parameters=parameters,
                    Capabilities=['CAPABILITY_IAM', 'CAPABILITY_AUTO_EXPAND']
                )
                print(f"スタック更新開始: {response['StackId']}")
            except cloudformation_client.exceptions.ClientError as e:
                if 'No updates are to be performed' in str(e):
                    print("スタックに変更がないため、更新をスキップしました。")
                else:
                    raise e
        else:
            # スタックを作成
            response = cloudformation_client.create_stack(
                StackName=stack_name,
                TemplateBody=template_body,
                Parameters=parameters,
                Capabilities=['CAPABILITY_IAM', 'CAPABILITY_AUTO_EXPAND']
            )
            print(f"スタック作成開始: {response['StackId']}")
        
        print("CloudFormationスタックのデプロイを開始しました。")
        return stack_name
        
    except cloudformation_client.exceptions.ClientError as e:
        print(f"CloudFormationエラーが発生しました: {e}")
        return None
    except FileNotFoundError:
        print(f"テンプレートファイルが見つかりません: {template_file}")
        return None
    except Exception as e:
        print(f"予期しないエラーが発生しました: {e}")
        return None

def delete_cloudformation_stack(stack_name: str, resource_type: str = 'collection') -> Optional[str]:
    """
    CloudFormationスタックを削除（実行のみ）
    
    Args:
        stack_name: 削除するスタック名
        resource_type: リソースタイプ ('camera' または 'collection')
        
    Returns:
        削除開始成功時はスタック名、失敗時はNone
    """
    # リソースタイプごとのデプロイ制御チェック
    if resource_type == 'camera' and not is_camera_resource_deploy_enabled():
        print(f"⚠️  CAMERA_RESOURCE_DEPLOY=off: カメラリソースの削除をスキップします")
        return mock_delete_cloudformation_stack(stack_name)
    elif resource_type == 'collection' and not is_collection_resource_deploy_enabled():
        print(f"⚠️  COLLECTION_RESOURCE_DEPLOY=off: コレクションリソースの削除をスキップします")
        return mock_delete_cloudformation_stack(stack_name)
    
    # 後方互換性: 旧環境変数チェック
    mode = os.environ.get('CLOUDFORMATION_DEPLOY_MODE', 'prod')
    is_mock = is_cloudformation_mock_mode()
    print(f"🔍 CloudFormation削除モード確認: CLOUDFORMATION_DEPLOY_MODE={mode}, is_mock={is_mock}")
    
    if is_mock:
        print(f"⚠️  CLOUDFORMATION_DEPLOY_MODE=dev: 削除をスキップします（非推奨：新しい環境変数を使用してください）")
        return mock_delete_cloudformation_stack(stack_name)
    
    try:
        session = create_boto3_session()
        cloudformation_client = session.client('cloudformation')
        
        # スタックが存在するかチェック
        try:
            stack_info = cloudformation_client.describe_stacks(StackName=stack_name)
            stack_status = stack_info['Stacks'][0]['StackStatus']
            print(f"スタック '{stack_name}' を削除します（現在のステータス: {stack_status}）...")
        except cloudformation_client.exceptions.ClientError as e:
            if 'does not exist' in str(e):
                print(f"スタック '{stack_name}' は存在しません。")
                return stack_name  # 存在しないので削除済みとみなす
            else:
                raise e
        
        # 削除中の場合
        if 'DELETE_IN_PROGRESS' in stack_status:
            print(f"スタック '{stack_name}' は既に削除中です。")
            return stack_name
        
        # 削除完了済みの場合
        if 'DELETE_COMPLETE' in stack_status:
            print(f"スタック '{stack_name}' は既に削除されています。")
            return stack_name
        
        # スタック削除を開始
        response = cloudformation_client.delete_stack(StackName=stack_name)
        print(f"スタック削除を開始しました: {stack_name}")
        
        return stack_name
        
    except cloudformation_client.exceptions.ClientError as e:
        print(f"CloudFormationエラーが発生しました: {e}")
        return None
    except Exception as e:
        print(f"予期しないエラーが発生しました: {e}")
        return None

def check_stack_deletion(stack_name: str):
    """
    CloudFormationスタックの削除状態をチェック（単発）
    
    Args:
        stack_name: チェックするスタック名
        
    Returns:
        tuple: (status, message)
        status: 'SUCCESS', 'FAILED', 'IN_PROGRESS', 'NOT_FOUND', 'ERROR'
        message: 詳細メッセージ
    """
    try:
        # create_boto3_session経由でセッション作成
        session = create_boto3_session()
        cloudformation_client = session.client('cloudformation')
        
        try:
            # スタック情報を取得
            stack_info = cloudformation_client.describe_stacks(StackName=stack_name)
            stack_status = stack_info['Stacks'][0]['StackStatus']
            
            if stack_status == 'DELETE_COMPLETE':
                return 'SUCCESS', 'スタックの削除が完了しました'
            elif stack_status == 'DELETE_FAILED':
                return 'FAILED', 'スタックの削除に失敗しました'
            elif 'DELETE_IN_PROGRESS' in stack_status:
                return 'IN_PROGRESS', f'スタック削除中: {stack_status}'
            else:
                return 'UNKNOWN', f'予期しないステータス: {stack_status}'
                
        except cloudformation_client.exceptions.ClientError as e:
            if 'does not exist' in str(e):
                # スタックが存在しない = 削除完了
                return 'SUCCESS', 'スタックは削除されています（存在しません）'
            else:
                return 'ERROR', f'スタック状態の取得に失敗: {e}'
                
    except Exception as e:
        return 'ERROR', f'予期しないエラー: {e}'

def check_stack_creation(stack_name: str):
    """
    CloudFormationスタックの作成/更新状態をチェック（単発）
    
    Args:
        stack_name: チェックするスタック名
        
    Returns:
        tuple: (status, message)
        status: 'SUCCESS', 'FAILED', 'IN_PROGRESS', 'NOT_FOUND', 'ERROR'
        message: 詳細メッセージ
    """
    # モックモードチェック
    if is_cloudformation_mock_mode():
        return mock_check_stack_creation(stack_name)
    
    try:
        # create_boto3_session経由でセッション作成
        session = create_boto3_session()
        cloudformation_client = session.client('cloudformation')
        
        try:
            # スタック情報を取得
            stack_info = cloudformation_client.describe_stacks(StackName=stack_name)
            stack_status = stack_info['Stacks'][0]['StackStatus']
            
            # 作成/更新完了
            if stack_status in ['CREATE_COMPLETE', 'UPDATE_COMPLETE']:
                return 'SUCCESS', f'スタックの作成/更新が完了しました: {stack_status}'
            
            # 作成/更新失敗
            elif stack_status in ['CREATE_FAILED', 'UPDATE_FAILED']:
                return 'FAILED', f'スタックの作成/更新に失敗しました: {stack_status}'
            
            # ロールバック完了（失敗状態）
            elif stack_status in ['ROLLBACK_COMPLETE', 'UPDATE_ROLLBACK_COMPLETE']:
                return 'FAILED', f'スタックがロールバックされました: {stack_status}'
            
            # 進行中
            elif stack_status in ['CREATE_IN_PROGRESS', 'UPDATE_IN_PROGRESS', 'ROLLBACK_IN_PROGRESS', 'UPDATE_ROLLBACK_IN_PROGRESS']:
                return 'IN_PROGRESS', f'スタック作成/更新中: {stack_status}'
            
            # その他の状態
            else:
                return 'UNKNOWN', f'予期しないステータス: {stack_status}'
                
        except cloudformation_client.exceptions.ClientError as e:
            if 'does not exist' in str(e):
                return 'NOT_FOUND', 'スタックが存在しません'
            else:
                return 'ERROR', f'スタック状態の取得に失敗: {e}'
                
    except Exception as e:
        return 'ERROR', f'予期しないエラー: {e}'

def get_stack_status(stack_name: str) -> Optional[str]:
    """
    CloudFormationスタックの現在の状態を取得
    
    Args:
        stack_name: スタック名
        
    Returns:
        スタック状態（CREATE_COMPLETE, UPDATE_IN_PROGRESS等）
        スタックが存在しない場合やエラーの場合はNone
    """
    try:
        # create_boto3_session経由でセッション作成
        session = create_boto3_session()
        cloudformation_client = session.client('cloudformation')
        
        stack_info = cloudformation_client.describe_stacks(StackName=stack_name)
        return stack_info['Stacks'][0]['StackStatus']
        
    except cloudformation_client.exceptions.ClientError as e:
        if 'does not exist' in str(e):
            return None  # スタックが存在しない
        else:
            print(f"スタック状態の取得に失敗: {e}")
            return None
    except Exception as e:
        print(f"予期しないエラー: {e}")
        return None

def get_stack_info(stack_name: str) -> Optional[dict]:
    """
    CloudFormationスタックの詳細情報を取得
    
    Args:
        stack_name: スタック名
        
    Returns:
        スタック情報の辞書（StackStatus, CreationTime, Parameters等を含む）
        スタックが存在しない場合やエラーの場合はNone
    """
    # モックモードチェック
    if is_cloudformation_mock_mode():
        return mock_get_stack_info(stack_name)
    
    try:
        # create_boto3_session経由でセッション作成
        session = create_boto3_session()
        cloudformation_client = session.client('cloudformation')
        
        stack_info = cloudformation_client.describe_stacks(StackName=stack_name)
        return stack_info['Stacks'][0]
        
    except cloudformation_client.exceptions.ClientError as e:
        if 'does not exist' in str(e):
            return None  # スタックが存在しない
        else:
            print(f"スタック情報の取得に失敗: {e}")
            return None
    except Exception as e:
        print(f"予期しないエラー: {e}")
        return None

def get_stack_failure_reason(stack_name: str) -> Optional[str]:
    """
    CloudFormationスタックの失敗理由を取得
    
    Args:
        stack_name: スタック名
        
    Returns:
        失敗理由の文字列、取得できない場合はNone
    """
    try:
        session = create_boto3_session()
        cloudformation_client = session.client('cloudformation')
        
        # スタックイベントを取得
        response = cloudformation_client.describe_stack_events(StackName=stack_name)
        events = response.get('StackEvents', [])
        
        # 失敗したイベントを探す（最初のFAILEDイベント）
        for event in events:
            status = event.get('ResourceStatus', '')
            if 'FAILED' in status:
                reason = event.get('ResourceStatusReason', '')
                resource = event.get('LogicalResourceId', '')
                resource_type = event.get('ResourceType', '')
                
                return f"{resource} ({resource_type}): {reason}"
        
        # スタック自体のステータス理由を確認
        stack_info = get_stack_info(stack_name)
        if stack_info:
            return stack_info.get('StackStatusReason', 'Unknown error')
        
        return None
        
    except Exception as e:
        print(f"Failed to get stack failure reason: {e}")
        return None

def get_service_stack_name(camera_id: str, service_name: str) -> Optional[str]:
    """
    サービス用のスタック名を取得（Camera Management系で使用）
    
    Note: Collector系では get_collector_stack_name() を使用してください
    
    Args:
        camera_id: カメラID
        service_name: サービス名（例: "rtsp-receiver", "rtsp-movie"）
        
    Returns:
        スタック名、取得失敗時はNone
    """
    # Parameter Storeからベーススタック名を取得
    base_stack_name = get_parameter_from_store('/Cedix/Main/StackName')
    if not base_stack_name:
        print("ERROR: Parameter Storeからベーススタック名が取得できませんでした。")
        print("メインスタック（template.yaml）がデプロイされているか確認してください。")
        return None
    
    # サービス用のスタック名を構築
    stack_name = f"{base_stack_name}-{service_name}-{camera_id}"
    print(f"ベーススタック名: {base_stack_name}")
    print(f"サービススタック名: {stack_name}")
    
    return stack_name

def get_collector_stack_name(camera_id: str, service_name: str, collector_id: str) -> Optional[str]:
    """
    コレクター用のスタック名を取得（collector_idを含む）
    
    Args:
        camera_id: カメラID
        service_name: サービス名（例: "hlsrec", "hlsyolo", "s3rec"）
        collector_id: コレクターID（UUID）
        
    Returns:
        スタック名、取得失敗時はNone
    """
    # Parameter Storeからベーススタック名を取得
    base_stack_name = get_parameter_from_store('/Cedix/Main/StackName')
    if not base_stack_name:
        print("ERROR: Parameter Storeからベーススタック名が取得できませんでした。")
        print("メインスタック（template.yaml）がデプロイされているか確認してください。")
        return None
    
    # コレクター用のスタック名を構築（collector_idを含む）
    stack_name = f"{base_stack_name}-{service_name}-{camera_id}-{collector_id}"
    print(f"ベーススタック名: {base_stack_name}")
    print(f"コレクタースタック名: {stack_name}")
    
    return stack_name

def get_resource_name(name: str) -> Optional[str]:
    """
    サービス用のスタック名を取得
    
    Args:
        name 
     
    Returns:
        スタック名、取得失敗時はNone
    """
    # Parameter Storeからベーススタック名を取得
    base_stack_name = get_parameter_from_store('/Cedix/Main/StackName')
    if not base_stack_name:
        print("ERROR: Parameter Storeからベーススタック名が取得できませんでした。")
        print("メインスタック（template.yaml）がデプロイされているか確認してください。")
        return None
    
    # サービス用のスタック名を構築
    resource_name = f"{base_stack_name}-{name}"
    print(f"ベーススタック名: {base_stack_name}")
    print(f"名: {name}")
    
    return resource_name


def get_detectors_by_collector(collector_id: str, 
                               file_type: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    指定したcollector_idに対応する全Detector設定を取得
    
    Args:
        collector_id: コレクターID
        file_type: ファイルタイプ（Noneの場合は全件取得、指定された場合はそのファイルタイプのみ）
        
    Returns:
        Detector設定のリスト
    """
    logger = logging.getLogger(__name__)
    
    try:
        session = create_boto3_session()
        dynamodb = session.resource('dynamodb')
        detector_table = dynamodb.Table(DETECTOR_TABLE)
        
        if file_type is None:
            # file_type指定なし：image と video の両方を取得してマージ
            # GSI-1 (collector_id_file_type) を使用
            detectors = []
            for ft in ['image', 'video']:
                collector_id_file_type = f"{collector_id}|{ft}"
                response = detector_table.query(
                    IndexName='globalindex1',
                    KeyConditionExpression='collector_id_file_type = :key',
                    ExpressionAttributeValues={
                        ':key': collector_id_file_type
                    }
                )
                detectors.extend(response.get('Items', []))
            
            logger.info(f"Detector設定を{len(detectors)}件取得しました: collector_id={collector_id} (全file_type)")
        else:
            # file_type指定あり：GSI-1を使って検索
            collector_id_file_type = f"{collector_id}|{file_type}"
            
            response = detector_table.query(
                IndexName='globalindex1',
                KeyConditionExpression='collector_id_file_type = :key',
                ExpressionAttributeValues={
                    ':key': collector_id_file_type
                }
            )
            detectors = response.get('Items', [])
            logger.info(f"Detector設定を{len(detectors)}件取得しました: collector_id={collector_id}, file_type={file_type}")
        
        return detectors
        
    except Exception as e:
        logger.error(f"Detector設定の取得中にエラーが発生しました: {e}")
        return []


def get_detector_by_id(detector_id: str) -> Optional[Dict[str, Any]]:
    """
    指定したdetector_idのDetector設定を取得
    
    Args:
        detector_id: Detector ID（プライマリキー）
        
    Returns:
        Detector設定（見つからない場合はNone）
    """
    logger = logging.getLogger(__name__)
    
    try:
        session = create_boto3_session()
        dynamodb = session.resource('dynamodb')
        detector_table = dynamodb.Table(DETECTOR_TABLE)
        
        response = detector_table.get_item(
            Key={
                'detector_id': detector_id
            }
        )
        
        detector = response.get('Item')
        if detector:
            logger.info(f"Detector設定を取得しました: detector_id={detector_id}")
        else:
            logger.warning(f"Detector設定が見つかりません: detector_id={detector_id}")
        
        return detector
        
    except Exception as e:
        logger.error(f"Detector設定の取得中にエラーが発生しました: detector_id={detector_id}, error={e}")
        return None