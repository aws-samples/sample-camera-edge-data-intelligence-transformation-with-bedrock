from fastapi import APIRouter, Depends, HTTPException, status, Query
from typing import List, Dict, Optional, Any
from shared.models.models import Camera, CameraCreate
from shared.database import get_all_cameras, get_cameras_by_place, get_camera as db_get_camera, create_camera, update_camera, delete_camera, get_camera_collectors_by_camera
from shared.auth import get_current_user
import os
import re
from pydantic import BaseModel
import uuid
import json
from boto3.dynamodb.conditions import Key, Attr
from shared.common import *
from shared.url_generator import generate_presigned_url
from datetime import datetime, timezone
from camera_management.deployment.rtsp_receiver.deploy_rtsp_receiver import deploy_rtsp_receiver_cloudformation_stack
from camera_management.deployment.rtmp_server.rtmp_nlb_manager import RtmpNlbManager

router = APIRouter()

# S3クライアントを作成（SigV4署名形式）
# NOTE: ブラウザからのCORS preflightリクエストを回避するため、
#       署名付きURLをSigV4形式で生成し、リダイレクトを防ぐ
s3_client = get_s3_client(signature_version='s3v4')

# collector_nameマッピング定数
COLLECTOR_NAME_MAP = {
    'hlsRec': 'HLS経由でのメディア収集(hlsRec)',
    'hlsYolo': 'HLS経由でのYolo物体検出(hlsYolo)',
    's3Rec': 'S3経由でのメディア収集(s3Rec)',
    's3Yolo': 'S3経由でのYolo物体検出(s3Yolo)'
}

class CameraFilterResponse(BaseModel):
    cameras: List[Dict[str, Any]]
    pagination: Dict[str, Any]
    total_count: int

@router.get("/", response_model=List[Camera])
async def read_cameras(place_id: str = None, image: bool = False, user: dict = Depends(get_current_user)):
    """
    Get all cameras or cameras by place_id
    """
    if place_id:
        cameras = get_cameras_by_place(place_id)
    else:
        cameras = get_all_cameras()
    
    # Generate presigned URL if image=true
    if image:
        for camera in cameras:
            if camera.get('capture'):
                try:
                    s3path = camera['capture']
                    presigned_url = generate_presigned_url(s3path, expiration=3600)
                    camera['presigned_url'] = presigned_url
                except Exception as e:
                    print(f"Error generating presigned URL for camera {camera.get('camera_id', 'unknown')}: {e}")
                    # Continue processing other cameras even if one fails
    
    return cameras

@router.get("/{camera_id}", response_model=Camera)
async def read_camera(camera_id: str, image: bool = False, user: dict = Depends(get_current_user)):
    """
    Get a camera by ID (既存エンドポイント - 削除しない)
    """
    camera = db_get_camera(camera_id)
    if camera is None:
        raise HTTPException(status_code=404, detail="Camera not found")
    
    # Generate presigned URL if image=true
    if image and camera.get('capture'):
        try:
            s3path = camera['capture']
            presigned_url = generate_presigned_url(s3path, expiration=3600)
            camera['presigned_url'] = presigned_url
        except Exception as e:
            print(f"Error generating presigned URL for camera {camera_id}: {e}")
    
    return camera

def validate_aws_keys(camera_data: dict):
    """
    Validate AWS keys for kinesis camera types
    """
    camera_type = camera_data.get('type')
    if camera_type != 'kinesis':
        return  # No validation needed for other types
    
    aws_access_key = (camera_data.get('aws_access_key') or '').strip()
    aws_secret_access_key = (camera_data.get('aws_secret_access_key') or '').strip()
    aws_region = (camera_data.get('aws_region') or '').strip()
    
    # Both access key and secret key must be provided or both must be empty
    has_access_key = bool(aws_access_key)
    has_secret_key = bool(aws_secret_access_key)
    
    if has_access_key != has_secret_key:
        raise HTTPException(
            status_code=400, 
            detail="AWSアクセスキーとシークレットキーは両方とも入力するか、両方とも空にしてください。"
        )
    
    # Region validation is optional - if provided, it should be a valid format
    if aws_region:
        # Basic region format validation (e.g., us-east-1, ap-northeast-1)
        if not re.match(r'^[a-z]{2}-[a-z]+-\d+$', aws_region):
            raise HTTPException(
                status_code=400,
                detail="AWSリージョンの形式が正しくありません。例: us-east-1, ap-northeast-1"
            )

