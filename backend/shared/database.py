from boto3.dynamodb.conditions import Key, Attr
import uuid
import logging
from datetime import datetime
from decimal import Decimal
from .common import *

logger = logging.getLogger(__name__)
from .timezone_utils import (
    parse_display_str, format_for_display, 
    db_str_to_display_str, display_str_to_db_str
)

# Initialize DynamoDB client
session = create_boto3_session()
dynamodb = session.resource('dynamodb')

# テーブル名はcommon.pyから取得

# DynamoDB utility functions
def convert_floats_to_decimals(obj):
    """
    再帰的にfloat型をDecimal型に変換
    DynamoDBはfloat型をサポートしていないため、数値データを保存する前に変換が必要
    
    Args:
        obj: 変換対象のオブジェクト（dict, list, float, その他）
    
    Returns:
        変換後のオブジェクト
    """
    if isinstance(obj, float):
        # floatをDecimalに変換（文字列経由で精度を維持）
        return Decimal(str(obj))
    elif isinstance(obj, dict):
        # 辞書の各値を再帰的に変換
        return {k: convert_floats_to_decimals(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        # リストの各要素を再帰的に変換
        return [convert_floats_to_decimals(item) for item in obj]
    return obj

# Place (Place) operations
def get_all_places():
    """Get all places from the place table"""
    table = dynamodb.Table(PLACE_TABLE)
    response = table.scan()
    return response.get('Items', [])

def get_place(place_id):
    """Get a place by place_id"""
    table = dynamodb.Table(PLACE_TABLE)
    response = table.get_item(Key={'place_id': place_id})
    return response.get('Item')

def create_place(place_data):
    """Create a new place"""
    table = dynamodb.Table(PLACE_TABLE)
    table.put_item(Item=place_data)
    return place_data

def update_place(place_id, place_data):
    """Update a place"""
    table = dynamodb.Table(PLACE_TABLE)
    
    # DynamoDB reserved keywords that need to be escaped
    reserved_keywords = {'name', 'type', 'status', 'date', 'time', 'value', 'data'}
    
    # Build update expression
    update_expression = "SET "
    expression_attribute_values = {}
    expression_attribute_names = {}
    update_parts = []
    
    for key, value in place_data.items():
        if key != 'place_id':  # Skip primary key
            # Check if key is a reserved keyword
            if key.lower() in reserved_keywords:
                # Use ExpressionAttributeNames to escape reserved keywords
                placeholder = f"#{key}"
                expression_attribute_names[placeholder] = key
                update_parts.append(f"{placeholder} = :{key}")
            else:
                update_parts.append(f"{key} = :{key}")
            
            expression_attribute_values[f":{key}"] = value
    
    if not update_parts:
        return None
    
    update_expression += ", ".join(update_parts)
    
    # Update the item
    update_params = {
        'Key': {'place_id': place_id},
        'UpdateExpression': update_expression,
        'ExpressionAttributeValues': expression_attribute_values,
        'ReturnValues': "ALL_NEW"
    }
    
    # Only add ExpressionAttributeNames if we have reserved keywords
    if expression_attribute_names:
        update_params['ExpressionAttributeNames'] = expression_attribute_names
    
    response = table.update_item(**update_params)
    
    return response.get('Attributes')

def get_cameras_count_by_place(place_id):
    """Get the count of cameras associated with a place"""
    camera_table = dynamodb.Table(CAMERA_TABLE)
    response = camera_table.scan(
        FilterExpression=Attr('place_id').eq(place_id),
        Select='COUNT'
    )
    return response.get('Count', 0)

def delete_place(place_id, cascade=False):
    """Delete a place"""
    table = dynamodb.Table(PLACE_TABLE)
    
    # Check if the item exists first
    response = table.get_item(Key={'place_id': place_id})
    if 'Item' not in response:
        return False
    
    # Delete the item
    table.delete_item(Key={'place_id': place_id})
    
    if cascade:
        # Find and delete related cameras
        camera_table = dynamodb.Table(CAMERA_TABLE)
        response = camera_table.scan(
            FilterExpression=Attr('place_id').eq(place_id)
        )
        
        for camera in response.get('Items', []):
            camera_id = camera['camera_id']
            camera_table.delete_item(Key={'camera_id': camera_id})
            
            # Delete related collectors
            delete_camera_collectors_for_camera(camera_id)
            
            # Delete related files
            delete_files_for_camera(camera_id)
    
    return True

# Camera operations
def get_all_cameras():
    """Get all cameras from the camera table"""
    table = dynamodb.Table(CAMERA_TABLE)
    response = table.scan()
    return response.get('Items', [])

def get_cameras_by_place(place_id):
    """Get cameras by place_id"""
    table = dynamodb.Table(CAMERA_TABLE)
    response = table.scan(
        FilterExpression=Attr('place_id').eq(place_id)
    )
    return response.get('Items', [])

def get_camera(camera_id):
    """Get a camera by camera_id"""
    table = dynamodb.Table(CAMERA_TABLE)
    response = table.get_item(Key={'camera_id': camera_id})
    return response.get('Item')

def create_camera(camera_data):
    """Create a new camera"""
    table = dynamodb.Table(CAMERA_TABLE)
    table.put_item(Item=camera_data)
    return camera_data

def update_camera(camera_id, camera_data):
    """Update a camera"""
    table = dynamodb.Table(CAMERA_TABLE)
    
    # DynamoDB予約語リスト（必要に応じて追加）
    RESERVED_WORDS = {"name", "type"}
    
    update_expression = "SET "
    expression_attribute_values = {}
    expression_attribute_names = {}
    update_parts = []
    
    for key, value in camera_data.items():
        if key != 'camera_id':  # Skip primary key
            if key in RESERVED_WORDS:
                alias = f"#{key}"
                update_parts.append(f"{alias} = :{key}")
                expression_attribute_names[alias] = key
            else:
                update_parts.append(f"{key} = :{key}")
            expression_attribute_values[f":{key}"] = value
    
    if not update_parts:
        return None
    
    update_expression += ", ".join(update_parts)
    
    update_kwargs = {
        'Key': {'camera_id': camera_id},
        'UpdateExpression': update_expression,
        'ExpressionAttributeValues': expression_attribute_values,
        'ReturnValues': "ALL_NEW"
    }
    if expression_attribute_names:
        update_kwargs['ExpressionAttributeNames'] = expression_attribute_names
    
    response = table.update_item(**update_kwargs)
    
    return response.get('Attributes')

def delete_camera(camera_id, cascade=False):
    """Delete a camera"""
    table = dynamodb.Table(CAMERA_TABLE)
    
    # Check if the item exists first
    response = table.get_item(Key={'camera_id': camera_id})
    if 'Item' not in response:
        return False
    
    # Delete the item
    table.delete_item(Key={'camera_id': camera_id})
    
    # Delete related collectors
    delete_camera_collectors_for_camera(camera_id)
    
    # Delete related files if requested
    if cascade:
        delete_files_for_camera(camera_id)
    
    return True

# File operations
def get_file(file_id):
    """Get a file by file_id"""
    table = dynamodb.Table(FILE_TABLE)
    response = table.get_item(Key={'file_id': file_id})
    return response.get('Item')

def get_files_by_camera(camera_id, collector_id=None, file_type=None, start_date=None, end_date=None):
    """Get files by camera_id and optionally collector_id and file_type
    
    Args:
        camera_id: Camera ID
        collector_id: Collector ID (UUID, optional)
        file_type: File type (optional)
        start_date: Start date for filtering (optional)
        end_date: End date for filtering (optional)
    """
    table = dynamodb.Table(FILE_TABLE)
    
    try:
        if collector_id and file_type:
            collector_id_file_type = f"{collector_id}|{file_type}"
            
            if start_date and end_date:
                # Query with date range
                response = table.query(
                    IndexName='globalindex1',
                    KeyConditionExpression=Key('collector_id_file_type').eq(collector_id_file_type) &
                                         Key('start_time').between(start_date, end_date)
                )
            else:
                # Query all files for collector and file_type
                response = table.query(
                    IndexName='globalindex1',
                    KeyConditionExpression=Key('collector_id_file_type').eq(collector_id_file_type)
                )
        elif collector_id:
            # collector_idが指定されているがfile_typeが指定されていない場合、両方のfile_typeを検索
            image_key = f"{collector_id}|image"
            video_key = f"{collector_id}|video"
            
            items = []
            for key in [image_key, video_key]:
                if start_date and end_date:
                    response = table.query(
                        IndexName='globalindex1',
                        KeyConditionExpression=Key('collector_id_file_type').eq(key) &
                                             Key('start_time').between(start_date, end_date)
                    )
                else:
                    response = table.query(
                        IndexName='globalindex1',
                        KeyConditionExpression=Key('collector_id_file_type').eq(key)
                    )
                items.extend(response.get('Items', []))
            
            return items
        else:
            # Query all files for camera using GSI-3
            if start_date and end_date:
                response = table.query(
                    IndexName='globalindex3',
                    KeyConditionExpression=Key('camera_id').eq(camera_id) &
                                   Key('start_time').between(start_date, end_date)
                )
            else:
                response = table.query(
                    IndexName='globalindex3',
                    KeyConditionExpression=Key('camera_id').eq(camera_id)
                )
        
        return response.get('Items', [])
    except Exception as e:
        print(f"Error getting files by camera: {e}")
        return []

def check_detect_logs_exist(file_ids, detector_id=None):
    """
    Check if detect logs exist for given file_ids using GSI-4
    
    Args:
        file_ids: List of file IDs to check
        detector_id: Optional detector_id to filter by
        
    Returns:
        dict: {file_id: bool} dictionary indicating whether detect logs exist
    """
    if not file_ids:
        return {}
    
    # detector_idがない場合は全てFalseを返す
    if not detector_id:
        return {file_id: False for file_id in file_ids}
    
    detect_log_table = dynamodb.Table(DETECT_LOG_TABLE)
    result = {}
    
    try:
        for file_id in file_ids:
            try:
                # Use GSI-4 (file_id as PK, detector_id as SK) with detector_id filter
                response = detect_log_table.query(
                    IndexName='globalindex4',
                    KeyConditionExpression=Key('file_id').eq(file_id) & Key('detector_id').eq(detector_id),
                    Limit=1,  # We only need to know if at least one exists
                    ProjectionExpression='file_id'  # Minimize data transfer
                )
                
                result[file_id] = len(response.get('Items', [])) > 0
                
            except Exception as e:
                print(f"Warning: Error checking detect log for file_id={file_id}, detector_id={detector_id}: {e}")
                result[file_id] = False
        
        return result
        
    except Exception as e:
        print(f"Error in check_detect_logs_exist: {e}")
        # Return False for all file_ids on error
        return {file_id: False for file_id in file_ids}

def check_detect_logs_exist_by_time_range(collector_id, file_type, start_time, end_time, detector_id=None):
    """
    Check if detect logs exist for given time range using GSI-5
    
    Args:
        collector_id: Collector UUID
        file_type: 'image' or 'video' (not used with GSI-5, kept for backward compatibility)
        start_time: ISO 8601 format in UTC without timezone (e.g., '2025-11-18T01:00:00')
        end_time: ISO 8601 format in UTC without timezone (e.g., '2025-11-18T01:59:59')
        detector_id: detector_id to filter by (required for GSI-5)
        
    Returns:
        dict: {minute: bool} - minute (0-59) mapped to has_detect flag
        
    Note:
        - GSI-5を使用: collector_id_detector_id (PK) + start_time (SK)
        - detector_idで直接クエリするため、Pythonフィルタリング不要
        - KEYS_ONLYなのでRCU消費が大幅に削減される
        - minuteを抽出する際はJST時刻に変換してから行う
    """
    # detector_idがない場合は空の辞書を返す
    if not detector_id:
        return {}
    
    detect_log_table = dynamodb.Table(DETECT_LOG_TABLE)
    collector_id_detector_id = f"{collector_id}|{detector_id}"  # GSI-5用キー
    
    try:
        print(f"check_detect_logs_exist_by_time_range: UTC {start_time} to {end_time}, detector_id={detector_id}")
        print(f"check_detect_logs_exist_by_time_range: Querying GSI-5 with collector_id_detector_id={collector_id_detector_id}")
        
        # ✅ GSI-5を使用してクエリ（ページネーション対応）
        items = []
        last_evaluated_key = None
        
        while True:
            query_params = {
                'IndexName': 'globalindex5',
                'KeyConditionExpression': Key('collector_id_detector_id').eq(collector_id_detector_id) &
                                         Key('start_time').between(start_time, end_time),
                'ProjectionExpression': 'start_time',  # KEYS_ONLYなのでstart_timeのみ
            }
            
            if last_evaluated_key:
                query_params['ExclusiveStartKey'] = last_evaluated_key
            
            response = detect_log_table.query(**query_params)
            items.extend(response.get('Items', []))
            
            last_evaluated_key = response.get('LastEvaluatedKey')
            if not last_evaluated_key:
                break
        
        print(f"check_detect_logs_exist_by_time_range: Query returned {len(items)} items")
        
        # 分単位で集計（UTC → JST変換してminuteを抽出）
        minute_detect_map = {}
        from .timezone_utils import parse_db_str, to_display_tz
        
        for item in items:
            if item.get('start_time'):
                try:
                    # DynamoDBのstart_timeはUTC文字列（タイムゾーン情報なし）
                    start_time_str = item['start_time']
                    dt_utc = parse_db_str(start_time_str)
                    dt_jst = to_display_tz(dt_utc)
                    
                    # Extract minute in JST
                    minute = dt_jst.minute
                    minute_detect_map[minute] = True
                except Exception as e:
                    print(f"Warning: Error parsing detect log time: {e}, start_time: {item.get('start_time')}")
        
        print(f"check_detect_logs_exist_by_time_range: Found detects in {len(minute_detect_map)} minutes: {sorted(minute_detect_map.keys())}")
        return minute_detect_map
        
    except Exception as e:
        print(f"Error checking detect logs by time range: {e}")
        import traceback
        traceback.print_exc()
        return {}

def get_files_by_datetime(camera_id, datetime_prefix, collector_id, file_type, include_presigned_url, include_detect_flag=False, detector_id=None):
    """Get files by camera_id and datetime prefix (YYYYMMDD or YYYYMMDDHH format)
    
    Args:
        camera_id: Camera ID
        datetime_prefix: Datetime prefix in YYYYMMDD, YYYYMMDDHH, or YYYYMMDDHHMM format
        collector_id: Collector ID (UUID, required)
        file_type: File type 'image' or 'video' (required)
        include_presigned_url: Whether to generate presigned URLs (required)
        include_detect_flag: Whether to include has_detect flag (default: False)
        detector_id: Optional detector_id to filter detect logs (default: None)
    
    Returns:
        List of file items
    """
    table = dynamodb.Table(FILE_TABLE)
    
    try:
        # Validate required parameters
        if not collector_id:
            raise ValueError("collector_id parameter is required")
        if not file_type:
            raise ValueError("file_type parameter is required")
        if file_type not in ['image', 'video']:
            raise ValueError("file_type must be 'image' or 'video'")
        
        # Convert datetime prefix to start and end times
        if len(datetime_prefix) == 8:  # YYYYMMDD
            start_time = f"{datetime_prefix[:4]}-{datetime_prefix[4:6]}-{datetime_prefix[6:8]}T00:00:00"
            end_time = f"{datetime_prefix[:4]}-{datetime_prefix[4:6]}-{datetime_prefix[6:8]}T23:59:59"
        elif len(datetime_prefix) == 10:  # YYYYMMDDHH
            start_time = f"{datetime_prefix[:4]}-{datetime_prefix[4:6]}-{datetime_prefix[6:8]}T{datetime_prefix[8:10]}:00:00"
            end_time = f"{datetime_prefix[:4]}-{datetime_prefix[4:6]}-{datetime_prefix[6:8]}T{datetime_prefix[8:10]}:59:59"
        elif len(datetime_prefix) == 12:  # YYYYMMDDHHMM
            start_time = f"{datetime_prefix[:4]}-{datetime_prefix[4:6]}-{datetime_prefix[6:8]}T{datetime_prefix[8:10]}:{datetime_prefix[10:12]}:00"
            end_time = f"{datetime_prefix[:4]}-{datetime_prefix[4:6]}-{datetime_prefix[6:8]}T{datetime_prefix[8:10]}:{datetime_prefix[10:12]}:59"
        else:
            print(f"Invalid datetime prefix format: {datetime_prefix}")
            return []
        
        # Use optimized GSI-1 query with collector_id_file_type
        collector_id_file_type = f"{collector_id}|{file_type}"
        
        response = table.query(
            IndexName='globalindex1',
            KeyConditionExpression=Key('collector_id_file_type').eq(collector_id_file_type) &
                                 Key('start_time').between(start_time, end_time)
        )
        items = response.get('Items', [])
        
        # Conditionally add presigned URLs based on include_presigned_url parameter
        if include_presigned_url:
            print(f"Processing {len(items)} items for presigned URL generation")
            for item in items:
                print(f"Processing item: {item.get('file_id', 'unknown')} with s3path: {item.get('s3path', 'none')}")
                if item.get('s3path'):
                    try:
                        # Extract bucket and key from s3path
                        s3path = item['s3path']
                        print(f"Generating presigned URL for s3path: {s3path}")
                        from .url_generator import generate_presigned_url
                        presigned_url = generate_presigned_url(s3path, expiration=3600)
                        item['presigned_url'] = presigned_url
                        print(f"Successfully generated presigned URL for {item.get('file_type', 'unknown')} file {item['file_id']}: {presigned_url[:100]}...")
                    except ValueError as ve:
                        print(f"Invalid S3 path format for {item.get('file_id', 'unknown')}: {ve}")
                    except Exception as e:
                        print(f"Error generating presigned URL for {item.get('file_id', 'unknown')}: {e}")
                        import traceback
                        traceback.print_exc()
                        # Continue processing other files even if one fails
                else:
                    print(f"Item {item.get('file_id', 'unknown')} has no s3path")
                
                # Generate presigned URL for s3path_detect if exists (for hlsYolo collector)
                if item.get('s3path_detect'):
                    try:
                        from .url_generator import generate_presigned_url
                        s3path_detect = item['s3path_detect']
                        presigned_url_detect = generate_presigned_url(s3path_detect, expiration=3600)
                        item['presigned_url_detect'] = presigned_url_detect
                        print(f"Successfully generated presigned URL for detect image {item['file_id']}")
                    except Exception as e:
                        print(f"Error generating presigned URL for detect image {item.get('file_id', 'unknown')}: {e}")
        else:
            print(f"Skipping presigned URL generation for {len(items)} items")
        
        # Conditionally add has_detect flag based on include_detect_flag parameter
        if include_detect_flag:
            print(f"Including has_detect flag with detector_id={detector_id}")
            file_ids = [item['file_id'] for item in items]
            
            if detector_id:
                # detector_idが指定されている場合、実際のdetect-logを検索
                detect_flags = check_detect_logs_exist(file_ids, detector_id)
                for item in items:
                    item['has_detect'] = detect_flags.get(item['file_id'], False)
                print(f"Added has_detect flags: {sum(1 for item in items if item.get('has_detect', False))} detected out of {len(items)}")
            else:
                # detector_idが未指定の場合、全てfalse
                for item in items:
                    item['has_detect'] = False
                print(f"Added has_detect flags: all False (no detector_id specified)")
        else:
            print(f"Skipping detect log check (include_detect_flag=False)")
        
        print(f"Returning {len(items)} items (include_presigned_url={include_presigned_url}, include_detect_flag={include_detect_flag}, detector_id={detector_id})")
        return items
        
    except Exception as e:
        print(f"Error getting files by datetime: {e}")
        return []

def create_file(file_data):
    """Create a new file record"""
    table = dynamodb.Table(FILE_TABLE)
    
    try:
        # Generate file_id if not provided
        if 'file_id' not in file_data:
            file_data['file_id'] = str(uuid.uuid4())
        
        # Set collector_id_file_type if collector_id and file_type are provided
        if 'collector_id' in file_data and 'file_type' in file_data:
            file_data['collector_id_file_type'] = f"{file_data['collector_id']}|{file_data['file_type']}"
        
        # Remove collector field if present (not stored in new design)
        file_data.pop('collector', None)
        
        table.put_item(Item=file_data)
        return file_data['file_id']
    except Exception as e:
        print(f"Error creating file: {e}")
        return None

def update_file(file_id, file_data):
    """Update an existing file record"""
    table = dynamodb.Table(FILE_TABLE)
    
    try:
        # Build update expression
        update_parts = []
        expression_attribute_values = {}
        
        # Remove collector field if present (not stored in new design)
        file_data.pop('collector', None)
        
        for key, value in file_data.items():
            if key != 'file_id':  # Skip primary key
                update_parts.append(f"{key} = :{key}")
                expression_attribute_values[f":{key}"] = value
        
        # Update collector_id_file_type if collector_id and file_type are in the data
        if 'collector_id' in file_data and 'file_type' in file_data:
            update_parts.append("collector_id_file_type = :collector_id_file_type")
            expression_attribute_values[":collector_id_file_type"] = f"{file_data['collector_id']}|{file_data['file_type']}"
        
        if not update_parts:
            return False
        
        update_expression = "SET " + ", ".join(update_parts)
        
        table.update_item(
            Key={'file_id': file_id},
            UpdateExpression=update_expression,
            ExpressionAttributeValues=expression_attribute_values
        )
        return True
    except Exception as e:
        print(f"Error updating file: {e}")
        return False

def delete_files_for_camera(camera_id, collector=None, file_type=None):
    """Delete all files for a specific camera and optionally collector and file_type"""
    table = dynamodb.Table(FILE_TABLE)
    
    try:
        if collector and file_type:
            # collector名からcollector_idを取得
            collector_info = get_camera_collector(camera_id, collector)
            if not collector_info:
                print(f"Collector not found: camera_id={camera_id}, collector={collector}")
                return 0
            
            collector_id = collector_info.get('collector_id')
            # collector_id + file_typeで検索
            collector_id_file_type = f"{collector_id}|{file_type}"
            
            response = table.query(
                IndexName='globalindex1',
                KeyConditionExpression=Key('collector_id_file_type').eq(collector_id_file_type)
            )
            items = response.get('Items', [])
        elif collector:
            # collector名からcollector_idを取得
            collector_info = get_camera_collector(camera_id, collector)
            if not collector_info:
                print(f"Collector not found: camera_id={camera_id}, collector={collector}")
                return 0
            
            collector_id = collector_info.get('collector_id')
            # collectorが指定されているがfile_typeが指定されていない場合、両方のfile_typeを検索
            image_key = f"{collector_id}|image"
            video_key = f"{collector_id}|video"
            
            items = []
            for key in [image_key, video_key]:
                response = table.query(
                    IndexName='globalindex1',
                    KeyConditionExpression=Key('collector_id_file_type').eq(key)
                )
                items.extend(response.get('Items', []))
        else:
            # camera_idで全ファイルを検索（GSI-3を使用）
            response = table.query(
                IndexName='globalindex3',
                KeyConditionExpression=Key('camera_id').eq(camera_id)
            )
            items = response.get('Items', [])
        
        # Delete each item
        for item in items:
            table.delete_item(Key={'file_id': item['file_id']})
        
        return len(items)
    except Exception as e:
        print(f"Error deleting files for camera: {e}")
        return 0

def delete_file(file_id):
    """Delete a single file by file_id"""
    table = dynamodb.Table(FILE_TABLE)
    
    try:
        # Check if the file exists first
        response = table.get_item(Key={'file_id': file_id})
        if 'Item' not in response:
            return False
        
        # Delete the file
        table.delete_item(Key={'file_id': file_id})
        return True
    except Exception as e:
        print(f"Error deleting file: {e}")
        return False

# Download operations
def get_file_for_download(file_id):
    """Get a file by file_id for download (supports both video and image files)"""
    print(f"get_file_for_download called with file_id: {file_id}")
    
    # First try to scan the table to see if the file exists at all
    table = dynamodb.Table(FILE_TABLE)
    scan_response = table.scan(
        FilterExpression=Attr('file_id').eq(file_id)
    )
    
    scan_items = scan_response.get('Items', [])
    print(f"Scan found {len(scan_items)} items with file_id {file_id}")
    for item in scan_items:
        print(f"Scan found item: {item}")
    
    # Now try the query
    response = table.query(
        KeyConditionExpression=Key('file_id').eq(file_id)
    )
    
    print(f"Query response: {response}")
    
    items = response.get('Items', [])
    print(f"Query found {len(items)} items with file_id {file_id}")
    
    if not items:
        # If query found nothing but scan did, there might be an issue with the table structure
        if scan_items:
            print(f"WARNING: Scan found items but query did not. Using first scan item.")
            items = scan_items
        else:
            print(f"No items found for file_id {file_id}")
            return None
    
    # Get the first item (should be only one with this file_id)
    file_item = items[0]
    
    # No restrictions on file type or collector - if file exists, allow download
    print(f"File found for download: {file_item.get('file_type', 'unknown')} from collector {file_item.get('collector', 'unknown')}")
    
    # If s3path exists, generate a pre-signed URL
    if file_item.get('s3path'):
        try:
            # Parse the S3 path to get bucket and key
            s3path = file_item.get('s3path')
            print(f"Processing S3 path: {s3path}")
            
            from .url_generator import generate_presigned_url
            presigned_url = generate_presigned_url(s3path, expiration=3600)
            print(f"Generated presigned URL: {presigned_url}")
            
            # Add the pre-signed URL to the file item
            file_item['presigned_url'] = presigned_url
        except Exception as e:
            print(f"Error generating pre-signed URL: {e}")
            # For testing, create a mock presigned URL
            file_item['presigned_url'] = f"https://mock-presigned-url.com/{file_id}"
    
    return file_item

# HLS URL operations
def get_hls_url(camera_id):
    """Get HLS URL for a camera"""
    print(f"[HLS] get_hls_url called for camera_id: {camera_id}")
    camera = get_camera(camera_id)
    if not camera:
        print(f"[HLS] Camera not found: {camera_id}")
        return None
    
    print(f"[HLS] Camera found. type={camera.get('type')}, stream_arn={camera.get('kinesis_streamarn')}")
    
    # Determine the HLS URL based on camera type
    if camera.get('type') == 'kinesis':
        stream_arn = camera.get('kinesis_streamarn')
        if stream_arn:
            print(f"[HLS] Attempting to get HLS URL for stream_arn: {stream_arn}")
            try:
                # カメラ情報からAWSキーとリージョンを取得
                access_key = None
                secret_key = None
                region_name = None
                
                if camera.get('type') == 'kinesis':
                    access_key = (camera.get('aws_access_key') or '').strip()
                    secret_key = (camera.get('aws_secret_access_key') or '').strip()
                    region_name = (camera.get('aws_region') or '').strip()
                    
                    # アクセスキーとシークレットキーは両方設定されている場合のみ使用
                    if not (access_key and secret_key):
                        access_key = None
                        secret_key = None
                    
                    # リージョンは単独でも使用可能
                    if not region_name:
                        region_name = None
                
                # 専用セッションまたはデフォルトセッションを作成
                kinesis_session = create_boto3_session(access_key, secret_key, region_name)
                
                # GetDataEndpoint APIでエンドポイントを取得
                kinesis_video = kinesis_session.client('kinesisvideo')
                endpoint_response = kinesis_video.get_data_endpoint(
                    APIName='GET_HLS_STREAMING_SESSION_URL',
                    StreamARN=stream_arn
                )
                endpoint = endpoint_response['DataEndpoint']
                
                # HLSストリーミングセッションURLを取得
                kinesis_video_archived = kinesis_session.client('kinesis-video-archived-media', endpoint_url=endpoint)
                print(f"[HLS] Calling get_hls_streaming_session_url...")
                hls_url = kinesis_video_archived.get_hls_streaming_session_url(
                    StreamARN=stream_arn,
                    PlaybackMode='LIVE'
                )
                
                print(f"[HLS] Successfully got HLS URL")
                return {
                    'camera_id': camera_id,
                    'url': hls_url['HLSStreamingSessionURL']
                }
            except Exception as e:
                print(f"[HLS] ERROR: Kinesis Video Streams URL取得中にエラーが発生しました: {e}")
                import traceback
                print(f"[HLS] ERROR Traceback: {traceback.format_exc()}")
                return None
        else:
            print(f"[HLS] stream_arn is empty for kinesis camera: {camera_id}")
            return None
    elif camera.get('type') == 'vsaas':
        device_id = camera.get('vsaas_device_id')
        if device_id:
            # For VSaaS cameras, you would use the VSaaS API to get the streaming URL
            return {
                'camera_id': camera_id,
                'url': f"https://vsaas-streaming-url/{device_id}/index.m3u8"
            }
    
    # Default mock URL if no specific URL can be determined
    print(f"[HLS] Returning default mock URL for camera_id: {camera_id}, type: {camera.get('type')}")
    return {
        'camera_id': camera_id,
        'url': f"https://streaming-url/{camera_id}/index.m3u8"
    }

# Camera Collector operations
def get_all_camera_collectors():
    """Get all camera collectors from the camera-collector table"""
    table = dynamodb.Table(CAMERA_COLLECTOR_TABLE)
    response = table.scan()
    return response.get('Items', [])

def get_camera_collectors_by_camera(camera_id):
    """Get camera collectors by camera_id using GSI-1"""
    table = dynamodb.Table(CAMERA_COLLECTOR_TABLE)
    response = table.query(
        IndexName='globalindex1',
        KeyConditionExpression=Key('camera_id').eq(camera_id)
    )
    return response.get('Items', [])

def get_collector_by_id(collector_id):
    """Get a camera collector by collector_id"""
    table = dynamodb.Table(CAMERA_COLLECTOR_TABLE)
    response = table.get_item(Key={'collector_id': collector_id})
    return response.get('Item')

def get_camera_collector(camera_id, collector_name):
    """Get a camera collector by camera_id and collector name (legacy support)"""
    table = dynamodb.Table(CAMERA_COLLECTOR_TABLE)
    response = table.query(
        IndexName='globalindex1',
        KeyConditionExpression=Key('camera_id').eq(camera_id)
    )
    items = response.get('Items', [])
    
    # Filter by collector name
    for item in items:
        if item.get('collector') == collector_name:
            return item
    return None

def create_camera_collector(collector_data):
    """Create a new camera collector"""
    import uuid
    table = dynamodb.Table(CAMERA_COLLECTOR_TABLE)
    
    # Generate collector_id if not provided
    if 'collector_id' not in collector_data:
        collector_data['collector_id'] = str(uuid.uuid4())
    
    # Float型をDecimal型に変換（DynamoDBの制約対応）
    collector_data = convert_floats_to_decimals(collector_data)
    
    table.put_item(Item=collector_data)
    return collector_data

def update_collector(collector_id, update_data):
    """Update a camera collector by collector_id"""
    table = dynamodb.Table(CAMERA_COLLECTOR_TABLE)
    
    # Check if the collector exists
    response = table.get_item(Key={'collector_id': collector_id})
    if 'Item' not in response:
        raise Exception(f"Camera collector not found: {collector_id}")
    
    # Float型をDecimal型に変換（DynamoDBの制約対応）
    update_data = convert_floats_to_decimals(update_data)
    
    # Build update expression
    update_expression = "SET "
    expression_values = {}
    expression_names = {}
    update_parts = []
    
    for key, value in update_data.items():
        # Skip primary key
        if key == 'collector_id':
            continue
            
        # Handle reserved keywords by using expression attribute names
        attr_name = f"#{key}"
        attr_value = f":{key}"
        
        update_parts.append(f"{attr_name} = {attr_value}")
        expression_names[attr_name] = key
        expression_values[attr_value] = value
    
    if not update_parts:
        raise Exception("No valid fields to update")
    
    update_expression += ", ".join(update_parts)
    
    # Update the item
    response = table.update_item(
        Key={'collector_id': collector_id},
        UpdateExpression=update_expression,
        ExpressionAttributeNames=expression_names,
        ExpressionAttributeValues=expression_values,
        ReturnValues="ALL_NEW"
    )
    
    return response['Attributes']

def delete_collector(collector_id):
    """Delete a camera collector by collector_id"""
    table = dynamodb.Table(CAMERA_COLLECTOR_TABLE)
    try:
        # Check if the collector exists
        response = table.get_item(Key={'collector_id': collector_id})
        if 'Item' not in response:
            return False
        table.delete_item(Key={'collector_id': collector_id})
        return True
    except Exception as e:
        print(f"Error deleting camera collector: {e}")
        return False

def delete_camera_collectors_for_camera(camera_id):
    """Delete all camera collectors for a specific camera"""
    table = dynamodb.Table(CAMERA_COLLECTOR_TABLE)
    
    try:
        # Get all collectors for the camera using GSI-1
        response = table.query(
            IndexName='globalindex1',
            KeyConditionExpression=Key('camera_id').eq(camera_id)
        )
        
        collectors = response.get('Items', [])
        
        # Delete each collector by collector_id
        for collector in collectors:
            collector_id = collector.get('collector_id')
            if collector_id:
                table.delete_item(Key={'collector_id': collector_id})
        
        return len(collectors)
    except Exception as e:
        print(f"Error deleting camera collectors for camera: {e}")
        return 0

def get_files_summary_by_hour(camera_id, datetime_prefix, collector_id=None, file_type=None, include_detect_flag=False, detector_id=None):
    """Get summary of files by camera_id and hour (YYYYMMDDHH format) - returns which minutes have data
    Optimized to use existing GSI-1 (collector_id_file_type + start_time)
    
    Args:
        camera_id: Camera ID
        datetime_prefix: YYYYMMDDHH format
        collector_id: Collector UUID (optional)
        file_type: 'image' or 'video' (optional)
        include_detect_flag: Whether to include has_detect flag (default: False)
        detector_id: Optional detector_id to filter detect logs (default: None)
    """
    table = dynamodb.Table(FILE_TABLE)
    
    try:
        # Validate datetime_prefix format (should be YYYYMMDDHH)
        if len(datetime_prefix) != 10:
            print(f"Invalid datetime prefix format for summary: {datetime_prefix}")
            return []
        
        # Convert datetime prefix to start and end times for the hour
        start_time = f"{datetime_prefix[:4]}-{datetime_prefix[4:6]}-{datetime_prefix[6:8]}T{datetime_prefix[8:10]}:00:00"
        end_time = f"{datetime_prefix[:4]}-{datetime_prefix[4:6]}-{datetime_prefix[6:8]}T{datetime_prefix[8:10]}:59:59"
        
        print(f"Getting file summary for hour {datetime_prefix}: {start_time} to {end_time}")
        
        items = []
        
        if collector_id and file_type:
            # Most common case: single query using GSI-1
            collector_id_file_type = f"{collector_id}|{file_type}"
            
            response = table.query(
                IndexName='globalindex1',
                KeyConditionExpression=Key('collector_id_file_type').eq(collector_id_file_type) &
                                     Key('start_time').between(start_time, end_time),
                ProjectionExpression='start_time',  # Minimal data transfer
                Select='SPECIFIC_ATTRIBUTES'
            )
            items = response.get('Items', [])
            
        elif collector_id:
            # Collector specified, search both image and video (2 queries)
            image_key = f"{collector_id}|image"
            video_key = f"{collector_id}|video"
            
            for key in [image_key, video_key]:
                response = table.query(
                    IndexName='globalindex1',
                    KeyConditionExpression=Key('collector_id_file_type').eq(key) &
                                         Key('start_time').between(start_time, end_time),
                    ProjectionExpression='start_time',
                    Select='SPECIFIC_ATTRIBUTES'
                )
                items.extend(response.get('Items', []))
                    
        else:
            # Fallback: use GSI-3 for camera-wide search
            response = table.query(
                IndexName='globalindex3',
                KeyConditionExpression=Key('camera_id').eq(camera_id) &
                                     Key('start_time').between(start_time, end_time),
                ProjectionExpression='start_time',
                Select='SPECIFIC_ATTRIBUTES'
            )
            items = response.get('Items', [])
        
        # Group by minute and return summary
        minute_summary = {}
        for item in items:
            if item.get('start_time'):
                try:
                    # Extract minute from start_time efficiently
                    time_part = item['start_time'][11:16]  # Extract HH:MM directly
                    minute = time_part[3:5]  # Extract MM
                    minute_key = f"{datetime_prefix}{minute}"  # YYYYMMDDHHMM format
                    
                    if minute_key not in minute_summary:
                        minute_summary[minute_key] = {
                            'datetime': minute_key,
                            'minute': int(minute),
                            'count': 0,
                            'has_detect': False  # 初期値
                        }
                    minute_summary[minute_key]['count'] += 1
                except Exception as e:
                    print(f"Error parsing time for summary: {e}")
        
        # ✅ Detect情報を取得（include_detect_flag=Trueの場合のみ）
        if include_detect_flag and collector_id and file_type:
            print(f"Including has_detect flag with detector_id={detector_id}")
            
            if detector_id:
                # detector_idが指定されている場合、実際のdetect-logを検索
                minute_detect_map = check_detect_logs_exist_by_time_range(
                    collector_id, file_type, start_time, end_time, detector_id
                )
                
                # 各分のhas_detectフラグを更新
                for minute_key, summary in minute_summary.items():
                    minute = summary['minute']
                    if minute in minute_detect_map:
                        summary['has_detect'] = True
                    else:
                        summary['has_detect'] = False
                
                print(f"Added has_detect flags: {sum(1 for s in minute_summary.values() if s.get('has_detect', False))} detected minutes")
            else:
                # detector_idが未指定の場合、全てfalse
                for minute_key, summary in minute_summary.items():
                    summary['has_detect'] = False
                print(f"Added has_detect flags: all False (no detector_id specified)")
        # include_detect_flag=Falseの場合、has_detectを追加しない（既存の動作）
        
        result = list(minute_summary.values())
        print(f"File summary result: {len(result)} minutes with data")
        return result
        
    except Exception as e:
        print(f"Error getting file summary by hour: {e}")
        return []

# Tag Category operations
def get_all_tag_categories():
    """Get all tag categories from the tag category table"""
    table = dynamodb.Table(TAG_CATEGORY_TABLE)
    response = table.scan()
    return response.get('Items', [])

def get_tag_category(tagcategory_id):
    """Get a tag category by tagcategory_id"""
    table = dynamodb.Table(TAG_CATEGORY_TABLE)
    response = table.get_item(Key={'tagcategory_id': tagcategory_id})
    return response.get('Item')

def create_tag_category(tag_category_data):
    """Create a new tag category"""
    table = dynamodb.Table(TAG_CATEGORY_TABLE)
    table.put_item(Item=tag_category_data)
    return tag_category_data

def update_tag_category(tagcategory_id, tag_category_data):
    """Update a tag category"""
    table = dynamodb.Table(TAG_CATEGORY_TABLE)
    
    # Build update expression
    update_expression = "SET "
    expression_attribute_values = {}
    update_parts = []
    
    for key, value in tag_category_data.items():
        if key != 'tagcategory_id':  # Skip primary key
            update_parts.append(f"{key} = :{key}")
            expression_attribute_values[f":{key}"] = value
    
    if not update_parts:
        return None
    
    update_expression += ", ".join(update_parts)
    
    # Update the item
    response = table.update_item(
        Key={'tagcategory_id': tagcategory_id},
        UpdateExpression=update_expression,
        ExpressionAttributeValues=expression_attribute_values,
        ReturnValues="ALL_NEW"
    )
    
    return response.get('Attributes')

def delete_tag_category(tagcategory_id, cascade=False):
    """Delete a tag category"""
    table = dynamodb.Table(TAG_CATEGORY_TABLE)
    
    # Check if the item exists first
    response = table.get_item(Key={'tagcategory_id': tagcategory_id})
    if 'Item' not in response:
        return False
    
    # Delete the item
    table.delete_item(Key={'tagcategory_id': tagcategory_id})
    
    if cascade:
        # Find and delete related tags using GSI-1
        tag_table = dynamodb.Table(TAG_TABLE)
        response = tag_table.query(
            IndexName='globalindex1',
            KeyConditionExpression=Key('tagcategory_id').eq(tagcategory_id)
        )
        
        for tag in response.get('Items', []):
            tag_id = tag['tag_id']
            tag_table.delete_item(Key={'tag_id': tag_id})
    
    return True

# Tag operations
def get_all_tags():
    """Get all tags from the tag table"""
    try:
        table = dynamodb.Table(TAG_TABLE)
        response = table.scan()
        return response.get('Items', [])
    except Exception as e:
        print(f"Error getting all tags: {e}")
        return []

def get_tags_by_category(tagcategory_id):
    """Get tags by tagcategory_id using GSI"""
    try:
        table = dynamodb.Table(TAG_TABLE)
        response = table.query(
            IndexName='globalindex1',
            KeyConditionExpression=Key('tagcategory_id').eq(tagcategory_id)
        )
        return response.get('Items', [])
    except Exception as e:
        print(f"Error getting tags by category {tagcategory_id}: {e}")
        return []

def get_tag_by_id(tag_id):
    """Get a tag by tag_id"""
    table = dynamodb.Table(TAG_TABLE)
    response = table.get_item(Key={'tag_id': tag_id})
    return response.get('Item')

def get_tag(tag_name):
    """Get a tag by tag_name using GSI-2"""
    try:
        table = dynamodb.Table(TAG_TABLE)
        response = table.query(
            IndexName='globalindex2',
            KeyConditionExpression=Key('tag_name').eq(tag_name)
        )
        items = response.get('Items', [])
        return items[0] if items else None
    except Exception as e:
        print(f"Error getting tag {tag_name}: {e}")
        # テーブルが存在しない場合やGSIが存在しない場合
        return None

def create_tag(tag_data):
    """Create a new tag"""
    try:
        table = dynamodb.Table(TAG_TABLE)
        
        # Generate unique tag_id if not provided
        if 'tag_id' not in tag_data:
            tag_data['tag_id'] = str(uuid.uuid4())
        
        # Clean the data to remove NULL/empty values that would cause GSI issues
        cleaned_data = {}
        for key, value in tag_data.items():
            if value is not None and value != "" and str(value).strip() != "":
                cleaned_data[key] = value
        
        table.put_item(Item=cleaned_data)
        return cleaned_data
    except Exception as e:
        print(f"Error creating tag: {e}")
        raise e

def update_tag(tag_name, tag_data):
    """Update a tag by tag_name"""
    # First, get the tag to find its tag_id
    existing_tag = get_tag(tag_name)
    if not existing_tag:
        return None
    
    tag_id = existing_tag['tag_id']
    return update_tag_by_id(tag_id, tag_data)

def update_tag_by_id(tag_id, tag_data):
    """Update a tag by tag_id"""
    table = dynamodb.Table(TAG_TABLE)
    
    # Build update expression
    update_expression = "SET "
    expression_attribute_values = {}
    update_parts = []
    
    for key, value in tag_data.items():
        if key != 'tag_id':  # Skip primary key
            # Skip NULL, None, or empty string values to avoid GSI issues
            if value is not None and value != "" and str(value).strip() != "":
                update_parts.append(f"{key} = :{key}")
                expression_attribute_values[f":{key}"] = value
    
    if not update_parts:
        return None
    
    update_expression += ", ".join(update_parts)
    
    # Update the item
    response = table.update_item(
        Key={'tag_id': tag_id},
        UpdateExpression=update_expression,
        ExpressionAttributeValues=expression_attribute_values,
        ReturnValues="ALL_NEW"
    )
    
    return response.get('Attributes')

def delete_tag(tag_name):
    """Delete a tag by tag_name"""
    # First, get the tag to find its tag_id
    existing_tag = get_tag(tag_name)
    if not existing_tag:
        return False
    
    tag_id = existing_tag['tag_id']
    return delete_tag_by_id(tag_id)

def delete_tag_by_id(tag_id):
    """Delete a tag by tag_id"""
    table = dynamodb.Table(TAG_TABLE)
    
    # Check if the item exists first
    response = table.get_item(Key={'tag_id': tag_id})
    if 'Item' not in response:
        return False
    
    # Delete the item
    table.delete_item(Key={'tag_id': tag_id})
    
    return True

# Test Movie operations
def get_all_test_movies():
    """Get all test movies from the test movie table"""
    table = dynamodb.Table(TEST_MOVIE_TABLE)
    response = table.scan()
    return response.get('Items', [])

def get_test_movie(test_movie_id):
    """Get a test movie by test_movie_id"""
    table = dynamodb.Table(TEST_MOVIE_TABLE)
    response = table.get_item(Key={'test_movie_id': test_movie_id})
    return response.get('Item')

def create_test_movie(test_movie_data):
    """Create a new test movie"""
    table = dynamodb.Table(TEST_MOVIE_TABLE)
    table.put_item(Item=test_movie_data)
    return test_movie_data

def update_test_movie(test_movie_id, update_data):
    """Update a test movie by test_movie_id"""
    table = dynamodb.Table(TEST_MOVIE_TABLE)
    
    # Check if the test movie exists
    response = table.get_item(Key={'test_movie_id': test_movie_id})
    if 'Item' not in response:
        raise Exception(f"Test movie not found: {test_movie_id}")
    
    # Build update expression
    update_expression = "SET "
    expression_values = {}
    update_parts = []
    
    for key, value in update_data.items():
        # Skip primary key
        if key == 'test_movie_id':
            continue
            
        attr_value = f":{key}"
        update_parts.append(f"{key} = {attr_value}")
        expression_values[attr_value] = value
    
    if not update_parts:
        raise Exception("No valid fields to update")
    
    update_expression += ", ".join(update_parts)
    
    # Update the item
    response = table.update_item(
        Key={'test_movie_id': test_movie_id},
        UpdateExpression=update_expression,
        ExpressionAttributeValues=expression_values,
        ReturnValues="ALL_NEW"
    )
    
    return response['Attributes']

def delete_test_movie(test_movie_id):
    """Delete a test movie by test_movie_id"""
    table = dynamodb.Table(TEST_MOVIE_TABLE)
    try:
        # Check if the test movie exists
        response = table.get_item(Key={'test_movie_id': test_movie_id})
        if 'Item' not in response:
            return False
        table.delete_item(Key={'test_movie_id': test_movie_id})
        return True
    except Exception as e:
        print(f"Error deleting test movie: {e}")
        return False
