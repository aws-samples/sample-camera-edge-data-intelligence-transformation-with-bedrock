from fastapi import APIRouter, Depends, HTTPException, status, Query
from typing import List, Dict, Optional, Any
from pydantic import BaseModel
import uuid
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from shared.database import (
    get_all_test_movies,
    get_test_movie,
    create_test_movie as create_test_movie_db,
    update_test_movie as update_test_movie_db,
    delete_test_movie as delete_test_movie_db
)
from shared.common import check_stack_completion, get_stack_info, delete_cloudformation_stack, get_s3_client
from shared.auth import get_current_user
from shared.url_generator import generate_presigned_url
from test_movie.deployment.deploy_rtsp_movie import deploy_rtsp_movie_cloudformation_stack

router = APIRouter()

# S3クライアントを作成（SigV4署名形式）
s3_client = get_s3_client(signature_version='s3v4')


class TestMovieCreate(BaseModel):
    type: str  # rtsp or rtmp
    name: Optional[str] = None  # テスト動画の名前（任意）
    test_movie_s3_path: str


class TestMovieUpdate(BaseModel):
    type: Optional[str] = None
    name: Optional[str] = None
    test_movie_s3_path: Optional[str] = None


@router.get("/", response_model=List[Dict[str, Any]])
async def read_test_movies(user: dict = Depends(get_current_user)):
    """
    Get all test movies
    """
    try:
        test_movies = get_all_test_movies()
        
        # 各テスト動画のステータスを動的に取得
        for test_movie in test_movies:
            stack_name = test_movie.get('cloudformation_stack')
            
            if not stack_name:
                # スタック未作成
                test_movie['status'] = 'pending'
            else:
                # CloudFormationステータスを確認
                cf_status, message = check_stack_completion(stack_name)
                
                if cf_status == 'SUCCESS':
                    test_movie['status'] = 'deployed'
                elif cf_status == 'FAILED':
                    test_movie['status'] = 'failed'
                    test_movie['deploy_error'] = message
                elif cf_status in ['IN_PROGRESS', 'UNKNOWN']:
                    test_movie['status'] = 'deploying'
                elif cf_status == 'NOT_FOUND':
                    test_movie['status'] = 'deleted'
                else:
                    test_movie['status'] = 'unknown'
        
        return test_movies
    except Exception as e:
        print(f"Error fetching test movies: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"テスト動画一覧の取得に失敗しました: {str(e)}"
        )


@router.get("/{test_movie_id}", response_model=Dict[str, Any])
async def read_test_movie(test_movie_id: str, user: dict = Depends(get_current_user)):
    """
    Get a test movie by ID
    """
    test_movie = get_test_movie(test_movie_id)
    if test_movie is None:
        raise HTTPException(status_code=404, detail="Test movie not found")
    
    # ステータスを動的に取得
    stack_name = test_movie.get('cloudformation_stack')
    
    if not stack_name:
        test_movie['status'] = 'pending'
    else:
        cf_status, message = check_stack_completion(stack_name)
        
        if cf_status == 'SUCCESS':
            test_movie['status'] = 'deployed'
        elif cf_status == 'FAILED':
            test_movie['status'] = 'failed'
            test_movie['deploy_error'] = message
        elif cf_status in ['IN_PROGRESS', 'UNKNOWN']:
            test_movie['status'] = 'deploying'
        elif cf_status == 'NOT_FOUND':
            test_movie['status'] = 'deleted'
        else:
            test_movie['status'] = 'unknown'
    
    return test_movie


@router.post("/", status_code=status.HTTP_202_ACCEPTED)
async def create_test_movie_endpoint(
    test_movie: TestMovieCreate,
    user: dict = Depends(get_current_user)
):
    """
    Create a new test movie and start CloudFormation deployment
    CloudFormationの完了を待たずに即座にレスポンスを返却
    """
    try:
        # 1. test_movie_id を生成
        test_movie_id = str(uuid.uuid4())
        
        # 2. DynamoDBに保存
        test_movie_data = {
            'test_movie_id': test_movie_id,
            'type': test_movie.type,
            'test_movie_s3_path': test_movie.test_movie_s3_path,
            'create_at': datetime.now(timezone.utc).isoformat(),
            'update_at': datetime.now(timezone.utc).isoformat()
        }
        # nameが指定されていれば追加
        if test_movie.name:
            test_movie_data['name'] = test_movie.name
        create_test_movie_db(test_movie_data)
        
        # 3. CloudFormationデプロイ開始（完了を待たない）
        deploy_result = deploy_rtsp_movie_cloudformation_stack(
            test_movie_id,
            test_movie.test_movie_s3_path
        )
        
        if not deploy_result['success']:
            # デプロイ開始失敗
            raise HTTPException(
                status_code=500,
                detail=f"デプロイの開始に失敗しました: {deploy_result.get('error', 'Unknown error')}"
            )
        
        # 4. DynamoDBを更新
        update_test_movie_db(test_movie_id, {
            'cloudformation_stack': deploy_result['stack_name'],
            'rtsp_url': deploy_result['rtsp_url'],
            'update_at': datetime.now(timezone.utc).isoformat()
        })
        
        # 5. 即座にレスポンス返却（CloudFormationの完了を待たない）
        return {
            'test_movie_id': test_movie_id,
            'status': 'deploying',
            'message': 'テスト動画のデプロイを開始しました',
            'cloudformation_stack': deploy_result['stack_name'],
            'rtsp_url': deploy_result['rtsp_url']
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error creating test movie: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"テスト動画の作成に失敗しました: {str(e)}"
        )


