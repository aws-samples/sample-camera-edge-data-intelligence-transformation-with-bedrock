from fastapi import APIRouter, HTTPException, Depends
from typing import List, Optional, Dict, Any
from pydantic import BaseModel
from botocore.exceptions import ClientError
from datetime import datetime, timedelta, timezone
import logging
from shared.auth import get_current_user
from shared.common import *

logger = logging.getLogger(__name__)
from analytics.api.routers.search import search_notifications, SearchRequest, convert_to_iso_format

router = APIRouter()

# Initialize DynamoDB resource
session = create_boto3_session()
dynamodb = session.resource('dynamodb')

class TagsResponse(BaseModel):
    tags: List[str]

class TimeseriesDataRequest(BaseModel):
    tags: List[str]
    granularity: str = "MINUTE"  # MINUTE, HOUR, DAY
    place_id: Optional[str] = None
    camera_id: Optional[str] = None
    start_time: Optional[str] = None  # ISO形式の時間範囲
    end_time: Optional[str] = None    # ISO形式の時間範囲
    date_range: Optional[str] = None  # 自動計算されるため基本不要（後方互換性）

class TimeseriesDataResponse(BaseModel):
    data: List[Dict[str, Any]]
    metadata: Dict[str, Any]

class DetailLogsRequest(BaseModel):
    start_time: str
    end_time: str
    tag_name: str
    place_id: Optional[str] = None
    camera_id: Optional[str] = None

class DetailLogsResponse(BaseModel):
    logs: List[Dict[str, Any]]
    total_count: int

def generate_time_range(granularity: str):
    """
    粒度に応じた時間範囲を生成（JST）
    MINUTE: 3時間, HOUR: 1日, DAY: 2週間
    """
    # JST (UTC+9) の現在時刻
    jst = timezone(timedelta(hours=9))
    from shared.timezone_utils import now_display
    now = now_display()
    
    if granularity == "MINUTE":
        start_time = now - timedelta(hours=3)
        end_time = now
        time_format = "MINUTE|%Y-%m-%dT%H:%M"
    elif granularity == "HOUR":
        start_time = now.replace(hour=0, minute=0, second=0, microsecond=0)
        end_time = now.replace(hour=23, minute=59, second=59, microsecond=999999)
        time_format = "HOUR|%Y-%m-%dT%H"
    else:  # DAY
        start_time = now - timedelta(days=14)
        start_time = start_time.replace(hour=0, minute=0, second=0, microsecond=0)
        end_time = now.replace(hour=23, minute=59, second=59, microsecond=999999)
        time_format = "DAY|%Y-%m-%d"
    
    return start_time, end_time, time_format

