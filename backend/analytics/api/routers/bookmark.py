from fastapi import APIRouter, Depends, HTTPException, status
from typing import List, Dict, Optional, Any
from shared.auth import get_current_user
from pydantic import BaseModel
import os
import uuid
from datetime import datetime
from decimal import Decimal
import asyncio
import logging
from shared.common import *
from shared.url_generator import generate_presigned_url

router = APIRouter()
logger = logging.getLogger(__name__)

# Pydantic models
class BookmarkCreate(BaseModel):
    bookmark_name: str

class BookmarkDetailCreate(BaseModel):
    bookmark_id: str                    # ブックマークID（必須）
    file_id: str
    collector: str  # hlsRec/hlsYolo/s3Rec（必須）
    collector_id: Optional[str] = None  # コレクターID
    detector: str   # bedrock等（必須）
    detector_id: Optional[str] = None   # ディテクターID
    camera_id: Optional[str] = None     # CameraViewから渡される
    camera_name: Optional[str] = None   # CameraViewから渡される
    place_id: Optional[str] = None      # CameraViewから渡される
    place_name: Optional[str] = None    # APIで取得する場合もある
    s3path: Optional[str] = None        # S3パス（APIで取得）
    updatedate: Optional[str] = None    # 作成日時

class BookmarkResponse(BaseModel):
    bookmark_id: str
    bookmark_name: str
    username: str
    updatedate: str

class BookmarkDetailResponse(BaseModel):
    detail_id: Optional[str] = None
    bookmark_id: str
    file_id: str
    file_type: str
    collector: str
    collector_id: Optional[str] = None  # コレクターID
    detector: str
    detector_id: Optional[str] = None   # ディテクターID
    datetime: str  # ISO8601形式
    camera_id: str
    camera_name: str
    place_id: str
    place_name: str
    s3path: Optional[str] = None        # S3パス
    signed_url: Optional[str] = None    # 署名付きURL
    updatedate: Optional[str] = None

def get_dynamodb():
    """DynamoDB リソースを取得"""
    return get_dynamodb_resource()

def get_username_from_user(user: dict) -> str:
    """ユーザー情報からusernameを取得"""
    username = user.get("cognito:username") or user.get("username") or user.get("email") or user.get("sub", "unknown")
    return username

def get_camera_and_place_info(file_id: str, camera_id: str = None) -> Dict[str, str]:
    """
    file_idまたはcamera_idからカメラ情報と場所情報を取得
    """
    try:
        dynamodb = get_dynamodb()
        
        # camera_idが提供されていない場合、file_idから抽出を試行
        if not camera_id:
            # 一般的なファイルID形式（camera_id-YYYYMMDDHHMM-...）から抽出
            file_id_parts = file_id.split('-')
            if len(file_id_parts) >= 1:
                camera_id = file_id_parts[0]
            else:
                raise ValueError(f"Cannot extract camera_id from file_id: {file_id}")
        
        # カメラ情報を取得
        camera_table = dynamodb.Table(CAMERA_TABLE)
        camera_response = camera_table.get_item(Key={'camera_id': camera_id})
        
        if 'Item' not in camera_response:
            raise ValueError(f"Camera not found: {camera_id}")
        
        camera = camera_response['Item']
        camera_name = camera.get('name', 'Unknown Camera')
        place_id = camera.get('place_id', '')
        
        # 場所情報を取得
        place_name = get_place_name(place_id)
        
        return {
            'camera_id': camera_id,
            'camera_name': camera_name,
            'place_id': place_id,
            'place_name': place_name
        }
        
    except Exception as e:
        print(f"Error getting camera and place info: {e}")
        # エラーの場合は空の値を返す
        return {
            'camera_id': camera_id or 'unknown',
            'camera_name': 'Unknown Camera',
            'place_id': 'unknown',
            'place_name': 'Unknown Place'
        }

