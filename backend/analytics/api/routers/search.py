from fastapi import APIRouter, HTTPException, Depends
from typing import List, Optional, Dict, Any
from pydantic import BaseModel
from opensearchpy import OpenSearch, RequestsHttpConnection
from requests_aws4auth import AWS4Auth
import json
import os
from shared.common import *
from shared.auth import get_current_user

router = APIRouter()

class SearchRequest(BaseModel):
    query: Optional[str] = None
    tags: Optional[List[str]] = None
    tag_search_mode: str = "AND"  # "AND" or "OR"
    page: int = 1
    limit: int = 20
    
    # フィルター条件
    place_id: Optional[str] = None
    camera_id: Optional[str] = None
    collector: Optional[str] = None
    file_type: Optional[str] = None  # "image" or "video"
    detector: Optional[str] = None
    detect_notify_flg: Optional[str] = None  # "", "true", "false"
    start_date: Optional[str] = None  # YYYYMMDD、YYYYMMDDHH、YYYYMMDDHHMI
    end_date: Optional[str] = None    # YYYYMMDD、YYYYMMDDHH、YYYYMMDDHHMI

class SearchResponse(BaseModel):
    results: List[Dict[str, Any]]
    pagination: Dict[str, Any]
    total_count: int

# OpenSearch Serverless クライアント初期化
def get_opensearch_client():
    endpoint = os.environ.get('AOSS_COLLECTION_ENDPOINT')
    if not endpoint:
        raise ValueError("AOSS_COLLECTION_ENDPOINT environment variable is not set")
    
    # httpsプレフィックスを除去
    host = endpoint.replace('https://', '').replace('http://', '')

    service = 'aoss'
    
    # AWS認証情報の設定
    session = create_boto3_session()
    credentials = session.get_credentials()
    awsauth = AWS4Auth(credentials.access_key, credentials.secret_key, REGION, service, session_token=credentials.token)
    
    return OpenSearch(
        hosts=[{'host': host, 'port': 443}],
        http_auth=awsauth,
        use_ssl=True,
        verify_certs=True,
        connection_class=RequestsHttpConnection,
        timeout=30
    )

# 日時フォーマット変換ヘルパー関数
def convert_to_iso_format(date_str: str, is_end_date: bool = False) -> Optional[str]:
    """
    YYYYMMDD、YYYYMMDDHH、YYYYMMDDHHMI、YYYYMMDDHHMI形式をUTC ISO形式に変換
    
    入力: UTC時刻（YYYYMMDD、YYYYMMDDHH、YYYYMMDDHHMI形式）
    出力: UTC時刻（ISO 8601形式、タイムゾーン情報なし）
    
    例: '20251118' (UTC 2025-11-18) → '2025-11-18T00:00:00' (UTC)
    
    注意: API仕様変更により、入力はUTC時刻として扱います
    """
    try:
        date_str = date_str.strip()
        
        # 既にISO形式の場合（T が含まれている）
        if "T" in date_str:
            # ミリ秒を削除
            if "." in date_str:
                date_str = date_str.split(".")[0]
            # Z や +09:00 などのタイムゾーン情報を削除
            if "Z" in date_str:
                date_str = date_str.replace("Z", "")
            elif "+" in date_str:
                date_str = date_str.split("+")[0]
            elif date_str.count("-") > 2:  # -09:00 形式
                parts = date_str.split("-")
                if len(parts) > 3:
                    date_str = "-".join(parts[:3])
            # 既にUTCなのでそのまま返す
            return date_str
        
        # YYYYMMDD、YYYYMMDDHH、YYYYMMDDHHMI形式をUTC ISO形式に変換
        utc_iso = None
        if len(date_str) == 8:  # YYYYMMDD
            year = date_str[:4]
            month = date_str[4:6]
            day = date_str[6:8]
            if is_end_date:
                utc_iso = f"{year}-{month}-{day}T23:59:59"
            else:
                utc_iso = f"{year}-{month}-{day}T00:00:00"
                
        elif len(date_str) == 10:  # YYYYMMDDHH
            year = date_str[:4]
            month = date_str[4:6]
            day = date_str[6:8]
            hour = date_str[8:10]
            if is_end_date:
                utc_iso = f"{year}-{month}-{day}T{hour}:59:59"
            else:
                utc_iso = f"{year}-{month}-{day}T{hour}:00:00"
                
        elif len(date_str) == 12:  # YYYYMMDDHHMI
            year = date_str[:4]
            month = date_str[4:6]
            day = date_str[6:8]
            hour = date_str[8:10]
            minute = date_str[10:12]
            if is_end_date:
                utc_iso = f"{year}-{month}-{day}T{hour}:{minute}:59"
            else:
                utc_iso = f"{year}-{month}-{day}T{hour}:{minute}:00"
                
        elif len(date_str) == 14:  # YYYYMMDDHHMISC
            year = date_str[:4]
            month = date_str[4:6]
            day = date_str[6:8]
            hour = date_str[8:10]
            minute = date_str[10:12]
            second = date_str[12:14]
            utc_iso = f"{year}-{month}-{day}T{hour}:{minute}:{second}"
        
        if utc_iso:
            print(f"Date conversion: UTC input → UTC ISO {utc_iso}")
            return utc_iso
            
        return None
        
    except Exception as e:
        print(f"Date conversion error: {str(e)}")
        return None