@router.get("/tags", response_model=TagsResponse)
async def get_detector_tags(
    place_id: Optional[str] = None,
    camera_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """
    指定された条件に基づいてdetectorテーブルからタグリストを取得
    """
    try:
        table = dynamodb.Table(DETECTOR_TABLE)
        
        if camera_id:
            # カメラIDで絞り込み
            response = table.scan(
                FilterExpression="camera_id = :camera_id",
                ExpressionAttributeValues={':camera_id': camera_id}
            )
        elif place_id:
            # 場所IDで絞り込み - camera テーブルから該当するカメラIDを取得してから検索
            camera_table = dynamodb.Table(CAMERA_TABLE)
            camera_response = camera_table.scan(
                FilterExpression="place_id = :place_id",
                ExpressionAttributeValues={':place_id': place_id}
            )
            
            camera_ids = [camera['camera_id'] for camera in camera_response.get('Items', [])]
            
            if not camera_ids:
                return TagsResponse(tags=[])
            
            # 複数のカメラIDで検索
            if len(camera_ids) == 1:
                response = table.scan(
                    FilterExpression="camera_id = :camera_id_0",
                    ExpressionAttributeValues={':camera_id_0': camera_ids[0]}
                )
            else:
                # DynamoDBではINクエリはscanでのみ利用可能で、より複雑な構文が必要
                filter_conditions = []
                expression_values = {}
                for i, camera_id in enumerate(camera_ids):
                    filter_conditions.append(f"camera_id = :camera_id_{i}")
                    expression_values[f':camera_id_{i}'] = camera_id
                
                filter_expression = " OR ".join(filter_conditions)
                response = table.scan(
                    FilterExpression=filter_expression,
                    ExpressionAttributeValues=expression_values
                )
        else:
            # 全体のタグリスト取得
            response = table.scan()
        
        # tag_listからタグを抽出
        all_tags = set()
        for item in response.get('Items', []):
            tag_list = item.get('tag_list', '')
            if tag_list:
                # パイプ区切りでタグを分割
                tags = [tag.strip() for tag in tag_list.split('|') if tag.strip()]
                all_tags.update(tags)
        
        return TagsResponse(tags=sorted(list(all_tags)))
        
    except ClientError as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@router.post("/timeseries", response_model=TimeseriesDataResponse)
async def get_timeseries_data(
    request: TimeseriesDataRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    時系列データを取得
    """
    try:
        logger.debug(f" Received request: {request}")
        table = dynamodb.Table(DETECT_TAG_TIMESERIES_TABLE)
        logger.debug(f" Table created successfully")
        
        # 時間範囲の取得（リクエストから取得、なければgenerate_time_rangeを使用）
        if request.start_time and request.end_time:
            # ✅ リクエストから受け取った時刻はUTCとして扱う（API仕様変更）
            logger.debug(f" Received UTC time range: {request.start_time} to {request.end_time}")
            
            # UTC文字列をdatetimeに変換
            start_time = datetime.fromisoformat(request.start_time.replace('Z', ''))
            end_time = datetime.fromisoformat(request.end_time.replace('Z', ''))
            
            # タイムゾーン情報を追加（UTC）
            if start_time.tzinfo is None:
                start_time = start_time.replace(tzinfo=timezone.utc)
            if end_time.tzinfo is None:
                end_time = end_time.replace(tzinfo=timezone.utc)
            
            logger.debug(f" Parsed UTC datetime: {start_time} to {end_time}")
        else:
            # フォールバック: 従来のgenerate_time_range()を使用
            start_time, end_time, time_format = generate_time_range(request.granularity)
            logger.debug(f" Using generated time range: {start_time} to {end_time}")
        
        logger.debug(f" Final time range (UTC): {start_time} to {end_time}")
        
        all_data = []
        
        for tag_name in request.tags:
            if request.camera_id:
                # カメラ別検索 (globalindex2)
                pk_value = f"{request.camera_id}|{tag_name}"
                response = table.query(
                    IndexName='globalindex2',
                    KeyConditionExpression="camera_tag_key = :pk AND time_key BETWEEN :start_key AND :end_key",
                    ExpressionAttributeValues={
                        ':pk': pk_value,
                        ':start_key': f"{request.granularity}|{start_time.strftime('%Y-%m-%dT%H:%M' if request.granularity == 'MINUTE' else '%Y-%m-%dT%H' if request.granularity == 'HOUR' else '%Y-%m-%d')}",
                        ':end_key': f"{request.granularity}|{end_time.strftime('%Y-%m-%dT%H:%M' if request.granularity == 'MINUTE' else '%Y-%m-%dT%H' if request.granularity == 'HOUR' else '%Y-%m-%d')}"
                    }
                )
            elif request.place_id:
                # 場所別検索 (globalindex1)
                pk_value = f"{request.place_id}|{tag_name}"
                response = table.query(
                    IndexName='globalindex1',
                    KeyConditionExpression="place_tag_key = :pk AND time_key BETWEEN :start_key AND :end_key",
                    ExpressionAttributeValues={
                        ':pk': pk_value,
                        ':start_key': f"{request.granularity}|{start_time.strftime('%Y-%m-%dT%H:%M' if request.granularity == 'MINUTE' else '%Y-%m-%dT%H' if request.granularity == 'HOUR' else '%Y-%m-%d')}",
                        ':end_key': f"{request.granularity}|{end_time.strftime('%Y-%m-%dT%H:%M' if request.granularity == 'MINUTE' else '%Y-%m-%dT%H' if request.granularity == 'HOUR' else '%Y-%m-%d')}"
                    }
                )
            else:
                # 全体検索 (メインテーブル)
                response = table.query(
                    KeyConditionExpression="tag_name = :pk AND time_key BETWEEN :start_key AND :end_key",
                    ExpressionAttributeValues={
                        ':pk': tag_name,
                        ':start_key': f"{request.granularity}|{start_time.strftime('%Y-%m-%dT%H:%M' if request.granularity == 'MINUTE' else '%Y-%m-%dT%H' if request.granularity == 'HOUR' else '%Y-%m-%d')}",
                        ':end_key': f"{request.granularity}|{end_time.strftime('%Y-%m-%dT%H:%M' if request.granularity == 'MINUTE' else '%Y-%m-%dT%H' if request.granularity == 'HOUR' else '%Y-%m-%d')}"
                    }
                )
            
            # データを追加
            for item in response.get('Items', []):
                # ✅ DynamoDBから取得したstart_time/end_time（UTC）をそのまま返却（API仕様変更）
                start_time_utc = item.get('start_time')
                end_time_utc = item.get('end_time')
                
                all_data.append({
                    'tag_name': tag_name,
                    'time_key': item['time_key'],
                    'count': int(item.get('count', 0)),
                    'start_time': start_time_utc,  # UTC時刻で返却
                    'end_time': end_time_utc,      # UTC時刻で返却
                    'granularity': request.granularity,
                    'place_id': item.get('place_id'),
                    'camera_id': item.get('camera_id')
                })
        
        logger.debug(f" Returning {len(all_data)} data points")
        return TimeseriesDataResponse(
            data=all_data,
            metadata={
                'granularity': request.granularity,
                'start_time': start_time.isoformat().split('+')[0] if start_time.tzinfo else start_time.isoformat(),
                'end_time': end_time.isoformat().split('+')[0] if end_time.tzinfo else end_time.isoformat(),
                'place_id': request.place_id,
                'camera_id': request.camera_id,
                'tag_count': len(request.tags),
                'custom_time_range': bool(request.start_time and request.end_time)
            }
        )
        
    except ClientError as e:
        logger.debug(f" ClientError in timeseries: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    except Exception as e:
        logger.debug(f" Exception in timeseries: {str(e)}")
        import traceback
        logger.debug(f" Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@router.post("/detail-logs", response_model=DetailLogsResponse)
async def get_detail_logs(
    request: DetailLogsRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    指定された時間帯の詳細検出ログを取得（OpenSearch経由で効率的に検索）
    """
    try:
        # search.pyのsearch_notifications関数を使用
        
        # リクエストの時間範囲をJSTとして処理（既にJST形式で送信される）
        start_date_jst = request.start_time  # JST形式の文字列
        end_date_jst = request.end_time
        logger.debug(f" Detail logs time range (JST): {start_date_jst} to {end_date_jst}")
        logger.debug(f" Raw request times - start: {request.start_time}, end: {request.end_time}")
        
        # OpenSearchのデータはJSTなので、UTC変換せずにJST時間のまま検索
        # convert_to_iso_format関数はUTC変換を行う可能性があるため、直接文字列を使用
        search_request = SearchRequest(
            query=None,  # テキスト検索は使用しない
            tags=[request.tag_name],  # タグでフィルタリング
            tag_search_mode="AND",  # 指定されたタグを含む
            page=1,
            limit=1000,  # 十分大きな値を設定（必要に応じて調整）
            place_id=request.place_id,
            camera_id=request.camera_id,
            collector=None,
            file_type=None,
            detector=None,
            detect_notify_flg=None,
            start_date=start_date_jst,  # JST時間のまま使用
            end_date=end_date_jst      # JST時間のまま使用
        )
        
        # search_notifications関数を呼び出し
        search_result = await search_notifications(search_request, current_user)
        
        # 結果をDetailLogsResponseの形式に変換
        logs = []
        for result in search_result["results"]:
            logs.append({
                'detect_log_id': result.get('detect_log_id'),
                'detector_id': result.get('detector_id'),
                'file_id': result.get('file_id'),
                's3path': result.get('s3path'),
                'presigned_url': result.get('presigned_url'),
                'collector': result.get('collector'),
                'collector_id': result.get('collector_id'),  # ← 追加
                'start_time': result.get('start_time'),
                'end_time': result.get('end_time'),
                'detect_result': result.get('detect_result'),
                'detect_tag': result.get('detect_tag'),
                'detect_notify_flg': result.get('detect_notify_flg'),
                'detect_notify_reason': result.get('detect_notify_reason'),
                'place_id': result.get('place_id'),
                'place_name': result.get('place_name'),
                'camera_id': result.get('camera_id'),
                'camera_name': result.get('camera_name'),
                'file_type': result.get('file_type'),
                'detector': result.get('detector')
            })
        
        return DetailLogsResponse(
            logs=logs,
            total_count=search_result["total_count"]
        )
        
    except Exception as e:
        logger.debug(f" Exception in get_detail_logs: {str(e)}")
        import traceback
        logger.debug(f" Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}") 