def get_place_name(place_id: str) -> str:
    """Get place name from place_id"""
    try:
        if not place_id or place_id == "unknown":
            logger.debug(f" place_id is empty or unknown: {place_id}")
            return "Unknown Place"
        
        logger.debug(f" === Getting place name for place_id: {place_id} ===")
        
        # DynamoDBリソースを取得
        dynamodb = get_dynamodb()
        logger.debug(f" DynamoDB resource created: {dynamodb}")
        
        place_table = dynamodb.Table(PLACE_TABLE)
        logger.debug(f" Place table object: {place_table}")
        
        # テーブルの情報を確認
        try:
            table_info = place_table.table_status
            logger.debug(f" Table status: {table_info}")
        except Exception as table_err:
            logger.debug(f" Error getting table status: {table_err}")
        
        # まずテーブルの全データをスキャンして確認
        try:
            scan_response = place_table.scan(Limit=5)  # 最初の5件だけ
            logger.debug(f" Sample data in place table: {scan_response.get('Items', [])}")
        except Exception as scan_err:
            logger.debug(f" Error scanning table: {scan_err}")
        
        # 実際のget_item呼び出し
        logger.debug(f" Calling get_item with Key: {{'place_id': '{place_id}'}}")
        response = place_table.get_item(Key={'place_id': place_id})
        
        logger.debug(f" DynamoDB get_item response: {response}")
        logger.debug(f" Response keys: {list(response.keys())}")
        
        if 'Item' in response:
            place_data = response['Item']
            logger.debug(f" Found Item: {place_data}")
            logger.debug(f" Item keys: {list(place_data.keys())}")
            
            place_name = place_data.get('name', 'Unknown Place')
            logger.debug(f" Extracted place_name: {place_name}")
            return place_name
        else:
            logger.debug(f" No Item found in response")
            logger.debug(f" Available response data: {response}")
            return "Unknown Place"
            
    except Exception as e:
        logger.debug(f" Exception occurred: {str(e)}")
        logger.debug(f" Exception type: {type(e)}")
        import traceback
        logger.debug(f" Full traceback: {traceback.format_exc()}")
        return "Unknown Place"

def get_file_s3path(file_id: str) -> Optional[str]:
    """
    file_idから FILE_TABLE テーブルのs3pathを取得
    """
    try:
        logger.debug(f" === Getting s3path for file_id: {file_id} ===")
        
        dynamodb = get_dynamodb()
        file_table = dynamodb.Table(FILE_TABLE)
        
        # file_idで直接検索（Primary Key）
        response = file_table.get_item(Key={'file_id': file_id})
        
        logger.debug(f" File table get_item response: {response}")
        
        if 'Item' in response:
            file_data = response['Item']
            s3path = file_data.get('s3path')
            logger.debug(f" Found s3path: {s3path}")
            return s3path
        else:
            logger.debug(f" No file found for file_id: {file_id}")
            return None
            
    except Exception as e:
        logger.debug(f" Error getting s3path for file_id {file_id}: {str(e)}")
        import traceback
        logger.debug(f" Full traceback: {traceback.format_exc()}")
        return None

@router.get("/", response_model=List[BookmarkResponse])
async def get_user_bookmarks(user: dict = Depends(get_current_user)):
    """
    ユーザーのブックマーク一覧を取得（updatedate降順）
    """
    try:
        username = get_username_from_user(user)
        dynamodb = get_dynamodb()
        bookmark_table = dynamodb.Table(BOOKMARK_TABLE)
        
        # usernameでフィルタリングしてスキャン
        response = bookmark_table.scan(
            FilterExpression='username = :username',
            ExpressionAttributeValues={':username': username}
        )
        
        bookmarks = response.get('Items', [])
        
        # updatedate降順でソート
        bookmarks.sort(key=lambda x: x.get('updatedate', ''), reverse=True)
        
        return [
            BookmarkResponse(
                bookmark_id=bookmark['bookmark_id'],
                bookmark_name=bookmark['bookmark_name'],
                username=bookmark['username'],
                updatedate=bookmark['updatedate']
            )
            for bookmark in bookmarks
        ]
        
    except Exception as e:
        print(f"Error getting user bookmarks: {e}")
        raise HTTPException(
            status_code=500,
            detail="ブックマーク一覧の取得に失敗しました"
        )