@router.get("/{test_movie_id}/status")
async def get_test_movie_status(
    test_movie_id: str,
    user: dict = Depends(get_current_user)
):
    """
    Get test movie deployment status (for polling)
    statusはCloudFormationから動的に取得
    """
    # 1. DynamoDBからテスト動画情報を取得
    test_movie = get_test_movie(test_movie_id)
    if not test_movie:
        raise HTTPException(status_code=404, detail="Test movie not found")
    
    # 2. CloudFormationステータスを動的に確認
    stack_name = test_movie.get('cloudformation_stack')
    
    if not stack_name:
        # スタック未作成
        test_movie['status'] = 'pending'
    else:
        # スタックのステータスを確認
        cf_status, message = check_stack_completion(stack_name)
        
        if cf_status == 'SUCCESS':
            test_movie['status'] = 'deployed'
        elif cf_status == 'FAILED':
            test_movie['status'] = 'failed'
            test_movie['deploy_error'] = message
        elif cf_status in ['IN_PROGRESS', 'UNKNOWN']:
            test_movie['status'] = 'deploying'
        elif cf_status == 'NOT_FOUND':
            test_movie['status'] = 'deleted'
        else:
            test_movie['status'] = 'unknown'
    
    return test_movie


@router.put("/{test_movie_id}")
async def update_test_movie_endpoint(
    test_movie_id: str,
    test_movie: TestMovieUpdate,
    user: dict = Depends(get_current_user)
):
    """
    Update a test movie
    """
    # Check if test movie exists
    existing_test_movie = get_test_movie(test_movie_id)
    if not existing_test_movie:
        raise HTTPException(status_code=404, detail="Test movie not found")
    
    # Prepare update data
    update_data = {}
    if test_movie.type is not None:
        update_data['type'] = test_movie.type
    if test_movie.name is not None:
        update_data['name'] = test_movie.name
    if test_movie.test_movie_s3_path is not None:
        update_data['test_movie_s3_path'] = test_movie.test_movie_s3_path
    
    update_data['update_at'] = datetime.now(timezone.utc).isoformat()
    
    # Update in DynamoDB
    updated_test_movie = update_test_movie_db(test_movie_id, update_data)
    
    return updated_test_movie


@router.delete("/{test_movie_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_test_movie_endpoint(
    test_movie_id: str,
    user: dict = Depends(get_current_user)
):
    """
    Delete a test movie and its CloudFormation stack
    """
    try:
        # 1. テスト動画情報を取得
        test_movie = get_test_movie(test_movie_id)
        if not test_movie:
            raise HTTPException(status_code=404, detail="Test movie not found")
        
        # 2. CloudFormation Stackを削除（CAMERA_RESOURCE_DEPLOYの設定に従う）
        stack_name = test_movie.get('cloudformation_stack')
        if stack_name:
            try:
                delete_result = delete_cloudformation_stack(stack_name, resource_type='camera')
                if not delete_result:
                    print(f"Warning: CloudFormation stack deletion failed: {stack_name}")
            except Exception as e:
                print(f"Error deleting CloudFormation stack: {e}")
                # スタック削除エラーは警告のみ（DBは削除する）
        
        # 3. S3オブジェクトを削除（オプション）
        test_movie_s3_path = test_movie.get('test_movie_s3_path')
        if test_movie_s3_path and test_movie_s3_path.startswith('s3://'):
            try:
                # S3パスからバケット名とキーを抽出
                parts = test_movie_s3_path.replace('s3://', '').split('/', 1)
                if len(parts) == 2:
                    bucket_name, key = parts
                    s3_client.delete_object(Bucket=bucket_name, Key=key)
                    print(f"Deleted S3 object: {test_movie_s3_path}")
            except Exception as e:
                print(f"Error deleting S3 object: {e}")
                # S3削除エラーは警告のみ
        
        # 4. DynamoDBレコードを削除
        success = delete_test_movie_db(test_movie_id)
        if not success:
            raise HTTPException(
                status_code=500,
                detail="テスト動画の削除に失敗しました"
            )
        
        return None
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error deleting test movie: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"テスト動画の削除に失敗しました: {str(e)}"
        )


@router.post("/upload")
async def upload_test_movie(
    filename: str = Query(..., description="ファイル名"),
    user: dict = Depends(get_current_user)
):
    """
    Generate presigned URL for test movie upload
    """
    try:
        # ファイル形式チェック
        if not filename.lower().endswith('.mp4'):
            raise HTTPException(
                status_code=400,
                detail="MP4ファイルのみアップロード可能です"
            )
        
        # S3バケット名を取得
        bucket_name = os.environ['BUCKET_NAME']
        
        # 一時的なtest_movie_idを生成
        temp_test_movie_id = 'temp-' + str(uuid.uuid4())
        
        # アップロード先のS3パスを生成
        s3_key = f"test-movies/{temp_test_movie_id}/video.mp4"
        s3_path = f"s3://{bucket_name}/{s3_key}"
        
        # S3の署名付きURLを生成（PUT用、有効期限5分）
        presigned_url = s3_client.generate_presigned_url(
            ClientMethod='put_object',
            Params={
                'Bucket': bucket_name,
                'Key': s3_key
            },
            ExpiresIn=300  # 5分間有効
        )
        
        print(f"Generated presigned URL for test movie upload: {s3_path}")
        
        return {
            "success": True,
            "upload_url": presigned_url,
            "s3_path": s3_path,
            "filename": filename
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error generating presigned URL: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"アップロードURLの生成に失敗しました: {str(e)}"
        )