def validate_vsaas_fields(camera_data: dict):
    """
    Validate VSaaS camera configuration
    """
    camera_type = camera_data.get('type')
    if camera_type != 'vsaas':
        return  # No validation needed for other types
    
    vsaas_device_id = (camera_data.get('vsaas_device_id') or '').strip()
    vsaas_apikey = (camera_data.get('vsaas_apikey') or '').strip()
    
    # VSaaS Device IDが必須
    if not vsaas_device_id:
        raise HTTPException(
            status_code=400,
            detail="VSaaSカメラの場合、VSaaS Device IDは必須です。"
        )
    
    # VSaaS API Keyが必須
    if not vsaas_apikey:
        raise HTTPException(
            status_code=400,
            detail="VSaaSカメラの場合、VSaaS API Keyは必須です。"
        )

def validate_kinesis_stream(camera_data: dict):
    """
    Validate Kinesis stream configuration
    """
    camera_type = camera_data.get('type')
    if camera_type != 'kinesis':
        return  # No validation needed for other types
    
    camera_endpoint = camera_data.get('camera_endpoint')
    
    # camera_endpointがnone（または空）の場合、kinesis_streamarnが必須
    if not camera_endpoint or camera_endpoint.strip() == '' or camera_endpoint == 'none':
        kinesis_streamarn = (camera_data.get('kinesis_streamarn') or '').strip()
        
        if not kinesis_streamarn:
            raise HTTPException(
                status_code=400,
                detail="Kinesisカメラでカメラエンドポイントが未設定の場合、Kinesis Stream ARNは必須です。"
            )

def validate_rtsp_endpoint(camera_data: dict):
    """
    Validate RTSP endpoint configuration
    """
    camera_endpoint = camera_data.get('camera_endpoint')
    
    # camera_endpointが'rtsp'でない場合はバリデーション不要
    if camera_endpoint != 'rtsp':
        return
    
    # RTSP required fields validation
    rtsp_url = (camera_data.get('rtsp_url') or '').strip()
    
    if not rtsp_url:
        raise HTTPException(
            status_code=400,
            detail="camera_endpoint='rtsp'の場合、rtsp_urlは必須です。"
        )
    
    # RTSP URL format validation
    if not re.match(r'^rtsp://[^\s]+$', rtsp_url):
        raise HTTPException(
            status_code=400,
            detail="rtsp_urlの形式が正しくありません。例: rtsp://192.168.1.100:554/stream"
        )

def validate_rtmp_endpoint(camera_data: dict):
    """
    Validate RTMP endpoint configuration
    RTMPの場合はrtsp_urlは不要（自動生成）
    """
    camera_endpoint = camera_data.get('camera_endpoint')
    
    if camera_endpoint != 'rtmp':
        return
    
    # RTMPの場合、typeは必ずkinesisに設定
    if camera_data.get('type') != 'kinesis':
        raise HTTPException(
            status_code=400,
            detail="camera_endpoint='rtmp'の場合、typeは'kinesis'である必要があります"
        )

