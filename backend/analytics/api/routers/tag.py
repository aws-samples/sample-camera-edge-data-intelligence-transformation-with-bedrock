from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form, Query
from typing import List, Dict, Optional, Any
from pydantic import BaseModel
from shared.database import (
    get_all_tag_categories, get_tag_category, create_tag_category, 
    update_tag_category, delete_tag_category,
    get_all_tags, get_tags_by_category, get_tag, create_tag, 
    update_tag, delete_tag
)
from shared.auth import get_current_user
from shared.url_generator import generate_presigned_url

import os
import uuid
from datetime import datetime
import mimetypes
from boto3.dynamodb.conditions import Key
from shared.common import *

router = APIRouter()

# S3クライアントを作成
session = create_boto3_session()
s3_client = session.client('s3')

# Pydantic models
class TagCategory(BaseModel):
    tagcategory_id: str
    tagcategory_name: str
    updatedate: Optional[str] = None
    system_prompt: Optional[str] = None
    detect_prompt: Optional[str] = None

class TagCategoryCreate(BaseModel):
    tagcategory_name: str
    system_prompt: Optional[str] = None
    detect_prompt: Optional[str] = None

class Tag(BaseModel):
    tag_id: str
    tag_name: str
    detect_tag_name: Optional[str] = None
    tag_prompt: str
    description: Optional[str] = None
    tagcategory_id: str
    s3path: Optional[str] = None
    file_format: Optional[str] = None
    updatedate: Optional[str] = None

class TagCreate(BaseModel):
    tag_name: str
    detect_tag_name: Optional[str] = None
    tag_prompt: str
    description: Optional[str] = None
    tagcategory_id: str
    s3path: Optional[str] = None
    file_format: Optional[str] = None

class TagUpdate(BaseModel):
    detect_tag_name: Optional[str] = None
    tag_prompt: str
    description: Optional[str] = None
    tagcategory_id: str
    s3path: Optional[str] = None
    file_format: Optional[str] = None

# Get environment variables
BUCKET_NAME = os.environ.get("BUCKET_NAME", "")
if not BUCKET_NAME:
    raise ValueError("BUCKET_NAME environment variable is required")

# Tag Category endpoints
@router.get("/categories/", response_model=List[TagCategory])
async def get_tag_categories(user: dict = Depends(get_current_user)):
    """Get all tag categories"""
    categories = get_all_tag_categories()
    return categories

@router.post("/categories/", response_model=TagCategory, status_code=status.HTTP_201_CREATED)
async def create_new_tag_category(category: TagCategoryCreate, user: dict = Depends(get_current_user)):
    """Create a new tag category"""
    # Generate unique ID
    tagcategory_id = str(uuid.uuid4())
    
    # Add timestamp
    current_time = now_utc_str()
    
    category_data = {
        "tagcategory_id": tagcategory_id,
        "tagcategory_name": category.tagcategory_name,
        "updatedate": current_time,
        "system_prompt": category.system_prompt or "",
        "detect_prompt": category.detect_prompt or ""
    }
    
    return create_tag_category(category_data)

@router.put("/categories/{tagcategory_id}", response_model=TagCategory)
async def update_existing_tag_category(
    tagcategory_id: str, 
    category: TagCategoryCreate, 
    user: dict = Depends(get_current_user)
):
    """Update a tag category"""
    # Check if category exists
    existing_category = get_tag_category(tagcategory_id)
    if not existing_category:
        raise HTTPException(status_code=404, detail="Tag category not found")
    
    # Add timestamp
    current_time = now_utc_str()
    
    category_data = {
        "tagcategory_name": category.tagcategory_name,
        "updatedate": current_time,
        "system_prompt": category.system_prompt or "",
        "detect_prompt": category.detect_prompt or ""
    }
    
    updated_category = update_tag_category(tagcategory_id, category_data)
    if not updated_category:
        raise HTTPException(status_code=500, detail="Failed to update tag category")
    
    return updated_category

@router.delete("/categories/{tagcategory_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_existing_tag_category(
    tagcategory_id: str, 
    cascade: bool = False, 
    user: dict = Depends(get_current_user)
):
    """Delete a tag category"""
    success = delete_tag_category(tagcategory_id, cascade)
    if not success:
        raise HTTPException(status_code=404, detail="Tag category not found")
    return None

# Tag endpoints
@router.get("/", response_model=List[Dict[str, Any]])
async def get_tags(
    category_id: Optional[str] = Query(None, alias="category_id"),
    current_user: dict = Depends(get_current_user)
):
    """
    タグ一覧を取得（category_idでGSIを使ってフィルタ）
    """
    try:
        session = create_boto3_session()
        dynamodb = session.resource('dynamodb')
        tag_table = dynamodb.Table(TAG_TABLE)

        if category_id:
            # GSIでクエリ
            response = tag_table.query(
                IndexName="globalindex1",
                KeyConditionExpression=Key('tagcategory_id').eq(category_id)
            )
            items = response.get('Items', [])
        else:
            # 全件取得
            response = tag_table.scan()
            items = response.get('Items', [])

        tags = [dict(item) for item in items]
        return tags
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"タグ一覧取得エラー: {str(e)}")