@router.post("/", response_model=BookmarkResponse, status_code=status.HTTP_201_CREATED)
async def create_bookmark(bookmark_data: BookmarkCreate, user: dict = Depends(get_current_user)):
    """
    新規ブックマークを作成
    """
    try:
        username = get_username_from_user(user)
        dynamodb = get_dynamodb()
        bookmark_table = dynamodb.Table(BOOKMARK_TABLE)
        
        # 新しいブックマークIDを生成
        bookmark_id = str(uuid.uuid4())
        from shared.timezone_utils import now_utc_str
        current_time = now_utc_str()
        
        # ブックマークを作成
        bookmark_item = {
            'bookmark_id': bookmark_id,
            'bookmark_name': bookmark_data.bookmark_name,
            'username': username,
            'updatedate': current_time
        }
        
        bookmark_table.put_item(Item=bookmark_item)
        
        return BookmarkResponse(**bookmark_item)
        
    except Exception as e:
        print(f"Error creating bookmark: {e}")
        raise HTTPException(
            status_code=500,
            detail="ブックマークの作成に失敗しました"
        )

@router.delete("/{bookmark_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_bookmark(bookmark_id: str, user: dict = Depends(get_current_user)):
    """
    ブックマークを削除（詳細も含めて削除）
    """
    try:
        username = get_username_from_user(user)
        dynamodb = get_dynamodb()
        bookmark_table = dynamodb.Table(BOOKMARK_TABLE)
        bookmark_detail_table = dynamodb.Table(BOOKMARK_DETAIL_TABLE)
        
        # ブックマークが存在し、ユーザーのものかチェック
        response = bookmark_table.get_item(Key={'bookmark_id': bookmark_id})
        if 'Item' not in response:
            raise HTTPException(status_code=404, detail="ブックマークが見つかりません")
        
        bookmark = response['Item']
        if bookmark['username'] != username:
            raise HTTPException(status_code=403, detail="このブックマークにアクセスする権限がありません")
        
        # ブックマーク詳細を全て削除
        detail_response = bookmark_detail_table.query(
            KeyConditionExpression='bookmark_id = :bookmark_id',
            ExpressionAttributeValues={':bookmark_id': bookmark_id}
        )
        
        for detail in detail_response.get('Items', []):
            bookmark_detail_table.delete_item(
                Key={
                    'bookmark_id': bookmark_id,
                    'bookmark_no': detail['bookmark_no']
                }
            )
        
        # ブックマーク本体を削除
        bookmark_table.delete_item(Key={'bookmark_id': bookmark_id})
        
        return None
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error deleting bookmark: {e}")
        raise HTTPException(
            status_code=500,
            detail="ブックマークの削除に失敗しました"
        )

@router.get("/{bookmark_id}/details", response_model=List[BookmarkDetailResponse])
async def get_bookmark_details(bookmark_id: str, user: dict = Depends(get_current_user)):
    """
    ブックマーク詳細一覧を取得（bookmark_no昇順）
    """
    try:
        username = get_username_from_user(user)
        dynamodb = get_dynamodb()
        bookmark_table = dynamodb.Table(BOOKMARK_TABLE)
        bookmark_detail_table = dynamodb.Table(BOOKMARK_DETAIL_TABLE)
        
        # ブックマークが存在し、ユーザーのものかチェック
        response = bookmark_table.get_item(Key={'bookmark_id': bookmark_id})
        if 'Item' not in response:
            raise HTTPException(status_code=404, detail="ブックマークが見つかりません")
        
        bookmark = response['Item']
        if bookmark['username'] != username:
            raise HTTPException(status_code=403, detail="このブックマークにアクセスする権限がありません")
        
        # ブックマーク詳細を取得
        detail_response = bookmark_detail_table.query(
            KeyConditionExpression='bookmark_id = :bookmark_id',
            ExpressionAttributeValues={':bookmark_id': bookmark_id}
        )
        
        details = detail_response.get('Items', [])
        
        # bookmark_no昇順でソート
        details.sort(key=lambda x: x.get('bookmark_no', 0))
        
        result = []
        for detail in details:
            # 既存データに新しいフィールドがない場合の対応
            camera_id = detail.get('camera_id')
            camera_name = detail.get('camera_name')
            place_id = detail.get('place_id')
            place_name = detail.get('place_name')
            s3path = detail.get('s3path')
            
            # 新しいフィールドが存在しない場合は、file_idから情報を取得
            if not camera_id or not camera_name or not place_id or not place_name:
                try:
                    camera_place_info = get_camera_and_place_info(detail['file_id'], camera_id)
                    camera_id = camera_id or camera_place_info['camera_id']
                    camera_name = camera_name or camera_place_info['camera_name']
                    place_id = place_id or camera_place_info['place_id']
                    place_name = place_name or camera_place_info['place_name']
                except Exception as e:
                    print(f"Error getting camera/place info for existing detail: {e}")
                    # フォールバック値を設定
                    camera_id = camera_id or 'unknown'
                    camera_name = camera_name or 'Unknown Camera'
                    place_id = place_id or 'unknown'
                    place_name = place_name or 'Unknown Place'
            
            # s3pathが存在しない場合は、file_idから取得
            if not s3path:
                try:
                    s3path = get_file_s3path(detail['file_id'])
                except Exception as e:
                    print(f"Error getting s3path for existing detail: {e}")
                    s3path = None
            
            # 署名付きURLを生成
            signed_url = None
            if s3path:
                try:
                    signed_url = generate_presigned_url(s3path, expiration=3600)
                    logger.debug(f" Generated signed URL for {detail['file_id']}: {signed_url[:100] if signed_url else 'None'}...")
                except Exception as e:
                    print(f"Error generating signed URL for {detail['file_id']}: {e}")
                    signed_url = None
            
            result.append(BookmarkDetailResponse(
                detail_id=f"{detail['bookmark_id']}-{detail['bookmark_no']}",  # bookmark_idとbookmark_noから生成
                bookmark_id=detail['bookmark_id'],
                file_id=detail['file_id'],
                file_type=detail['file_type'],
                collector=detail['collector'],
                collector_id=detail.get('collector_id'),  # コレクターID
                detector=detail['detector'],
                detector_id=detail.get('detector_id'),    # ディテクターID
                datetime=detail['datetime'],
                camera_id=camera_id,
                camera_name=camera_name,
                place_id=place_id,
                place_name=place_name,
                s3path=s3path,
                signed_url=signed_url,
                updatedate=detail.get('updatedate')
            ))
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error getting bookmark details: {e}")
        raise HTTPException(
            status_code=500,
            detail="ブックマーク詳細の取得に失敗しました"
        )

@router.delete("/{bookmark_id}/details/{bookmark_no}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_bookmark_detail(bookmark_id: str, bookmark_no: int, user: dict = Depends(get_current_user)):
    """
    ブックマーク詳細を個別に削除
    """
    try:
        username = get_username_from_user(user)
        dynamodb = get_dynamodb()
        bookmark_table = dynamodb.Table(BOOKMARK_TABLE)
        bookmark_detail_table = dynamodb.Table(BOOKMARK_DETAIL_TABLE)
        
        # ブックマークが存在し、ユーザーのものかチェック
        response = bookmark_table.get_item(Key={'bookmark_id': bookmark_id})
        if 'Item' not in response:
            raise HTTPException(status_code=404, detail="ブックマークが見つかりません")
        
        bookmark = response['Item']
        if bookmark['username'] != username:
            raise HTTPException(status_code=403, detail="このブックマークにアクセスする権限がありません")
        
        # ブックマーク詳細を削除
        bookmark_detail_table.delete_item(
            Key={
                'bookmark_id': bookmark_id,
                'bookmark_no': bookmark_no
            }
        )
        
        return None
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error deleting bookmark detail: {e}")
        raise HTTPException(
            status_code=500,
            detail="ブックマーク詳細の削除に失敗しました"
        )

@router.post("/{bookmark_id}/details", response_model=BookmarkDetailResponse, status_code=status.HTTP_201_CREATED)
async def add_bookmark_detail(bookmark_id: str, detail_data: BookmarkDetailCreate, user: dict = Depends(get_current_user)):
    """
    ブックマーク詳細を追加
    """
    try:
        username = get_username_from_user(user)
        dynamodb = get_dynamodb()
        bookmark_table = dynamodb.Table(BOOKMARK_TABLE)
        bookmark_detail_table = dynamodb.Table(BOOKMARK_DETAIL_TABLE)
        
        # ブックマークが存在し、ユーザーのものかチェック
        response = bookmark_table.get_item(Key={'bookmark_id': bookmark_id})
        if 'Item' not in response:
            raise HTTPException(status_code=404, detail="ブックマークが見つかりません")
        
        bookmark = response['Item']
        if bookmark['username'] != username:
            raise HTTPException(status_code=403, detail="このブックマークにアクセスする権限がありません")
        
        # カメラ・場所情報を取得
        camera_place_info = get_camera_and_place_info(
            detail_data.file_id, 
            detail_data.camera_id
        )
        
        # s3pathを取得
        s3path = detail_data.s3path
        if not s3path:
            try:
                s3path = get_file_s3path(detail_data.file_id)
                print(f"Retrieved s3path for bookmark detail: {s3path}")
            except Exception as e:
                print(f"Failed to get s3path for bookmark detail: {str(e)}")
                s3path = None
        
        # 署名付きURLを生成
        signed_url = None
        if s3path:
            try:
                signed_url = generate_presigned_url(s3path, expiration=3600)
                print(f"Generated signed URL for bookmark detail: {signed_url[:100] if signed_url else 'None'}...")
            except Exception as e:
                print(f"Failed to generate signed URL for bookmark detail: {str(e)}")
                signed_url = None
        
        # 次のbookmark_noを取得
        detail_response = bookmark_detail_table.query(
            KeyConditionExpression='bookmark_id = :bookmark_id',
            ExpressionAttributeValues={':bookmark_id': bookmark_id},
            ScanIndexForward=False,  # 降順
            Limit=1
        )
        
        existing_details = detail_response.get('Items', [])
        next_bookmark_no = 1 if not existing_details else int(existing_details[0]['bookmark_no']) + 1
        
        # ブックマーク詳細を作成
        detail_item = {
            'bookmark_id': bookmark_id,
            'bookmark_no': next_bookmark_no,
            'file_id': detail_data.file_id,
            'file_type': detail_data.file_type,
            'collector': detail_data.collector,
            'collector_id': detail_data.collector_id,  # コレクターID
            'detector': detail_data.detector,
            'detector_id': detail_data.detector_id,    # ディテクターID
            'datetime': detail_data.datetime,
            'camera_id': camera_place_info['camera_id'],
            'camera_name': camera_place_info['camera_name'],
            'place_id': camera_place_info['place_id'],
            'place_name': camera_place_info['place_name'],
            's3path': s3path,  # s3pathを保存
            'updatedate': now_utc_str(),
            'detail_id': str(uuid.uuid4())
        }
        
        bookmark_detail_table.put_item(Item=detail_item)
        
        # ブックマークのupdatedateを更新
        from shared.timezone_utils import now_utc_str
        current_time = now_utc_str()
        bookmark_table.update_item(
            Key={'bookmark_id': bookmark_id},
            UpdateExpression='SET updatedate = :updatedate',
            ExpressionAttributeValues={':updatedate': current_time}
        )
        
        return BookmarkDetailResponse(
            detail_id=detail_item.get('detail_id'),
            bookmark_id=detail_item['bookmark_id'],
            file_id=detail_item['file_id'],
            file_type=detail_item['file_type'],
            collector=detail_item['collector'],
            collector_id=detail_item.get('collector_id'),  # コレクターID
            detector=detail_item['detector'],
            detector_id=detail_item.get('detector_id'),    # ディテクターID
            datetime=detail_item['datetime'],
            camera_id=detail_item['camera_id'],
            camera_name=detail_item['camera_name'],
            place_id=detail_item['place_id'],
            place_name=detail_item['place_name'],
            s3path=s3path,
            signed_url=signed_url,
            updatedate=detail_item['updatedate']
        )
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error adding bookmark detail: {e}")
        raise HTTPException(
            status_code=500,
            detail="ブックマーク詳細の追加に失敗しました"
        )

@router.post("/detail", response_model=BookmarkDetailResponse)
async def create_bookmark_detail(detail: BookmarkDetailCreate, user: dict = Depends(get_current_user)):
    try:
        print(f"Creating bookmark detail: {detail}")
        # file_idから FILE_TABLE を検索し、file_typeとstart_time(datetime)を取得
        dynamodb = get_dynamodb()
        file_table = dynamodb.Table(FILE_TABLE)
        file_response = file_table.get_item(Key={'file_id': detail.file_id})
        if 'Item' not in file_response:
            raise HTTPException(status_code=400, detail="file_idに該当するファイルが見つかりません")
        file_item = file_response['Item']
        file_type = file_item.get('file_type')
        datetime_val = file_item.get('start_time')
        if not file_type or not datetime_val:
            raise HTTPException(status_code=400, detail="file_typeまたはstart_timeがファイル情報に存在しません")
        # Get place_name from place_id if not provided
        place_name = detail.place_name
        if not place_name and detail.place_id:
            try:
                place_name = get_place_name(detail.place_id)
                print(f"Retrieved place_name: {place_name}")
            except Exception as e:
                print(f"Failed to get place_name, using fallback: {str(e)}")
                place_name = "Unknown Place"
        # Get s3path from file_id if not provided
        s3path = detail.s3path
        if not s3path:
            try:
                s3path = get_file_s3path(detail.file_id)
                print(f"Retrieved s3path: {s3path}")
            except Exception as e:
                print(f"Failed to get s3path: {str(e)}")
                s3path = None
        # Generate signed URL for response
        signed_url = None
        if s3path:
            try:
                signed_url = generate_presigned_url(s3path, expiration=3600)
                print(f"Generated signed URL: {signed_url[:100] if signed_url else 'None'}...")
            except Exception as e:
                print(f"Failed to generate signed URL: {str(e)}")
                signed_url = None
        # DynamoDBテーブルを取得
        table_detail = dynamodb.Table(BOOKMARK_DETAIL_TABLE)
        # 次のbookmark_noを取得（テーブル設計に合わせて）
        try:
            detail_response = table_detail.query(
                KeyConditionExpression='bookmark_id = :bookmark_id',
                ExpressionAttributeValues={':bookmark_id': detail.bookmark_id},
                ScanIndexForward=False,  # 降順
                Limit=1
            )
            existing_details = detail_response.get('Items', [])
            next_bookmark_no = 1 if not existing_details else int(existing_details[0]['bookmark_no']) + 1
        except Exception as e:
            print(f"Error getting next bookmark_no, starting from 1: {str(e)}")
            next_bookmark_no = 1
        # DynamoDBに保存（テーブル設計に合わせてbookmark_id + bookmark_noをキーとして使用）
        detail_item = {
            'bookmark_id': detail.bookmark_id,  # Primary Key
            'bookmark_no': next_bookmark_no,    # Sort Key
            'file_id': detail.file_id,
            'file_type': file_type,
            'collector': detail.collector,
            'collector_id': detail.collector_id,  # コレクターID
            'detector': detail.detector,
            'detector_id': detail.detector_id,    # ディテクターID
            'datetime': datetime_val,
            'camera_id': detail.camera_id or 'unknown',
            'camera_name': detail.camera_name or 'Unknown Camera',
            'place_id': detail.place_id or 'unknown',
            'place_name': place_name or 'Unknown Place',
            's3path': s3path  # s3pathを保存
        }
        print(f"Saving detail_item: {detail_item}")
        await asyncio.to_thread(
            table_detail.put_item,
            Item=detail_item
        )
        print("Successfully saved bookmark detail")
        return BookmarkDetailResponse(
            detail_id=str(uuid.uuid4()),  # レスポンス用のID
            bookmark_id=detail.bookmark_id,
            file_id=detail.file_id,
            file_type=file_type,
            collector=detail.collector,
            collector_id=detail.collector_id,  # コレクターID
            detector=detail.detector,
            detector_id=detail.detector_id,    # ディテクターID
            datetime=datetime_val,
            camera_id=detail_item['camera_id'],
            camera_name=detail_item['camera_name'],
            place_id=detail_item['place_id'],
            place_name=place_name or 'Unknown Place',
            s3path=s3path,
            signed_url=signed_url,
            updatedate=detail.updatedate or now_utc_str()
        )
    except Exception as e:
        print(f"Error creating bookmark detail: {str(e)}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}") 