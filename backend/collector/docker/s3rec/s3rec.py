import boto3
import os
import json
from datetime import datetime, timedelta, UTC, timezone
from botocore.exceptions import ClientError
import sys
import logging

# common_setup.pyを実行してsys.pathに追加
from shared.common import *
from shared.eventbridge_publisher import EventBridgePublisher

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
logger = setup_logger('s3Rec')

def get_file_extension_and_type(content_type, object_key):
    """
    Content-Typeとオブジェクトキーからファイル拡張子とタイプを判定
    
    Args:
        content_type: S3オブジェクトのContent-Type
        object_key: S3オブジェクトキー
        
    Returns:
        (file_extension, file_type)のタプル
    """
    # オブジェクトキーから拡張子を取得
    key_extension = object_key.lower().split('.')[-1] if '.' in object_key else ''
    
    # Content-Typeベースの判定
    if content_type:
        content_type = content_type.lower()
        if content_type.startswith('image/'):
            if content_type == 'image/jpeg' or key_extension in ['jpg', 'jpeg']:
                return 'jpg', 'image'
            elif content_type == 'image/png' or key_extension == 'png':
                return 'png', 'image'
            elif content_type == 'image/gif' or key_extension == 'gif':
                return 'gif', 'image'
            else:
                return 'jpg', 'image'  # デフォルト
        elif content_type.startswith('video/'):
            if content_type == 'video/mp4' or key_extension == 'mp4':
                return 'mp4', 'video'
            elif content_type == 'video/avi' or key_extension == 'avi':
                return 'avi', 'video'
            elif content_type == 'video/mov' or key_extension == 'mov':
                return 'mov', 'video'
            else:
                return 'mp4', 'video'  # デフォルト
    
    # Content-Typeが不明な場合は拡張子で判定
    if key_extension in ['jpg', 'jpeg', 'png', 'gif']:
        return key_extension if key_extension != 'jpeg' else 'jpg', 'image'
    elif key_extension in ['mp4', 'avi', 'mov']:
        return key_extension, 'video'
    
    # デフォルト
    return 'jpg', 'image'