@router.post("/", status_code=status.HTTP_202_ACCEPTED)
async def create_new_camera(camera: CameraCreate, user: dict = Depends(get_current_user)):
    """
    Create a new camera (API + CloudFormation方式)
    
    カメラ作成処理を直接実行し、CloudFormationデプロイを開始します。
    CloudFormationの完了を待たずに即座にレスポンスを返却します。
    デプロイステータスは /camera/{camera_id}/deploy-status で確認してください。
    
    Returns:
        camera_id: カメラID
        status: デプロイステータス (deploying | deployed | pending)
        message: メッセージ
    """
    try:
        # camera_idが未指定なら自動発行
        camera_data = camera.model_dump()
        if not camera_data.get('camera_id'):
            camera_data['camera_id'] = str(uuid.uuid4())
        
        # Check if camera already exists
        existing_camera = db_get_camera(camera_data['camera_id'])
        if existing_camera:
            raise HTTPException(status_code=400, detail="Camera with this ID already exists")
        
        # バリデーション
        validate_vsaas_fields(camera_data)
        validate_kinesis_stream(camera_data)
        validate_rtsp_endpoint(camera_data)
        validate_rtmp_endpoint(camera_data)
        validate_aws_keys(camera_data)
        
        # s3タイプの場合、s3pathを自動生成
        if camera_data.get('type') == 's3':
            bucket_name = os.environ['BUCKET_NAME']
            camera_data['s3path'] = f"s3://{bucket_name}/endpoint/{camera_data['camera_id']}/"
        
        # DynamoDBに保存
        create_camera(camera_data)
        
        # エンドポイントに応じたデプロイ処理
        deploy_status = 'pending'
        camera_endpoint = camera_data.get('camera_endpoint')
        
        if camera_endpoint == 'rtsp':
            # RTSPエンドポイントの場合、CloudFormationデプロイ開始
            stream_name = f"{camera_data['camera_id']}-stream"
            rtsp_url = camera_data.get('rtsp_url')
            
            deploy_result = deploy_rtsp_receiver_cloudformation_stack(
                camera_id=camera_data['camera_id'],
                stream_name=stream_name,
                rtsp_url=rtsp_url,
                retention_period=camera_data.get('retention_period', '24'),
                fragment_duration=camera_data.get('fragment_duration', '500'),
                storage_size=camera_data.get('storage_size', '512')
            )
            
            if not deploy_result['success']:
                # デプロイ開始失敗
                raise HTTPException(
                    status_code=500,
                    detail=f"RTSPデプロイの開始に失敗しました: {deploy_result.get('error', 'Unknown error')}"
                )
            
            # DynamoDBを更新
            update_camera(camera_data['camera_id'], {
                'camera_endpoint_cloudformation_stack': deploy_result['stack_name']
            })
            
            deploy_status = 'deploying'
            
        elif camera_endpoint == 'rtmp':
            # RTMPエンドポイントの場合、共有NLB方式でデプロイ（非同期）
            stream_name = f"{camera_data['camera_id']}-stream"
            
            try:
                nlb_manager = RtmpNlbManager()
                deploy_result = nlb_manager.deploy_rtmp_server(
                    camera_id=camera_data['camera_id'],
                    stream_name=stream_name,
                    retention_period=camera_data.get('retention_period', '24'),
                    fragment_duration=camera_data.get('fragment_duration', '2000'),
                    storage_size=camera_data.get('storage_size', '512')
                )
                
                if not deploy_result['success']:
                    raise HTTPException(
                        status_code=500,
                        detail=f"RTMPデプロイの開始に失敗しました: {deploy_result.get('error', 'Unknown error')}"
                    )
                
                result_status = deploy_result.get('status')
                
                if result_status == 'nlb_creating':
                    # NLB作成中の場合
                    update_camera(camera_data['camera_id'], {
                        'rtmp_nlb_id': deploy_result['nlb_id'],
                        'rtmp_stream_key': deploy_result['stream_key'],
                        'rtmp_kvs_stream_name': stream_name,
                        'rtmp_deploy_status': 'nlb_creating'
                    })
                    deploy_status = 'deploying'  # フロントエンドには deploying として返す
                    
                elif result_status == 'deploying':
                    # RTMPサーバーデプロイ開始
                    update_camera(camera_data['camera_id'], {
                        'rtmp_nlb_id': deploy_result['nlb_id'],
                        'rtmp_port': deploy_result['port'],
                        'rtmp_stream_key': deploy_result['stream_key'],
                        'rtmp_endpoint': deploy_result['rtmp_endpoint'],
                        'rtmp_kvs_stream_name': stream_name,
                        'rtmp_server_stack': deploy_result['stack_name'],
                        'rtmp_deploy_status': 'deploying'
                    })
                    deploy_status = 'deploying'
                else:
                    deploy_status = 'deploying'
                
            except Exception as e:
                print(f"Error deploying RTMP server: {e}")
                raise HTTPException(
                    status_code=500,
                    detail=f"RTMPデプロイの開始に失敗しました: {str(e)}"
                )
        else:
            # RTSP/RTMP以外の場合は即座に完了
            deploy_status = 'deployed'
        
        # 即座にレスポンス返却（CloudFormationの完了を待たない）
        return {
            'camera_id': camera_data['camera_id'],
            'status': deploy_status,
            'message': 'カメラの作成を開始しました'
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error creating camera: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"カメラの作成に失敗しました: {str(e)}"
        )