@router.get("/categories", response_model=List[Dict[str, Any]])
async def get_tag_categories(current_user: dict = Depends(get_current_user)):
    """
    タグカテゴリ一覧を取得
    """
    try:
        session = create_boto3_session()
        dynamodb = session.resource('dynamodb')
        
        category_table = dynamodb.Table(TAG_CATEGORY_TABLE)
        response = category_table.scan()
        
        categories = []
        for item in response.get('Items', []):
            category = dict(item)
            categories.append(category)
            
        return categories
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"タグカテゴリ一覧取得エラー: {str(e)}")

@router.get("/{tag_name}", response_model=Tag)
async def get_tag_detail(
    tag_name: str, 
    include_image: bool = False,
    user: dict = Depends(get_current_user)
):
    """Get a tag by name"""
    tag = get_tag(tag_name)
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    
    # Generate presigned URL for image if requested
    if include_image and tag.get('s3path'):
        try:
            presigned_url = generate_presigned_url(tag['s3path'], expiration=3600)
            tag['presigned_url'] = presigned_url
        except Exception as e:
            print(f"Error generating presigned URL for tag {tag_name}: {e}")
    
    return tag

@router.post("/", response_model=Tag, status_code=status.HTTP_201_CREATED)
async def create_new_tag(tag: TagCreate, user: dict = Depends(get_current_user)):
    """Create a new tag"""
    try:
        # Check if tag already exists
        existing_tag = get_tag(tag.tag_name)
        if existing_tag:
            raise HTTPException(status_code=400, detail="Tag with this name already exists")
        
        # Verify tag category exists
        category = get_tag_category(tag.tagcategory_id)
        if not category:
            raise HTTPException(status_code=400, detail="Tag category not found")
        
        # Add timestamp
        current_time = now_utc_str()
        
        tag_data = tag.model_dump()
        tag_data["updatedate"] = current_time
        
        # Clean up None/empty values before saving
        cleaned_data = {k: v for k, v in tag_data.items() if v is not None and str(v).strip() != ""}
        
        return create_tag(cleaned_data)
    except HTTPException:
        # HTTPExceptionはそのまま再発生
        raise
    except Exception as e:
        print(f"Error creating tag: {e}")
        raise HTTPException(
            status_code=503, 
            detail="Tag service is currently unavailable. Please try again later."
        )

@router.put("/{tag_name}", response_model=Tag)
async def update_existing_tag(
    tag_name: str, 
    tag: TagUpdate, 
    user: dict = Depends(get_current_user)
):
    """Update a tag"""
    # Check if tag exists
    existing_tag = get_tag(tag_name)
    if not existing_tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    
    # Verify tag category exists
    category = get_tag_category(tag.tagcategory_id)
    if not category:
        raise HTTPException(status_code=400, detail="Tag category not found")
    
    # Add timestamp
    current_time = now_utc_str()
    
    tag_data = tag.model_dump()
    tag_data["updatedate"] = current_time
    
    # Clean up None/empty values before updating
    cleaned_data = {k: v for k, v in tag_data.items() if v is not None and str(v).strip() != ""}
    
    updated_tag = update_tag(tag_name, cleaned_data)
    if not updated_tag:
        raise HTTPException(status_code=500, detail="Failed to update tag")
    
    return updated_tag