@router.post("/")
async def search_notifications(
    request: SearchRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    シンプルなフルテキスト検索
    """
    try:
        # デバッグログを追加
        print(f"=== Search Request Debug ===")
        print(f"Query: {request.query}")
        print(f"Tags: {request.tags}")
        print(f"Tag Search Mode: {request.tag_search_mode}")
        print(f"Place ID: {request.place_id}")
        print(f"Camera ID: {request.camera_id}")
        print(f"Collector: {request.collector}")
        print(f"File Type: {request.file_type}")
        print(f"Detector: {request.detector}")
        print(f"Notify Flag: {request.detect_notify_flg}")
        print(f"Start Date: {request.start_date}")
        print(f"End Date: {request.end_date}")
        print(f"Page: {request.page}, Limit: {request.limit}")
        print(f"===========================")
        
        client = get_opensearch_client()
        
        # まず接続テスト用の全件検索を実行（デバッグ用）
        try:
            test_query = {
                "query": {"match_all": {}},
                "size": 1
            }
            test_response = client.search(index=DETECT_LOG_TABLE, body=test_query)
            print(f"=== Connection Test ===")
            print(f"Total documents in index: {test_response['hits']['total']['value']}")
            if test_response['hits']['hits']:
                sample_doc = test_response['hits']['hits'][0]['_source']
                print(f"Sample document fields: {list(sample_doc.keys())}")
                print(f"Sample camera_id: {sample_doc.get('camera_id')}")
                print(f"Sample place_id: {sample_doc.get('place_id')}")
                print(f"Sample detector: {sample_doc.get('detector')}")
                print(f"Sample collector: {sample_doc.get('collector')}")
                print(f"Sample file_type: {sample_doc.get('file_type')}")
            print(f"======================")
        except Exception as e:
            print(f"Connection test failed: {str(e)}")
            raise HTTPException(status_code=500, detail=f"OpenSearch接続エラー: {str(e)}")
        
        # 基本クエリ構造
        search_query = {
            "query": {
                "bool": {
                    "must": [],
                    "filter": []
                }
            },
            "sort": [{"start_time": {"order": "desc"}}],
            "from": (request.page - 1) * request.limit,
            "size": request.limit
        }
        
        # 条件が何もない場合はmatch_allを使用
        has_any_condition = False
        
        # フルテキスト検索（曖昧検索）
        if request.query and request.query.strip():
            has_any_condition = True
            search_query["query"]["bool"]["must"].append({
                "multi_match": {
                    "query": request.query.strip(),
                    "fields": [
                        "place_name^2",
                        "camera_name^2", 
                        "detect_result^3",
                        "detect_notify_reason^3",
                        "detect_tag^2"
                    ],
                    "type": "best_fields",
                    "operator": "or",
                    "fuzziness": "AUTO"
                }
            })
            print(f"Added text search: {request.query.strip()}")
        
        # タグフィルター（AND/OR対応）- .keywordフィールドで完全一致
        if request.tags and len(request.tags) > 0:
            has_any_condition = True
            if request.tag_search_mode == "AND":
                # すべてのタグを含む（完全一致）
                for tag in request.tags:
                    search_query["query"]["bool"]["filter"].append({
                        "term": {"detect_tag.keyword": tag}
                    })
                    print(f"Added AND tag filter: detect_tag.keyword = {tag}")
            else:  # OR
                # いずれかのタグを含む（完全一致）
                search_query["query"]["bool"]["filter"].append({
                    "terms": {"detect_tag.keyword": request.tags}
                })
                print(f"Added OR tag filter: detect_tag.keyword in {request.tags}")
        
        # 各種フィルター - .keywordフィールドで完全一致
        filters = [
            ("place_id.keyword", request.place_id),
            ("camera_id.keyword", request.camera_id),
            ("collector.keyword", request.collector),
            ("file_type.keyword", request.file_type),
            ("detector.keyword", request.detector)
        ]
        
        for field, value in filters:
            if value:
                has_any_condition = True
                search_query["query"]["bool"]["filter"].append({
                    "term": {field: value}
                })
                print(f"Added exact match filter: {field} = {value}")
        
        # 通知フラグフィルター - .keywordなしで検索
        if request.detect_notify_flg:
            has_any_condition = True
            
            # デバッグ: 通知フラグフィールドの実際の値を確認
            try:
                debug_query = {
                    "query": {"match_all": {}},
                    "size": 3,
                    "_source": ["detect_notify_flg"]
                }
                debug_response = client.search(index=DETECT_LOG_TABLE, body=debug_query)
                print(f"=== Notify Flag Debug ===")
                for hit in debug_response['hits']['hits']:
                    notify_flag = hit['_source'].get('detect_notify_flg')
                    print(f"Sample notify_flag value: '{notify_flag}' (type: {type(notify_flag)})")
                print(f"========================")
            except Exception as e:
                print(f"Debug query failed: {str(e)}")
            
            notify_value = request.detect_notify_flg.lower()
            
            # 修正：.keywordなしで直接検索
            print(f"Using direct field: detect_notify_flg = '{notify_value}'")
            search_query["query"]["bool"]["filter"].append({
                "term": {"detect_notify_flg": notify_value}  # .keywordを削除
            })
            
            print(f"Added exact match notify flag filter: detect_notify_flg = {notify_value}")
        
        # 日時範囲フィルター（範囲検索）
        if request.start_date or request.end_date:
            has_any_condition = True
            range_filter = {"range": {"start_time": {}}}
            
            if request.start_date:
                start_iso = convert_to_iso_format(request.start_date)
                if start_iso:
                    range_filter["range"]["start_time"]["gte"] = start_iso
                    print(f"Added start date filter: start_time >= {start_iso}")
            
            if request.end_date:
                end_iso = convert_to_iso_format(request.end_date, is_end_date=True)
                if end_iso:
                    range_filter["range"]["start_time"]["lte"] = end_iso
                    print(f"Added end date filter: start_time <= {end_iso}")
            
            if range_filter["range"]["start_time"]:
                search_query["query"]["bool"]["filter"].append(range_filter)
        
        # 条件が何もない場合はmatch_allに変更
        if not has_any_condition:
            search_query["query"] = {"match_all": {}}
            print("No conditions specified, using match_all query")
        
        print(f"=== Final OpenSearch Query ===")
        print(f"{json.dumps(search_query, indent=2, ensure_ascii=False)}")
        print(f"==============================")
        
        # 検索実行
        response = client.search(
            index=DETECT_LOG_TABLE,
            body=search_query
        )
        
        print(f"=== Search Response Stats ===")
        print(f"Query took: {response.get('took')} ms")
        print(f"Total hits: {response['hits']['total']['value']}")
        print(f"Returned hits: {len(response['hits']['hits'])}")
        print(f"=============================")
        
        # 結果整形
        results = []
        for hit in response['hits']['hits']:
            source = hit['_source']
            
            # detect_tagの処理
            detect_tags = source.get('detect_tag', [])
            if isinstance(detect_tags, set):
                detect_tags = list(detect_tags)
            elif not isinstance(detect_tags, list):
                detect_tags = [detect_tags] if detect_tags else []
            
            # presigned URL生成
            presigned_url = None
            if source.get('s3path'):
                try:
                    from shared.url_generator import generate_presigned_url
                    presigned_url = generate_presigned_url(source['s3path'], expiration=3600)
                    print(f"Generated presigned URL for {source.get('file_id', 'unknown')}: {presigned_url[:100] if presigned_url else 'None'}...")
                except Exception as e:
                    print(f"Error generating presigned URL for {source.get('file_id', 'unknown')}: {e}")
            
            # UTC時刻をそのまま返却（API仕様変更: 全てUTC）
            start_time_utc = source.get('start_time')
            end_time_utc = source.get('end_time')
            
            results.append({
                'detect_log_id': source.get('detect_log_id'),
                'detector_id': source.get('detector_id'),
                'file_id': source.get('file_id'),
                's3path': source.get('s3path'),
                'presigned_url': presigned_url,
                'collector': source.get('collector'),
                'collector_id': source.get('collector_id'),  # ← 追加
                'start_time': start_time_utc,  # UTC時刻で返却
                'end_time': end_time_utc,      # UTC時刻で返却
                'detect_result': source.get('detect_result'),
                'detect_tag': detect_tags,
                'detect_notify_flg': source.get('detect_notify_flg'),
                'detect_notify_reason': source.get('detect_notify_reason'),
                'place_id': source.get('place_id'),
                'place_name': source.get('place_name'),
                'camera_id': source.get('camera_id'),
                'camera_name': source.get('camera_name'),
                'file_type': source.get('file_type'),
                'detector': source.get('detector'),
                '_score': hit.get('_score', 0)
            })
        
        total_count = response['hits']['total']['value']
        total_pages = (total_count + request.limit - 1) // request.limit
        
        print(f"Search completed. Total count: {total_count}, Results: {len(results)}")
        
        return {
            "results": results,
            "pagination": {
                'current_page': request.page,
                'total_pages': total_pages,
                'total_count': total_count,
                'has_next': request.page < total_pages,
                'has_prev': request.page > 1
            },
            "total_count": total_count
        }
        
    except Exception as e:
        print(f"Search error: {str(e)}")
        print(f"Error type: {type(e).__name__}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"検索エラー: {str(e)}")

@router.get("/tags")
async def get_available_tags(
    current_user: dict = Depends(get_current_user)
):
    """
    DETECT_LOG_TAG_TABLE テーブルからタグ一覧を取得（data_type = "TAG"でquery）
    """
    try:
        session = create_boto3_session()
        dynamodb = session.resource('dynamodb')
        
        # DETECT_LOG_TAG_TABLE テーブルから取得（data_type = "TAG"でquery）
        tag_table = dynamodb.Table(DETECT_LOG_TAG_TABLE)
        response = tag_table.query(
            KeyConditionExpression='data_type = :dt',
            ExpressionAttributeValues={':dt': 'TAG'}
        )
        
        # ページネーション対応
        items = response.get('Items', [])
        while 'LastEvaluatedKey' in response:
            response = tag_table.query(
                KeyConditionExpression='data_type = :dt',
                ExpressionAttributeValues={':dt': 'TAG'},
                ExclusiveStartKey=response['LastEvaluatedKey']
            )
            items.extend(response.get('Items', []))
        
        tags = []
        for item in items:
            tag_name = item.get('detect_tag_name')
            if tag_name:
                tags.append(tag_name)
        
        print(f"Tags retrieved from DynamoDB: {len(tags)} tags")
        return {"tags": sorted(tags)}
        
    except Exception as e:
        print(f"Tags error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"タグ取得エラー: {str(e)}")

@router.get("/search-options")
async def get_search_options(
    current_user: dict = Depends(get_current_user)
):
    """
    検索に必要な選択肢を取得
    """
    try:
        session = create_boto3_session()
        dynamodb = session.resource('dynamodb')
        
        # 場所一覧を取得
        place_table = dynamodb.Table(PLACE_TABLE)
        places_response = place_table.scan()
        places = []
        for item in places_response.get('Items', []):
            places.append({
                'place_id': item.get('place_id'),
                'name': item.get('name')  # place_name → name
            })
        
        # カメラ一覧を取得
        camera_table = dynamodb.Table(CAMERA_TABLE)
        cameras_response = camera_table.scan()
        cameras = []
        for item in cameras_response.get('Items', []):
            cameras.append({
                'camera_id': item.get('camera_id'),
                'name': item.get('name'),  # camera_name → name
                'place_id': item.get('place_id')
            })
        
        # コレクター・検出器は固定値（APIから提供）
        # 全てのコレクターを含める（フロントエンドでカメラtype別フィルタリング）
        collectors = ["hlsRec", "hlsYolo", "s3Rec"]
        detectors = ["bedrock"]
        
        print(f"Search options retrieved - Places: {len(places)}, Cameras: {len(cameras)}, Collectors: {len(collectors)}, Detectors: {len(detectors)}")
        
        return {
            "places": places,
            "cameras": cameras,
            "collectors": collectors,      # 固定値だがAPIで提供
            "detectors": detectors,        # 固定値だがAPIで提供
            "file_types": ["image", "video"]  # 固定値だがAPIで提供
        }
        
    except Exception as e:
        print(f"Search options error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"検索オプション取得エラー: {str(e)}") 