@router.get("/{camera_id}/deploy-status")
async def get_camera_deploy_status(
    camera_id: str,
    user: dict = Depends(get_current_user)
):
    """
    カメラのデプロイステータスを取得（ポーリング用）
    statusはCloudFormationから動的に取得
    
    Args:
        camera_id: カメラID
    
    Returns:
        status: pending | deploying | deployed | failed
        camera: カメラ情報
        deploy_error: デプロイエラー（失敗時のみ）
    """
    # 1. DynamoDBからカメラ情報を取得
    camera = db_get_camera(camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
    
    # 2. CloudFormationステータスを動的に確認
    rtsp_stack_name = camera.get('camera_endpoint_cloudformation_stack')
    rtmp_stack_name = camera.get('rtmp_server_stack')
    rtmp_deploy_status = camera.get('rtmp_deploy_status')
    
    # 3. RTMPでNLB作成中の場合の処理
    if camera.get('camera_endpoint') == 'rtmp' and rtmp_deploy_status == 'nlb_creating':
        # NLBのステータスをチェック
        nlb_id = camera.get('rtmp_nlb_id')
        if nlb_id:
            try:
                nlb_manager = RtmpNlbManager()
                nlb = nlb_manager.check_and_update_nlb_status(nlb_id)
                
                if nlb and nlb.get('status') == 'active':
                    # NLB作成完了、RTMPサーバーのデプロイを開始
                    stream_name = camera.get('rtmp_kvs_stream_name', f"{camera_id}-stream")
                    stream_key = camera.get('rtmp_stream_key')
                    
                    deploy_result = nlb_manager.deploy_rtmp_server(
                        camera_id=camera_id,
                        stream_name=stream_name,
                        retention_period=camera.get('retention_period', '24'),
                        fragment_duration=camera.get('fragment_duration', '2000'),
                        storage_size=camera.get('storage_size', '512')
                    )
                    
                    if deploy_result['success'] and deploy_result.get('status') == 'deploying':
                        # RTMPサーバーデプロイ開始
                        update_camera(camera_id, {
                            'rtmp_port': deploy_result['port'],
                            'rtmp_endpoint': deploy_result['rtmp_endpoint'],
                            'rtmp_server_stack': deploy_result['stack_name'],
                            'rtmp_deploy_status': 'deploying'
                        })
                        camera['rtmp_port'] = deploy_result['port']
                        camera['rtmp_endpoint'] = deploy_result['rtmp_endpoint']
                        camera['rtmp_server_stack'] = deploy_result['stack_name']
                        camera['rtmp_deploy_status'] = 'deploying'
                        camera['status'] = 'deploying'
                    else:
                        camera['status'] = 'failed'
                        camera['deploy_error'] = deploy_result.get('error', 'Failed to start RTMP server deployment')
                elif nlb and nlb.get('status') == 'failed':
                    camera['status'] = 'failed'
                    camera['deploy_error'] = 'NLB creation failed'
                else:
                    # まだNLB作成中
                    camera['status'] = 'deploying'
            except Exception as e:
                print(f"Error checking NLB status: {e}")
                camera['status'] = 'deploying'
        else:
            camera['status'] = 'deploying'
        return camera
    
    if rtmp_stack_name:
        # RTMPサーバーの場合
        cf_status, message = check_stack_completion(rtmp_stack_name)
        
        if cf_status == 'SUCCESS':
            # デプロイ完了：Outputsから kinesis_streamarn を取得
            stack_info = get_stack_info(rtmp_stack_name)
            if stack_info and 'Outputs' in stack_info:
                outputs = {output['OutputKey']: output['OutputValue'] 
                          for output in stack_info.get('Outputs', [])}
                
                kvs_stream_arn = outputs.get('KinesisVideoStreamArn')
                
                # kinesis_streamarnをDynamoDBに保存（初回のみ）
                if kvs_stream_arn and not camera.get('kinesis_streamarn'):
                    update_camera(camera_id, {
                        'kinesis_streamarn': kvs_stream_arn,
                        'rtmp_deploy_status': 'deployed'
                    })
                    camera['kinesis_streamarn'] = kvs_stream_arn
            
            camera['status'] = 'deployed'
            
        elif cf_status == 'FAILED':
            camera['status'] = 'failed'
            
            # 失敗理由を詳細に取得
            failure_reason = get_stack_failure_reason(rtmp_stack_name)
            if failure_reason:
                camera['deploy_error'] = failure_reason
            else:
                camera['deploy_error'] = message
            
        elif cf_status in ['IN_PROGRESS', 'UNKNOWN']:
            camera['status'] = 'deploying'
        elif cf_status == 'NOT_FOUND':
            camera['status'] = 'deleted'
        else:
            camera['status'] = 'unknown'
            
    elif rtsp_stack_name:
        # RTSPの場合
        cf_status, message = check_stack_completion(rtsp_stack_name)
        
        if cf_status == 'SUCCESS':
            # デプロイ完了：Outputsから kinesis_streamarn を取得
            stack_info = get_stack_info(rtsp_stack_name)
            if stack_info and 'Outputs' in stack_info:
                outputs = {output['OutputKey']: output['OutputValue'] 
                          for output in stack_info.get('Outputs', [])}
                
                kvs_stream_arn = outputs.get('KinesisVideoStreamArn')
                
                # kinesis_streamarnをDynamoDBに保存（初回のみ）
                if kvs_stream_arn and not camera.get('kinesis_streamarn'):
                    update_camera(camera_id, {
                        'kinesis_streamarn': kvs_stream_arn
                    })
                    camera['kinesis_streamarn'] = kvs_stream_arn
            
            camera['status'] = 'deployed'
            
        elif cf_status == 'FAILED':
            camera['status'] = 'failed'
            
            # 失敗理由を詳細に取得
            failure_reason = get_stack_failure_reason(rtsp_stack_name)
            if failure_reason:
                camera['deploy_error'] = failure_reason
            else:
                camera['deploy_error'] = message
            
        elif cf_status in ['IN_PROGRESS', 'UNKNOWN']:
            camera['status'] = 'deploying'
        elif cf_status == 'NOT_FOUND':
            camera['status'] = 'deleted'
        else:
            camera['status'] = 'unknown'
    else:
        # スタック未作成（RTSP/RTMPでない場合）
        camera['status'] = 'deployed'
    
    return camera

@router.put("/{camera_id}", response_model=Camera)
async def update_existing_camera(camera_id: str, camera: Camera, user: dict = Depends(get_current_user)):
    """
    Update a camera
    """
    # Check if camera exists
    existing_camera = db_get_camera(camera_id)
    if not existing_camera:
        raise HTTPException(status_code=404, detail="Camera not found")
    
    camera_data = camera.model_dump()
    
    # s3タイプの場合、s3pathの変更を防ぐ（既存値を保持）
    if camera_data.get('type') == 's3' and existing_camera.get('type') == 's3':
        camera_data['s3path'] = existing_camera.get('s3path')
    
    # Validate AWS keys
    validate_aws_keys(camera_data)
    
    updated_camera = update_camera(camera_id, camera_data)
    if not updated_camera:
        raise HTTPException(status_code=500, detail="Failed to update camera")
    
    return updated_camera

@router.delete("/{camera_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_existing_camera(camera_id: str, cascade: bool = False, user: dict = Depends(get_current_user)):
    """
    Delete a camera (and related data if cascade)
    """
    # 1. カメラ情報を取得（CloudFormationスタック名を取得するため）
    camera = db_get_camera(camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
    
    # 2. CloudFormation Stackを削除（CAMERA_RESOURCE_DEPLOYの設定に従う）
    # 2-1. Camera endpoint stack (RTSP Receiver)
    camera_endpoint_stack = camera.get('camera_endpoint_cloudformation_stack')
    if camera_endpoint_stack:
        try:
            print(f"Deleting CloudFormation stack for camera endpoint: {camera_endpoint_stack}")
            delete_result = delete_cloudformation_stack(camera_endpoint_stack, resource_type='camera')
            if delete_result:
                print(f"✓ CloudFormation stack deletion initiated: {camera_endpoint_stack}")
            else:
                print(f"⚠️  CloudFormation stack deletion failed or skipped: {camera_endpoint_stack}")
        except Exception as e:
            print(f"Error deleting CloudFormation stack: {e}")
            # Continue with camera deletion even if CloudFormation deletion fails
    
    # 2-2. RTMP Server stack
    rtmp_server_stack = camera.get('rtmp_server_stack')
    if rtmp_server_stack:
        try:
            print(f"Deleting RTMP server for camera: {camera_id}")
            nlb_manager = RtmpNlbManager()
            undeploy_result = nlb_manager.undeploy_rtmp_server(camera_id)
            if undeploy_result['success']:
                print(f"✓ RTMP server deleted for camera: {camera_id}")
            else:
                print(f"⚠️  RTMP server deletion failed: {undeploy_result.get('error')}")
        except Exception as e:
            print(f"Error deleting RTMP server: {e}")
            # Continue with camera deletion even if RTMP server deletion fails
    
    # 3. Cascade削除（関連データの削除）
    session = create_boto3_session()
    dynamodb = session.resource('dynamodb')
    tables_to_cascade = [
        CAMERA_COLLECTOR_TABLE,
        FILE_TABLE,
        DETECTOR_TABLE,
        DETECT_LOG_TABLE,
        DETECT_LOG_TAG_TABLE,
        DETECT_TAG_TIMESERIES_TABLE,
        BOOKMARK_DETAIL_TABLE,
    ]
    if cascade:
        for table_name in tables_to_cascade:
            table = dynamodb.Table(table_name)
            
            # DETECT_LOG_TAG_TABLEは特別な処理（data_type = "CAMERA|{camera_id}"でquery）
            if table_name == DETECT_LOG_TAG_TABLE:
                data_type = f'CAMERA|{camera_id}'
                response = table.query(
                    KeyConditionExpression='data_type = :dt',
                    ExpressionAttributeValues={':dt': data_type}
                )
                items = response.get('Items', [])
                while 'LastEvaluatedKey' in response:
                    response = table.query(
                        KeyConditionExpression='data_type = :dt',
                        ExpressionAttributeValues={':dt': data_type},
                        ExclusiveStartKey=response['LastEvaluatedKey']
                    )
                    items.extend(response.get('Items', []))
                
                # 25件ずつバッチ削除
                for i in range(0, len(items), 25):
                    batch = items[i:i+25]
                    with table.batch_writer() as batch_writer:
                        for item in batch:
                            batch_writer.delete_item(Key={
                                'data_type': item['data_type'],
                                'detect_tag_name': item['detect_tag_name']
                            })
            else:
                # その他のテーブルはcamera_idでscan
                scan_kwargs = {
                    'FilterExpression': Attr('camera_id').eq(camera_id)
                }
                done = False
                start_key = None
                while not done:
                    if start_key:
                        scan_kwargs['ExclusiveStartKey'] = start_key
                    response = table.scan(**scan_kwargs)
                    items = response.get('Items', [])
                    # 25件ずつバッチ削除
                    for i in range(0, len(items), 25):
                        batch = items[i:i+25]
                        with table.batch_writer() as batch_writer:
                            for item in batch:
                                key = {k: item[k] for k in table.key_schema[0]['AttributeName'].split(',')}
                                # 主キーが複合の場合対応
                                for keydef in table.key_schema:
                                    key[keydef['AttributeName']] = item[keydef['AttributeName']]
                                batch_writer.delete_item(Key=key)
                    start_key = response.get('LastEvaluatedKey', None)
                    done = start_key is None
    
    # 4. カメラをDynamoDBから削除
    success = delete_camera(camera_id, cascade)
    if not success:
        raise HTTPException(status_code=404, detail="Camera not found")
    
    return None

@router.get("/{camera_id}/collectors")
async def get_camera_collectors_info(
    camera_id: str, 
    file_type: Optional[str] = Query(None, description="ファイルタイプでフィルタリング ('image' または 'video')"),
    user: dict = Depends(get_current_user)
):
    """
    Get camera collectors as a list of collector objects (for frontend editing screen)
    各コレクターにcollector_nameを付与
    カメラのtypeに応じて利用可能なコレクターのみを返す
    file_typeが指定された場合、collector_modeでさらにフィルタリング
    """
    try:
        # カメラ情報を取得してtypeを確認
        camera = db_get_camera(camera_id)
        if not camera:
            raise HTTPException(status_code=404, detail="Camera not found")
        
        camera_type = camera.get('type', '')
        
        collectors = get_camera_collectors_by_camera(camera_id)

        print(f"collectors: {collectors}")
        
        # カメラのtypeに応じてコレクターをフィルタリング
        filtered_collectors = []
        for c in collectors:
            collector_name = c.get('collector', '')
            
            # typeに応じたコレクターの利用可能性をチェック
            if camera_type == 's3' and collector_name in ['s3Rec', 's3Yolo']:
                # s3タイプのカメラではs3Rec, s3Yoloが利用可能
                filtered_collectors.append(c)
            elif camera_type == 'kinesis' and collector_name in ['hlsRec', 'hlsYolo']:
                # kinesisタイプのカメラではhlsRec, hlsYoloが利用可能
                filtered_collectors.append(c)
            elif camera_type == 'vsaas' and collector_name in ['hlsRec', 'hlsYolo']:
                # vsaasタイプのカメラではhlsRec, hlsYoloが利用可能
                filtered_collectors.append(c)
        
        # file_typeが指定された場合、collector_modeでさらにフィルタリング
        if file_type:
            if file_type not in ['image', 'video']:
                raise HTTPException(status_code=400, detail="file_type must be 'image' or 'video'")
            
            final_collectors = []
            for c in filtered_collectors:
                collector_mode = c.get('collector_mode', '')
                
                if file_type == 'image' and collector_mode in ['image', 'image_and_video']:
                    final_collectors.append(c)
                elif file_type == 'video' and collector_mode in ['video', 'image_and_video']:
                    final_collectors.append(c)
            
            filtered_collectors = final_collectors
        
        # collector_nameを付与
        for c in filtered_collectors:
            c['collector_name'] = COLLECTOR_NAME_MAP.get(c.get('collector'), c.get('collector', ''))
        
        return filtered_collectors
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error getting camera collectors: {e}")
        raise HTTPException(
            status_code=500,
            detail="Internal server error while fetching camera collectors"
        )

@router.get("/cameras/filtered", response_model=CameraFilterResponse)
async def get_filtered_cameras(
    place_ids: Optional[List[str]] = Query(None, description="場所IDのリスト"),
    search_term: Optional[str] = Query(None, description="検索キーワード"),
    page: int = Query(1, description="ページ番号", ge=1),
    limit: int = Query(20, description="1ページあたりの件数", ge=1, le=100),
    include_image: bool = Query(False, description="画像URLを含めるか"),
    current_user: dict = Depends(get_current_user)
):
    """
    フィルタリング条件とページングに対応したカメラ一覧取得
    """
    try:
        session = create_boto3_session()
        dynamodb = session.resource('dynamodb')
        
        # カメラテーブルから取得
        camera_table = dynamodb.Table(CAMERA_TABLE)
        response = camera_table.scan()
        all_cameras = response.get('Items', [])
        
        # 場所情報も取得
        place_table = dynamodb.Table(PLACE_TABLE)
        places_response = place_table.scan()
        places = {item['place_id']: item for item in places_response.get('Items', [])}
        
        # フィルタリング
        filtered_cameras = []
        for camera in all_cameras:
            # 場所フィルタ
            if place_ids and camera.get('place_id') not in place_ids:
                continue
                
            # 検索語フィルタ
            if search_term:
                search_lower = search_term.lower()
                camera_name = camera.get('name', '').lower()
                place_name = places.get(camera.get('place_id'), {}).get('name', '').lower()
                camera_id = camera.get('camera_id', '').lower()
                
                if not (search_lower in camera_name or 
                       search_lower in place_name or 
                       search_lower in camera_id):
                    continue
            
            # 場所名を追加
            place_info = places.get(camera.get('place_id'), {})
            camera_with_place = {
                **camera,
                'place_name': place_info.get('name', '場所不明')
            }
            
            # 画像URL追加（統一された方法で）
            if include_image and camera.get('capture'):
                try:
                    s3path = camera['capture']
                    presigned_url = generate_presigned_url(s3path, expiration=3600)
                    camera_with_place['presigned_url'] = presigned_url
                except Exception as e:
                    print(f"Error generating presigned URL for camera {camera['camera_id']}: {str(e)}")
                    camera_with_place['presigned_url'] = None
            
            filtered_cameras.append(camera_with_place)
        
        # ソート（カメラID順）
        filtered_cameras.sort(key=lambda x: x.get('camera_id', ''))
        
        # ページング計算
        total_count = len(filtered_cameras)
        total_pages = (total_count + limit - 1) // limit
        start_index = (page - 1) * limit
        end_index = start_index + limit
        
        paginated_cameras = filtered_cameras[start_index:end_index]
        
        # レスポンス構築
        pagination = {
            'current_page': page,
            'total_pages': total_pages,
            'total_count': total_count,
            'has_next': page < total_pages,
            'has_prev': page > 1,
            'limit': limit
        }
        
        print(f"Camera filtering: place_ids={place_ids}, search_term={search_term}, page={page}")
        print(f"Results: total={total_count}, page_items={len(paginated_cameras)}")
        
        return {
            "cameras": paginated_cameras,
            "pagination": pagination,
            "total_count": total_count
        }
        
    except Exception as e:
        print(f"Camera filtering error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"カメラ一覧取得エラー: {str(e)}")

@router.get("/cameras")
async def get_cameras_list(
    include_image: bool = False,
    current_user: dict = Depends(get_current_user)
):
    """カメラ一覧を取得"""
    try:
        session = create_boto3_session()
        dynamodb = session.resource('dynamodb')
        
        camera_table = dynamodb.Table(CAMERA_TABLE)
        response = camera_table.scan()
        
        cameras = []
        for item in response.get('Items', []):
            camera = dict(item)
            # 統一された方法でpresigned URL生成
            if include_image and camera.get('capture'):
                try:
                    s3path = camera['capture']
                    presigned_url = generate_presigned_url(s3path, expiration=3600)
                    camera['presigned_url'] = presigned_url
                except Exception as e:
                    print(f"Error generating presigned URL for camera {camera['camera_id']}: {str(e)}")
                    camera['presigned_url'] = None
            cameras.append(camera)
            
        return cameras
    except Exception as e:
        print(f"Error fetching cameras: {str(e)}")
        raise HTTPException(status_code=500, detail=f"カメラ一覧取得エラー: {str(e)}")

@router.get("/cameras/{camera_id}")
async def get_camera_detail(
    camera_id: str,
    include_image: bool = False,
    current_user: dict = Depends(get_current_user)
):
    """指定されたカメラの詳細を取得"""
    try:
        session = create_boto3_session()
        dynamodb = session.resource('dynamodb')
        
        camera_table = dynamodb.Table(CAMERA_TABLE)
        response = camera_table.get_item(Key={'camera_id': camera_id})
        
        if 'Item' not in response:
            raise HTTPException(status_code=404, detail=f"Camera {camera_id} not found")
        
        camera = dict(response['Item'])
        
        # 統一された方法でpresigned URL生成
        if include_image and camera.get('capture'):
            try:
                s3path = camera['capture']
                presigned_url = generate_presigned_url(s3path, expiration=3600)
                camera['presigned_url'] = presigned_url
            except Exception as e:
                print(f"Error generating presigned URL for camera {camera_id}: {str(e)}")
                camera['presigned_url'] = None
        
        return camera
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error fetching camera {camera_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"カメラ取得エラー: {str(e)}")

@router.post("/upload-test-movie")
async def upload_test_movie(
    camera_id: str = Query(..., description="カメラID"),
    filename: str = Query(..., description="ファイル名"),
    user: dict = Depends(get_current_user)
):
    """
    テスト用動画ファイルアップロード用の署名付きURLを生成
    """
    try:
        # ファイル形式チェック
        if not filename.lower().endswith('.mp4'):
            raise HTTPException(
                status_code=400,
                detail="MP4ファイルのみアップロード可能です"
            )
        
        # S3バケット名を取得（CameraBucketを使用）
        bucket_name = os.environ['BUCKET_NAME']
        
        # アップロード先のS3パスを生成（指定された形式）
        s3_key = f"rtsp_movie/{camera_id}/sample.mp4"
        s3_path = f"s3://{bucket_name}/{s3_key}"
        
        # S3の署名付きURLを生成（PUT用、有効期限5分）
        # NOTE: ContentTypeを指定するとCORS preflightが必要になるため、
        #       ブラウザからの直接アップロードでは指定しない
        presigned_url = s3_client.generate_presigned_url(
            ClientMethod='put_object',
            Params={
                'Bucket': bucket_name,
                'Key': s3_key
            },
            ExpiresIn=300  # 5分間有効
        )
        
        # デバッグ用：生成されたURLをログ出力
        print(f"Generated presigned URL: {presigned_url}")
        
        return {
            "success": True,
            "upload_url": presigned_url,
            "s3_path": s3_path,
            "filename": filename
        }
        
    except Exception as e:
        print(f"Error generating presigned URL: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"アップロードURLの生成に失敗しました: {str(e)}"
        )