def process_s3_object(source_bucket, source_key, event_time, event_publisher=None):
    """
    S3オブジェクトを処理してコピーし、DynamoDBに記録（疎結合: detector を知らない）
    
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
            logger.error(f"カメラ情報が見つからないか、無効です: {CAMERA_ID}")
            return {
                'statusCode': 400,
                'error': f'カメラ情報が見つかりません: {CAMERA_ID}'
            }

        # カメラタイプを検証（s3タイプをサポート）
        if camera_info.get('type') != 's3':
            logger.error(f"サポートされていないカメラタイプです: {camera_info.get('type')}")
            return {
                'statusCode': 400,
                'error': f'サポートされていないカメラタイプ: {camera_info.get("type")}'
            }

        logger.info(f"カメラ情報を取得しました: {CAMERA_ID} (type: {camera_info.get('type')})")

        # イベント時刻をdatetimeオブジェクトに変換
        if isinstance(event_time, str):
            # ISO 8601形式の文字列をパース
            timestamp = datetime.fromisoformat(event_time.replace('Z', '+00:00'))
        elif isinstance(event_time, datetime):
            timestamp = event_time
        else:
            # フォールバック: 現在時刻を使用
            from shared.timezone_utils import now_utc
            timestamp = now_utc()
        
        logger.info(f"イベント時刻をタイムスタンプとして使用: {timestamp}")

        # S3オブジェクトのメタデータとデータを取得
        try:
            # オブジェクトのメタデータを取得
            head_response = s3_client.head_object(Bucket=source_bucket, Key=source_key)
            content_type = head_response.get('ContentType', '')
            content_length = head_response.get('ContentLength', 0)
            
            logger.info(f"オブジェクトメタデータ取得: {source_key}")
            logger.info(f"  ContentType: {content_type}")
            logger.info(f"  ContentLength: {content_length}")

            # オブジェクトデータを取得
            get_response = s3_client.get_object(Bucket=source_bucket, Key=source_key)
            object_data = get_response['Body'].read()
            
            if len(object_data) == 0:
                logger.error(f"オブジェクトが空です: {source_key}")
                return {
                    'statusCode': 400,
                    'error': 'オブジェクトが空です'
                }

        except ClientError as e:
            logger.error(f"S3オブジェクトの取得に失敗しました: {e}")
            return {
                'statusCode': 404,
                'error': f'S3オブジェクトの取得に失敗: {e}'
            }

        # ファイル拡張子とタイプを判定
        file_extension, file_type = get_file_extension_and_type(content_type, source_key)
        logger.info(f"ファイルタイプ判定: {file_type}, 拡張子: {file_extension}")

        # captureフィールドの確認と初回画像保存処理
        capture_path = camera_info.get('capture')
        if not capture_path and file_type == 'image':
            logger.info(f"カメラ {CAMERA_ID} のcaptureが未設定のため、初回キャプチャ画像を保存します")
            
            try:
                # capture.jpgとして保存
                s3_key_capture = f"collect/{CAMERA_ID}/capture.jpg"
                s3path_capture = f"s3://{BUCKET_NAME}/{s3_key_capture}"
                
                if upload_to_s3_with_retry(s3_client, BUCKET_NAME, s3_key_capture, object_data, 'image/jpeg'):
                    logger.info(f"初回キャプチャ画像を保存しました: {s3path_capture}")
                    
                    # DynamoDBのcaptureフィールドを更新
                    if update_camera_capture_image(dynamodb, CAMERA_ID, s3path_capture):
                        logger.info(f"DynamoDBのcaptureフィールドを更新しました: {CAMERA_ID}")
                    else:
                        logger.warning(f"DynamoDBのcaptureフィールド更新に失敗しました: {CAMERA_ID}")
                else:
                    logger.error(f"初回キャプチャ画像の保存に失敗しました: {s3path_capture}")
            except Exception as e:
                logger.error(f"初回キャプチャ画像の保存中にエラーが発生しました: {e}")
                # エラーが発生してもメイン処理は継続
        
        # 新しいS3パスを生成 - collector_id を使用
        s3_key, s3path = generate_s3_path(CAMERA_ID, COLLECTOR_ID, file_type, timestamp, BUCKET_NAME, file_extension)
        
        logger.info(f"新しいS3パス: {s3path}")

        # 新しいS3バケットにコピー
        content_type_for_upload = f"{file_type}/{file_extension}" if file_extension else 'application/octet-stream'
        
        if upload_to_s3_with_retry(s3_client, BUCKET_NAME, s3_key, object_data, content_type_for_upload):
            logger.info(f"ファイルをS3にコピーしました: {s3path}")
            
            # DynamoDBにファイルレコードを挿入
            file_id = insert_file_record(
                dynamodb, 
                CAMERA_ID, 
                timestamp,  # start_time
                timestamp,  # end_time（ファイルコピーなので同じ時刻）
                s3path, 
                COLLECTOR_ID, 
                file_type
            )
            
            if file_id:
                logger.info(f"ファイルレコードをDynamoDBに保存しました: {file_id}")
                
                # EventBridge イベント発行（疎結合: 1回のみ）
                if event_publisher:
                    try:
                        if file_type == 'image':
                            event_publisher.publish_save_image_event(
                                camera_id=CAMERA_ID,
                                collector_id=COLLECTOR_ID,
                                file_id=file_id,
                                s3path=s3path,
                                timestamp=timestamp
                            )
                            logger.info(f"SaveImageEvent発行完了: collector_id={COLLECTOR_ID}")
                        elif file_type == 'video':
                            event_publisher.publish_save_video_event(
                                camera_id=CAMERA_ID,
                                collector_id=COLLECTOR_ID,
                                file_id=file_id,
                                s3path=s3path,
                                timestamp=timestamp,
                                video_duration=0.0
                            )
                            logger.info(f"SaveVideoEvent発行完了: collector_id={COLLECTOR_ID}")
                    except Exception as e:
                        logger.error(f"EventBridge発行エラー: {e}")
                        # エラーでもメイン処理は継続
                
                return {
                    'statusCode': 200,
                    'message': 'ファイル処理が正常に完了しました',
                    'file_id': file_id,
                    's3path': s3path,
                    'source_path': f"s3://{source_bucket}/{source_key}"
                }
            else:
                logger.error("DynamoDBへのファイルレコード保存に失敗しました")
                return {
                    'statusCode': 500,
                    'error': 'DynamoDBへのファイルレコード保存に失敗'
                }
        else:
            logger.error("S3へのファイルコピーに失敗しました")
            return {
                'statusCode': 500,
                'error': 'S3へのファイルコピーに失敗'
            }
            
    except Exception as e:
        logger.error(f"ファイル処理中にエラーが発生しました: {e}")
        return {
            'statusCode': 500,
            'error': f'処理中にエラーが発生: {str(e)}'
        }

def lambda_handler(event, context):
    """
    Lambda関数のメインハンドラー
    S3イベントを受け取り、ファイルを処理する
    """
    logger.info(f"Lambda関数が開始されました")
    logger.info(f"環境変数 - CAMERA_ID: {CAMERA_ID}, COLLECTOR_ID: {COLLECTOR_ID}, BUCKET_NAME: {BUCKET_NAME}")
    logger.info(f"受信イベント: {json.dumps(event, default=str, ensure_ascii=False)}")

    # EventBridgePublisherを初期化（疎結合: detector を知らない）
    event_publisher = None
    try:
        event_publisher = EventBridgePublisher(
            create_boto3_session_func=create_boto3_session,
            collector_type='s3Rec',
            event_bus_name=os.environ.get('EVENT_BUS_NAME', 'default')
        )
        logger.info(f"EventBridgePublisher初期化完了: collector_id={COLLECTOR_ID}")
    except Exception as e:
        logger.warning(f"EventBridgePublisher初期化に失敗しました（処理は継続）: {e}")
        event_publisher = None

    try:
        # EventBridgeからのS3イベントを解析
        if 'detail' in event and 'bucket' in event['detail'] and 'object' in event['detail']:
            # EventBridge経由のS3イベント
            detail = event['detail']
            source_bucket = detail['bucket']['name']
            source_key = detail['object']['key']
            event_time = event.get('time', format_for_db(now_utc()))
            
            logger.info(f"EventBridge S3イベントを検出:")
            logger.info(f"  Bucket: {source_bucket}")
            logger.info(f"  Key: {source_key}")
            logger.info(f"  EventTime: {event_time}")
            
        elif 'Records' in event:
            # 直接のS3イベント（テスト用）
            if len(event['Records']) == 0:
                return {
                    'statusCode': 400,
                    'body': json.dumps({'error': 'レコードが空です'})
                }
            
            record = event['Records'][0]
            if 's3' not in record:
                return {
                    'statusCode': 400,
                    'body': json.dumps({'error': 'S3イベントではありません'})
                }
            
            s3_info = record['s3']
            source_bucket = s3_info['bucket']['name']
            source_key = s3_info['object']['key']
            event_time = record.get('eventTime', format_for_db(now_utc()))
            
            logger.info(f"直接S3イベントを検出:")
            logger.info(f"  Bucket: {source_bucket}")
            logger.info(f"  Key: {source_key}")
            logger.info(f"  EventTime: {event_time}")
            
        else:
            # テスト用のマニュアルイベント
            source_bucket = event.get('source_bucket', 'test-bucket')
            source_key = event.get('source_key', 'test/file.jpg')
            event_time = event.get('event_time', format_for_db(now_utc()))
            
            logger.info(f"テストイベントを検出:")
            logger.info(f"  Bucket: {source_bucket}")
            logger.info(f"  Key: {source_key}")
            logger.info(f"  EventTime: {event_time}")

        # ファイル処理を実行
        result = process_s3_object(source_bucket, source_key, event_time, event_publisher)
        
        logger.info(f"処理結果: {result}")
        
        return {
            'statusCode': result['statusCode'],
            'body': json.dumps(result, ensure_ascii=False)
        }

    except Exception as e:
        logger.error(f"Lambda関数でエラーが発生しました: {e}")
        return {
            'statusCode': 500,
            'body': json.dumps({
                'error': f'Lambda関数でエラーが発生: {str(e)}'
            }, ensure_ascii=False)
        }

# ローカルテスト用
if __name__ == "__main__":
    # テスト用のイベント
    test_event = {
        "source_bucket": "test-source-bucket",
        "source_key": "test/sample.jpg",
        "event_time": format_for_db(now_utc())
    }
    
    result = lambda_handler(test_event, None)
    print(f"テスト結果: {json.dumps(result, indent=2, ensure_ascii=False)}") 