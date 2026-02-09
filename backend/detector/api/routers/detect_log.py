from fastapi import APIRouter, HTTPException, Depends, Query
from typing import List, Optional
from pydantic import BaseModel
from shared.auth import get_current_user
from botocore.exceptions import ClientError
from datetime import datetime, timedelta
from shared.common import *

router = APIRouter()

# Initialize DynamoDB resource
session = create_boto3_session()
dynamodb = session.resource('dynamodb')

class NotifyUpdateRequest(BaseModel):
    notify_flg: bool
    notify_reason: Optional[str] = None

@router.get("/files/{file_id}/detect-logs")
async def get_file_detect_logs(
    file_id: str,
    detector_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """
    指定されたファイルIDの検出ログを取得
    """
    try:
        table = dynamodb.Table(DETECT_LOG_TABLE)
        
        if detector_id:
            # detector_idが指定されている場合、file_idとdetector_idの両方でクエリ（globalindex4使用）
            response = table.query(
                IndexName='globalindex4',
                KeyConditionExpression='file_id = :file_id AND detector_id = :detector_id',
                ExpressionAttributeValues={
                    ':file_id': file_id,
                    ':detector_id': detector_id
                }
            )
        else:
            # detector_idが指定されていない場合、file_idのみでクエリ（globalindex4使用）
            response = table.query(
                IndexName='globalindex4',
                KeyConditionExpression='file_id = :file_id',
                ExpressionAttributeValues={
                    ':file_id': file_id
                }
            )
        
        logs = response.get('Items', [])
        
        # 結果を整形
        formatted_logs = []
        for log in logs:
            # detect_notify_flgは文字列で保存されているので、booleanに変換
            detect_notify_flg = log.get('detect_notify_flg', 'false')
            if isinstance(detect_notify_flg, str):
                detect_notify_flg = detect_notify_flg.lower() == 'true'
            
            formatted_log = {
                'detect_log_id': log.get('detect_log_id'),
                'file_id': log.get('file_id'),
                'detector_id': log.get('detector_id'),  # detector_idを追加
                'detector_name': log.get('detector'),  # detectorフィールドを使用（表示用）
                'detect_result': log.get('detect_result'),
                'detect_tag': list(log.get('detect_tag', [])),  # セットから配列に変換
                'detect_notify_flg': detect_notify_flg,
                'detect_notify_reason': log.get('detect_notify_reason'),
                'detect_timestamp': log.get('start_time'),  # start_timeをタイムスタンプとして使用
                'confidence_score': log.get('confidence_score')
            }
            formatted_logs.append(formatted_log)
        
        # start_timeで降順ソート
        formatted_logs.sort(key=lambda x: x.get('detect_timestamp', ''), reverse=True)
        
        return {
            "logs": formatted_logs,
            "total_count": len(formatted_logs)
        }
        
    except ClientError as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@router.get("/detect-logs/{detect_log_id}")
async def get_detect_log_details(
    detect_log_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    指定された検出ログの詳細情報を取得
    """
    try:
        table = dynamodb.Table(DETECT_LOG_TABLE)
        
        response = table.get_item(
            Key={'detect_log_id': detect_log_id}
        )
        
        if 'Item' not in response:
            raise HTTPException(status_code=404, detail="Detect log not found")
        
        log = response['Item']
        formatted_log = {
            'detect_log_id': log.get('detect_log_id'),
            'file_id': log.get('file_id'),
            'detector_id': log.get('detector_id'),  # detector_idを追加
            'detector_name': log.get('detector'),  # detectorフィールドを使用（表示用）
            'detect_result': log.get('detect_result'),
            'detect_tag': log.get('detect_tag', []),
            'detect_notify_flg': log.get('detect_notify_flg', False),
            'detect_notify_reason': log.get('detect_notify_reason'),
            'detect_timestamp': log.get('start_time'),  # start_timeをタイムスタンプとして使用
            'confidence_score': log.get('confidence_score')
        }
        
        return formatted_log
        
    except ClientError as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@router.put("/detect-logs/{detect_log_id}/notify")
async def update_notify_flag(
    detect_log_id: str,
    request: NotifyUpdateRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    検出ログの通知フラグを更新
    """
    try:
        table = dynamodb.Table(DETECT_LOG_TABLE)
        
        # 更新項目を準備
        update_expression = "SET detect_notify_flg = :notify_flg"
        expression_values = {':notify_flg': request.notify_flg}
        
        if request.notify_reason is not None:
            update_expression += ", detect_notify_reason = :notify_reason"
            expression_values[':notify_reason'] = request.notify_reason
        
        response = table.update_item(
            Key={'detect_log_id': detect_log_id},
            UpdateExpression=update_expression,
            ExpressionAttributeValues=expression_values,
            ReturnValues="ALL_NEW"
        )
        
        return response.get('Attributes', {})
        
    except ClientError as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@router.get("/notifications/recent")
async def get_recent_notifications(
    current_user: dict = Depends(get_current_user)
):
    """
    直近1時間のdetect_notify_flg=trueの通知を最大20件取得
    """
    print("=== get_recent_notifications API called ===")
    print(f"Current user: {current_user}")
    
    try:
        table = dynamodb.Table(DETECT_LOG_TABLE)
        print("DynamoDB table initialized")
        
        # 1時間前の時刻を計算
        from shared.timezone_utils import now_utc
        one_hour_ago = now_utc() - timedelta(hours=1)
        one_hour_ago_str = one_hour_ago.strftime('%Y-%m-%dT%H:%M:%S')
        print(f"Searching for notifications since: {one_hour_ago_str}")
        
        # globalindex2を使用してdetect_notify_flg='true'でクエリ
        print("Executing DynamoDB query...")
        response = table.query(
            IndexName='globalindex2',
            KeyConditionExpression='detect_notify_flg = :notify_flg AND start_time >= :start_time',
            ExpressionAttributeValues={
                ':notify_flg': 'true',
                ':start_time': one_hour_ago_str
            },
            ScanIndexForward=False,  # start_timeで降順ソート（最新順）
            Limit=20  # 最大20件
        )
        
        logs = response.get('Items', [])
        print(f"DynamoDB query returned {len(logs)} items")
        print(f"Raw items: {logs}")
        
        # 結果を整形
        formatted_notifications = []
        for log in logs:
            formatted_notification = {
                'detect_log_id': log.get('detect_log_id'),
                'place_name': log.get('place_name'),
                'camera_name': log.get('camera_name'),
                'start_time': log.get('start_time'),
                'detect_notify_reason': log.get('detect_notify_reason'),
                'camera_id': log.get('camera_id'),
                'file_id': log.get('file_id'),
                'detector': log.get('detector'),
                'detector_id': log.get('detector_id'),  # ディテクターIDを追加
                'file_type': log.get('file_type'),
                'collector': log.get('collector'),
                'collector_id': log.get('collector_id')  # コレクターIDを追加
            }
            formatted_notifications.append(formatted_notification)
        
        result = {
            "notifications": formatted_notifications,
            "total_count": len(formatted_notifications)
        }
        
        print(f"Formatted result: {result}")
        print("=== get_recent_notifications API end ===")
        return result
        
    except ClientError as e:
        print(f"DynamoDB ClientError: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    except Exception as e:
        print(f"General Exception: {e}")
        print(f"Exception type: {type(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@router.get("/notifications/history")
async def get_notification_history(
    page: int = Query(1, ge=1, description="Page number (starting from 1)"),
    limit: int = Query(20, ge=1, le=100, description="Number of items per page"),
    days: int = Query(30, ge=1, le=365, description="Number of days to look back"),
    current_user: dict = Depends(get_current_user)
):
    """
    過去の通知を取得（ページング付き）
    detect_notify_flg=trueの通知をstart_timeの降順で返す
    globalindex2を使用して効率的にクエリ
    """
    print(f"=== get_notification_history API called ===")
    print(f"Current user: {current_user}, page: {page}, limit: {limit}, days: {days}")
    
    try:
        table = dynamodb.Table(DETECT_LOG_TABLE)
        print("DynamoDB table initialized")
        
        # 指定日数前の時刻を計算
        from shared.timezone_utils import now_utc
        start_date = now_utc() - timedelta(days=days)
        start_date_str = start_date.strftime('%Y-%m-%dT%H:%M:%S')
        print(f"Searching for notifications since: {start_date_str}")
        
        # globalindex2を使用してdetect_notify_flg='true'でクエリ
        # ページングのためにスキップする件数を計算
        skip_count = (page - 1) * limit
        fetch_count = skip_count + limit  # 必要な件数まで取得
        
        all_items = []
        last_evaluated_key = None
        
        while len(all_items) < fetch_count:
            query_kwargs = {
                'IndexName': 'globalindex2',
                'KeyConditionExpression': 'detect_notify_flg = :notify_flg AND start_time >= :start_time',
                'ExpressionAttributeValues': {
                    ':notify_flg': 'true',
                    ':start_time': start_date_str
                },
                'ScanIndexForward': False,  # start_timeで降順ソート（最新順）
                'Limit': min(100, fetch_count - len(all_items))  # 一度に取得する件数を制限
            }
            
            if last_evaluated_key:
                query_kwargs['ExclusiveStartKey'] = last_evaluated_key
            
            response = table.query(**query_kwargs)
            items = response.get('Items', [])
            all_items.extend(items)
            
            last_evaluated_key = response.get('LastEvaluatedKey')
            if not last_evaluated_key:
                break
        
        print(f"Total notifications fetched: {len(all_items)}")
        
        # ページングを適用（既にソート済み）
        page_items = all_items[skip_count:skip_count + limit]
        
        # 結果を整形
        formatted_notifications = []
        for log in page_items:
            formatted_notification = {
                'detect_log_id': log.get('detect_log_id'),
                'place_name': log.get('place_name'),
                'camera_name': log.get('camera_name'),
                'start_time': log.get('start_time'),
                'detect_notify_reason': log.get('detect_notify_reason'),
                'camera_id': log.get('camera_id'),
                'file_id': log.get('file_id'),
                'detector': log.get('detector'),
                'detector_id': log.get('detector_id'),
                'file_type': log.get('file_type'),
                'collector': log.get('collector'),
                'collector_id': log.get('collector_id')
            }
            formatted_notifications.append(formatted_notification)
        
        # 総件数を取得するために追加クエリ（Countのみ）
        count_response = table.query(
            IndexName='globalindex2',
            KeyConditionExpression='detect_notify_flg = :notify_flg AND start_time >= :start_time',
            ExpressionAttributeValues={
                ':notify_flg': 'true',
                ':start_time': start_date_str
            },
            Select='COUNT'
        )
        total_count = count_response.get('Count', len(all_items))
        
        # ページネーションがある場合は全件カウントを取得
        while count_response.get('LastEvaluatedKey'):
            count_response = table.query(
                IndexName='globalindex2',
                KeyConditionExpression='detect_notify_flg = :notify_flg AND start_time >= :start_time',
                ExpressionAttributeValues={
                    ':notify_flg': 'true',
                    ':start_time': start_date_str
                },
                Select='COUNT',
                ExclusiveStartKey=count_response['LastEvaluatedKey']
            )
            total_count += count_response.get('Count', 0)
        
        total_pages = (total_count + limit - 1) // limit  # 切り上げ
        
        result = {
            "notifications": formatted_notifications,
            "pagination": {
                "current_page": page,
                "total_pages": total_pages,
                "total_count": total_count,
                "page_size": limit,
                "has_next": page < total_pages,
                "has_prev": page > 1,
                "days_range": days
            }
        }
        
        print(f"Formatted result with pagination: page {page}/{total_pages}, items: {len(formatted_notifications)}")
        print("=== get_notification_history API end ===")
        return result
        
    except ClientError as e:
        print(f"DynamoDB ClientError: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    except Exception as e:
        print(f"General Exception: {e}")
        print(f"Exception type: {type(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}") 