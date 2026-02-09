from fastapi import APIRouter, HTTPException, Depends
from typing import List, Optional
from pydantic import BaseModel
from botocore.exceptions import ClientError
from shared.auth import get_current_user
from shared.common import *

router = APIRouter()

# Initialize DynamoDB resource
session = create_boto3_session()
dynamodb = session.resource('dynamodb')

class TagsResponse(BaseModel):
    tags: List[str]

@router.get("/", response_model=TagsResponse)
async def get_detector_tags(
    place_id: Optional[str] = None,
    camera_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """
    タグリストを取得（Query使用・scan不要）
    - camera_id指定時: data_type = "CAMERA|{camera_id}" でquery
    - place_id指定時: data_type = "PLACE|{place_id}" でquery
    - 指定なし: data_type = "TAG" でquery
    InsightページとSearchページで共通利用
    """
    try:
        tag_table = dynamodb.Table(DETECT_LOG_TAG_TABLE)
        
        # data_typeを決定
        if camera_id:
            data_type = f'CAMERA|{camera_id}'
        elif place_id:
            data_type = f'PLACE|{place_id}'
        else:
            data_type = 'TAG'
        
        # Query実行（scanではない）
        response = tag_table.query(
            KeyConditionExpression='data_type = :dt',
            ExpressionAttributeValues={':dt': data_type}
        )
        
        # ページネーション対応
        items = response.get('Items', [])
        while 'LastEvaluatedKey' in response:
            response = tag_table.query(
                KeyConditionExpression='data_type = :dt',
                ExpressionAttributeValues={':dt': data_type},
                ExclusiveStartKey=response['LastEvaluatedKey']
            )
            items.extend(response.get('Items', []))
        
        # タグ名を抽出
        all_tags = [item.get('detect_tag_name') for item in items if item.get('detect_tag_name')]
        
        return TagsResponse(tags=sorted(all_tags))
        
    except ClientError as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")