@router.delete("/{tag_name}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_existing_tag(tag_name: str, user: dict = Depends(get_current_user)):
    """Delete a tag"""
    success = delete_tag(tag_name)
    if not success:
        raise HTTPException(status_code=404, detail="Tag not found")
    return None

# Image upload endpoint
@router.post("/upload-image/")
async def upload_tag_image(
    tag_name: str = Form(...),
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user)
):
    """Upload an image for a tag"""
    print(f"Starting image upload for tag: {tag_name}")
    print(f"File details: name={file.filename}, content_type={file.content_type}, size={file.size}")
    print(f"BUCKET_NAME: {BUCKET_NAME}")
    
    # Validate file type
    allowed_types = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif']
    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=400, 
            detail="Invalid file type. Only JPEG, PNG, and GIF files are allowed."
        )
    
    # Validate file size (5MB limit)
    MAX_FILE_SIZE = 5 * 1024 * 1024  # 5MB
    file_content = await file.read()
    file_size = len(file_content)
    print(f"File size: {file_size} bytes")
    
    if file_size > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=400,
            detail="File size too large. Maximum size is 5MB."
        )
    
    # Check if tag exists
    existing_tag = get_tag(tag_name)
    if not existing_tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    
    try:
        # Generate unique filename (CloudFront compatible path)
        from shared.timezone_utils import now_utc
        timestamp = now_utc().strftime("%Y%m%d_%H%M%S")
        file_extension = file.filename.split('.')[-1].lower()
        s3_key = f"collect/tags/{tag_name}_{timestamp}.{file_extension}"
        
        print(f"Generated S3 key: {s3_key}")
        print(f"File extension: {file_extension}")
        
        # Create a BytesIO object from file content
        from io import BytesIO
        file_buffer = BytesIO(file_content)
        
        # Upload to S3
        print(f"Attempting to upload to S3...")
        s3_client.upload_fileobj(
            file_buffer,
            BUCKET_NAME,
            s3_key,
            ExtraArgs={
                'ContentType': file.content_type,
                'Metadata': {
                    'tag_name': tag_name,
                    'uploaded_by': user.get('username', 'unknown'),
                    'upload_timestamp': timestamp
                }
            }
        )
        print(f"Successfully uploaded to S3: s3://{BUCKET_NAME}/{s3_key}")
        
        # Update tag with S3 path and file format
        s3_path = f"s3://{BUCKET_NAME}/{s3_key}"
        tag_data = {
            's3path': s3_path,
            'file_format': file_extension,
            'updatedate': now_utc_str()
        }
        
        print(f"Updating tag with data: {tag_data}")
        updated_tag = update_tag(tag_name, tag_data)
        if not updated_tag:
            print(f"Failed to update tag in database")
            raise HTTPException(status_code=500, detail="Failed to update tag with image path")
        
        print(f"Successfully updated tag: {updated_tag}")
        
        # Generate presigned URL for immediate display  
        try:
            presigned_url = generate_presigned_url(s3_path, expiration=3600)
            print(f"Generated presigned URL: {presigned_url}")
        except Exception as url_error:
            print(f"Error generating presigned URL: {url_error}")
            presigned_url = None
        
        return {
            "message": "Image uploaded successfully",
            "s3_path": s3_path,
            "file_format": file_extension,
            "presigned_url": presigned_url,
            "tag": updated_tag
        }
        
    except Exception as e:
        print(f"Error uploading image for tag {tag_name}: {e}")
        print(f"Error type: {type(e)}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Failed to upload image: {str(e)}")

# Get image URL endpoint  
@router.get("/{tag_name}/image-url/")
async def get_tag_image_url(tag_name: str, user: dict = Depends(get_current_user)):
    """Get presigned URL for tag image"""
    print(f"Getting image URL for tag: {tag_name}")
    
    tag = get_tag(tag_name)
    if not tag:
        print(f"Tag not found: {tag_name}")
        raise HTTPException(status_code=404, detail="Tag not found")
    
    print(f"Tag found: {tag}")
    
    if not tag.get('s3path'):
        print(f"No s3path found for tag: {tag_name}")
        raise HTTPException(status_code=404, detail="No image found for this tag")
    
    s3path = tag['s3path']
    print(f"S3 path: {s3path}")
    
    try:
        presigned_url = generate_presigned_url(s3path, expiration=3600)
        print(f"Generated presigned URL: {presigned_url}")
        
        result = {
            "presigned_url": presigned_url,
            "s3_path": s3path,
            "file_format": tag.get('file_format', 'unknown')
        }
        print(f"Returning result: {result}")
        return result
    except Exception as e:
        print(f"Error generating presigned URL for tag {tag_name}: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail="Failed to generate image URL")

@router.get("/tags/sync")
async def sync_tags_from_detect_log(user: dict = Depends(get_current_user)):
    """
    検出ログから新しいタグを同期
    """
    try:
        session = create_boto3_session()
        dynamodb = session.resource('dynamodb')
        
        # 既存のタグを取得（set形式）
        existing_tags = {tag['tag_name'] for tag in get_all_tags()}
        
        # 検出ログからユニークなタグを収集
        detect_log_table = dynamodb.Table(DETECT_LOG_TABLE)
        response = detect_log_table.scan(
            ProjectionExpression='detect_tag'
        )
        
        new_tags = set()
        for item in response.get('Items', []):
            detect_tags = item.get('detect_tag', [])
            if isinstance(detect_tags, list):
                new_tags.update(detect_tags)
        
        # 新しいタグのみをタグテーブルに追加
        tags_to_add = new_tags - existing_tags
        
        for tag_name in tags_to_add:
            tag_data = {
                'tag_id': str(uuid.uuid4()),
                'tag_name': tag_name,
                'color': '#808080',  # デフォルトカラー（グレー）
                'tagcategory_id': '',  # カテゴリ未分類
                'tagcategory_name': '未分類',
                'updatedate': now_utc_str()
            }
            create_tag(tag_data)
        
        return {
            "message": f"{len(tags_to_add)}個の新しいタグを追加しました",
            "added_tags": list(tags_to_add),
            "total_existing_tags": len(existing_tags),
            "total_new_tags": len(new_tags)
        }
        
    except Exception as e:
        print(f"Tag sync error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"タグ同期エラー: {str(e)}")

@router.get("/tags/detection-stats")
async def get_tag_detection_stats(
    user: dict = Depends(get_current_user),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None
):
    """
    タグの検出統計を取得
    """
    try:
        session = create_boto3_session()
        dynamodb = session.resource('dynamodb')
        
        # 実装が必要
        raise HTTPException(status_code=500, detail="Tag detection stats implementation not completed")
    except Exception as e:
        print(f"Tag detection stats error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"タグ検出統計取得エラー: {str(e)}") 