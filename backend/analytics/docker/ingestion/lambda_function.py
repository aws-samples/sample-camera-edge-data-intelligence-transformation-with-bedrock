"""
DynamoDB Stream to OpenSearch Serverless Lambda Handler

DynamoDBの DETECT_LOG_TABLE テーブルのStreamイベントを
OpenSearch Serverlessにリアルタイムで連携するLambda関数
"""
import json
import os
import boto3
import time
from opensearch_client import OpenSearchClient
from dynamodb_converter import convert_dynamodb_to_dict

# 環境変数
OPENSEARCH_ENDPOINT = os.environ['OPENSEARCH_ENDPOINT']
INDEX_NAME = os.environ['INDEX_NAME']
DLQ_BUCKET = os.environ.get('DLQ_BUCKET', '')
DLQ_PREFIX = os.environ.get('DLQ_PREFIX', 'dlqs/lambda/')

# OpenSearchクライアントの初期化（コールドスタート時のみ）
opensearch_client = None
s3_client = None


def handler(event, context):
    """
    DynamoDB StreamイベントをOpenSearch Serverlessに連携するLambdaハンドラー
    
    Args:
        event: DynamoDB Streamイベント
        context: Lambda実行コンテキスト
    
    Returns:
        dict: 実行結果
    """
    global opensearch_client, s3_client
    
    print(f"Lambda invoked. Request ID: {context.aws_request_id if context else 'N/A'}")
    
    # 初回実行時のみクライアントを初期化
    if opensearch_client is None:
        print("Initializing OpenSearch client...")
        opensearch_client = OpenSearchClient(OPENSEARCH_ENDPOINT, INDEX_NAME)
        try:
            opensearch_client.ensure_index_exists()
        except Exception as e:
            print(f"Warning: Failed to ensure index exists: {e}")
            # インデックス作成失敗は警告のみ（権限不足の可能性）
    
    if s3_client is None and DLQ_BUCKET:
        print("Initializing S3 client for DLQ...")
        s3_client = boto3.client('s3')
    
    # DynamoDB Streamレコードを処理
    records = event.get('Records', [])
    
    if not records:
        print("No records to process")
        return {
            'statusCode': 200,
            'body': json.dumps({'message': 'No records to process'})
        }
    
    print(f"Processing {len(records)} records from DynamoDB Stream")
    
    success_count = 0
    error_count = 0
    errors = []
    
    # バルク操作用のリスト
    bulk_operations = []
    
    for idx, record in enumerate(records):
        try:
            event_name = record.get('eventName')
            event_id = record.get('eventID', f'unknown-{idx}')
            dynamodb_data = record.get('dynamodb', {})
            
            print(f"Processing record {idx + 1}/{len(records)}: eventName={event_name}, eventID={event_id}")
            
            # キーの取得
            keys = dynamodb_data.get('Keys', {})
            document_id = convert_dynamodb_to_dict(keys).get('detect_log_id')
            
            if not document_id:
                raise ValueError(f"detect_log_id not found in Keys: {keys}")
            
            if event_name in ['INSERT', 'MODIFY']:
                # 新規追加または更新
                new_image = dynamodb_data.get('NewImage', {})
                if not new_image:
                    raise ValueError(f"NewImage not found for {event_name} event")
                
                document = convert_dynamodb_to_dict(new_image)
                
                bulk_operations.append({
                    'action': 'index',
                    'id': document_id,
                    'document': document
                })
                
                print(f"  → Queued for indexing: {document_id}")
                
            elif event_name == 'REMOVE':
                # 削除
                bulk_operations.append({
                    'action': 'delete',
                    'id': document_id
                })
                
                print(f"  → Queued for deletion: {document_id}")
            
            else:
                print(f"  → Skipping unknown event type: {event_name}")
                continue
            
            success_count += 1
            
        except Exception as e:
            error_count += 1
            error_detail = {
                'record_index': idx,
                'event_id': record.get('eventID', 'unknown'),
                'event_name': record.get('eventName', 'unknown'),
                'error': str(e)
            }
            errors.append(error_detail)
            print(f"  ✗ Error processing record {idx + 1}: {e}")
            
            # DLQに送信
            if s3_client and DLQ_BUCKET:
                try:
                    send_to_dlq(record, str(e))
                except Exception as dlq_error:
                    print(f"  ✗ Failed to send to DLQ: {dlq_error}")
    
    # バルク操作を実行
    if bulk_operations:
        try:
            print(f"Executing bulk operation with {len(bulk_operations)} operations...")
            response = opensearch_client.bulk_operation(bulk_operations)
            
            # バルク操作の結果を確認
            if response.get('errors'):
                error_items = [item for item in response['items'] if 'error' in list(item.values())[0]]
                print(f"✗ Bulk operation completed with {len(error_items)} errors")
                
                # エラーがあった場合はDLQに送信
                if s3_client and DLQ_BUCKET:
                    for error_item in error_items:
                        try:
                            send_to_dlq(error_item, "Bulk operation error")
                        except Exception as dlq_error:
                            print(f"Failed to send bulk error to DLQ: {dlq_error}")
            else:
                print(f"✓ Bulk operation completed successfully")
                
        except Exception as e:
            error_msg = f"Bulk operation failed: {e}"
            print(f"✗ {error_msg}")
            
            # バルク操作失敗時は全操作をDLQに送信
            if s3_client and DLQ_BUCKET:
                for op in bulk_operations:
                    try:
                        send_to_dlq(op, error_msg)
                    except Exception as dlq_error:
                        print(f"Failed to send to DLQ: {dlq_error}")
            
            # バルク操作失敗は致命的なエラーとして例外をスロー
            raise Exception(error_msg)
    
    print(f"Processing completed: {success_count} success, {error_count} errors")
    
    # エラーがあった場合は例外をスロー（Lambdaの自動リトライを発動）
    if error_count > 0:
        error_summary = f"Failed to process {error_count} out of {len(records)} records"
        print(f"✗ {error_summary}")
        raise Exception(error_summary)
    
    return {
        'statusCode': 200,
        'body': json.dumps({
            'message': 'Processing completed successfully',
            'success_count': success_count,
            'error_count': error_count,
            'total_records': len(records)
        })
    }


def send_to_dlq(record, error_message):
    """
    エラーレコードをDLQ（S3）に送信
    
    Args:
        record: エラーが発生したレコード
        error_message: エラーメッセージ
    """
    try:
        timestamp = int(time.time() * 1000)
        event_id = 'unknown'
        
        if isinstance(record, dict):
            event_id = record.get('eventID', record.get('id', 'unknown'))
        
        key = f"{DLQ_PREFIX}{timestamp}_{event_id}.json"
        
        dlq_record = {
            'record': record,
            'error': error_message,
            'timestamp': timestamp,
            'iso_timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        }
        
        s3_client.put_object(
            Bucket=DLQ_BUCKET,
            Key=key,
            Body=json.dumps(dlq_record, ensure_ascii=False, indent=2),
            ContentType='application/json'
        )
        print(f"  → Sent to DLQ: s3://{DLQ_BUCKET}/{key}")
    except Exception as e:
        print(f"  ✗ Failed to send record to DLQ: {e}")
        # DLQ送信失敗はログのみ（処理は続行）

