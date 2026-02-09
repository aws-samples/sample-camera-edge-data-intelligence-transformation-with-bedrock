from fastapi import APIRouter, Depends, HTTPException, status
from typing import List, Optional
import sys
import os
from pathlib import Path
import boto3

# Add shared modules to path
backend_path = Path(__file__).parent.parent.parent.parent
sys.path.append(str(backend_path / "shared"))

from shared.models.models import CameraCollector, CameraCollectorCreate, CameraCollectorUpdate
from shared.database import (
    get_all_camera_collectors, get_camera_collectors_by_camera, get_camera_collector,
    create_camera_collector, delete_collector, get_camera, update_collector, get_collector_by_id
)
from shared.auth import get_current_user
from collector.deployment.hlsrec.deploy_collector import deploy_cloudformation_stack as deploy_hlsrec_stack
from collector.deployment.hlsyolo.deploy_collector import deploy_cloudformation_stack as deploy_hlsyolo_stack
from collector.deployment.s3rec.deploy_collector import deploy_cloudformation_stack as deploy_s3rec_stack
from collector.deployment.s3yolo.deploy_collector import deploy_cloudformation_stack as deploy_s3yolo_stack
from shared.common import *
from pydantic import BaseModel
import logging

logger = setup_logger('camera_collector')


async def restart_collector_task(collector: dict) -> bool:
    """
    コレクターのECSタスクを停止して再起動をトリガー
    
    ECSサービスのdesiredCount=1のため、タスク停止後は自動的に新しいタスクが起動される。
    これにより、コレクターは最新の設定をDynamoDBから読み込み直す。
    
    Args:
        collector: コレクター情報（camera_id, collector_id, collector を含む）
        
    Returns:
        成功時True、失敗時False
    """
    try:
        camera_id = collector.get('camera_id')
        collector_id = collector.get('collector_id')
        collector_type = collector.get('collector')
        
        # s3Recの場合はLambda関数なのでタスク停止は不要
        if collector_type == 's3Rec':
            logger.info(f"s3Recコレクターはタスク停止不要（Lambda）: collector_id={collector_id}")
            return True
        
        # CloudFormationスタックが設定されていない場合はスキップ
        if not collector.get('cloudformation_stack'):
            logger.info(f"CloudFormationスタック未設定のためタスク停止をスキップ: collector_id={collector_id}")
            return True
        
        # ECSクラスター名をSSMから取得
        cluster_name = get_parameter_from_store('/Cedix/Main/CameraClusterName')
        if not cluster_name:
            logger.error("ECSクラスター名の取得に失敗しました")
            return False
        
        # ECSサービス名は {camera_id}-{collector_id}-service のパターン
        service_name = f"{camera_id}-{collector_id}-service"
        
        logger.info(f"ECSタスク停止開始: cluster={cluster_name}, service={service_name}")
        
        # ECSクライアント作成
        session = create_boto3_session()
        ecs_client = session.client('ecs')
        
        # 現在実行中のタスクを取得
        tasks_response = ecs_client.list_tasks(
            cluster=cluster_name,
            serviceName=service_name,
            desiredStatus='RUNNING'
        )
        
        task_arns = tasks_response.get('taskArns', [])
        
        if not task_arns:
            logger.info(f"実行中のタスクがありません: service={service_name}")
            return True
        
        # タスクを停止
        stopped_count = 0
        for task_arn in task_arns:
            try:
                ecs_client.stop_task(
                    cluster=cluster_name,
                    task=task_arn,
                    reason='Collector configuration updated via API'
                )
                stopped_count += 1
                logger.info(f"ECSタスク停止成功: {task_arn}")
            except Exception as e:
                logger.error(f"ECSタスク停止エラー: task={task_arn}, error={e}")
        
        logger.info(f"ECSタスク停止完了: {stopped_count}/{len(task_arns)} タスクを停止")
        return stopped_count > 0
        
    except Exception as e:
        logger.error(f"ECSタスク再起動エラー: collector_id={collector.get('collector_id')}, error={e}")
        import traceback
        logger.error(f"詳細: {traceback.format_exc()}")
        return False

router = APIRouter()

# CloudFormation関連のリクエストモデル
class CloudFormationDeployRequest(BaseModel):
    camera_id: str
    collector: str
    source_s3_bucket: Optional[str] = None  # s3Rec用

class CloudFormationResponse(BaseModel):
    success: bool
    message: str
    stack_name: Optional[str] = None

class CloudFormationStatusResponse(BaseModel):
    status: str
    message: str
    stack_name: Optional[str] = None

async def _deploy_cloudformation_internal(camera_id: str, collector: str, collector_id: str, source_s3_bucket: Optional[str] = None) -> Optional[str]:
    """
    CloudFormationスタックのデプロイ処理（内部使用）
    """
    try:
        # collectorに応じて適切なデプロイ関数を呼び出し
        if collector == "hlsRec":
            return deploy_hlsrec_stack(camera_id, collector_id)
        elif collector == "hlsYolo":
            return deploy_hlsyolo_stack(camera_id, collector_id)
        elif collector == "s3Rec":
            if not source_s3_bucket:
                logger.warning(f"s3Recコレクターにsource_s3_bucketが指定されていません: camera_id={camera_id}")
                return None
            return deploy_s3rec_stack(camera_id, collector_id, source_s3_bucket)
        elif collector == "s3Yolo":
            if not source_s3_bucket:
                logger.warning(f"s3Yoloコレクターにsource_s3_bucketが指定されていません: camera_id={camera_id}")
                return None
            return deploy_s3yolo_stack(camera_id, collector_id, source_s3_bucket)
        else:
            logger.warning(f"未対応のコレクタータイプ: {collector}, camera_id={camera_id}")
            return None
    except Exception as e:
        logger.error(f"CloudFormationデプロイ内部エラー: camera_id={camera_id}, collector={collector}, error={e}")
        import traceback
        logger.error(f"CloudFormationデプロイ内部エラー詳細: {traceback.format_exc()}")
        return None

async def _remove_cloudformation_internal(stack_name: str) -> Optional[str]:
    """
    CloudFormationスタックの削除処理（内部使用）
    """
    try:
        # stack_name is now passed directly
        result = delete_cloudformation_stack(stack_name, resource_type='collection')
        return result
    except Exception as e:
        logger.error(f"CloudFormation削除内部エラー: stack_name={stack_name}, error={e}")
        import traceback
        logger.error(f"CloudFormation削除内部エラー詳細: {traceback.format_exc()}")
        return None

@router.get("/", response_model=List[CameraCollector])
async def read_camera_collectors(camera_id: str = None, user: dict = Depends(get_current_user)):
    """
    カメラコレクターの一覧を取得
    カメラIDが指定された場合は、そのカメラのコレクターのみを返す
    """
    if camera_id:
        return get_camera_collectors_by_camera(camera_id)
    else:
        return get_all_camera_collectors()

@router.get("/{collector_id}", response_model=CameraCollector)
async def read_camera_collector_by_id(collector_id: str, user: dict = Depends(get_current_user)):
    """
    collector_idでカメラコレクターを取得
    """
    collector = get_collector_by_id(collector_id)
    if collector is None:
        raise HTTPException(status_code=404, detail="Camera collector not found")
    return collector

@router.post("/", response_model=CameraCollector, status_code=status.HTTP_201_CREATED)
async def create_new_camera_collector(collector: CameraCollectorCreate, user: dict = Depends(get_current_user)):
    """
    新しいカメラコレクターを作成（CloudFormationスタックも自動デプロイ）
    同じカメラに同じコレクター名を複数登録可能
    """
    # カメラの存在確認
    camera = get_camera(collector.camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail=f"Camera with ID {collector.camera_id} not found")
    
    # s3Recコレクターのバリデーション
    if collector.collector == "s3Rec":
        # カメラタイプがs3であることを確認
        if camera.get('type') != 's3':
            raise HTTPException(
                status_code=400,
                detail="s3Recコレクターはtype='s3'のカメラでのみ作成可能です"
            )
        
        # s3pathが設定されていることを確認
        if not camera.get('s3path'):
            raise HTTPException(
                status_code=400,
                detail="カメラのs3pathが設定されていません"
            )
    
    # s3Yoloコレクターのバリデーション
    if collector.collector == "s3Yolo":
        # カメラタイプがs3であることを確認
        if camera.get('type') != 's3':
            raise HTTPException(
                status_code=400,
                detail="s3Yoloコレクターはtype='s3'のカメラでのみ作成可能です"
            )
        
        # s3pathが設定されていることを確認
        if not camera.get('s3path'):
            raise HTTPException(
                status_code=400,
                detail="カメラのs3pathが設定されていません"
            )
        
    # コレクターデータを準備
    collector_data = collector.model_dump()
    
    # collector_idが指定されていない場合はUUIDを生成
    if not collector_data.get('collector_id'):
        import uuid
        collector_data['collector_id'] = str(uuid.uuid4())
    
    # コレクターを作成
    created_collector = create_camera_collector(collector_data)
    
    # CloudFormationスタックを自動デプロイ
    try:
        # 環境変数チェック
        deploy_enabled = os.getenv('COLLECTION_RESOURCE_DEPLOY', 'off').lower() == 'on'
        
        if not deploy_enabled:
            logger.info(f"CloudFormation自動デプロイはスキップされました（COLLECTION_RESOURCE_DEPLOY=off）: collector_id={created_collector['collector_id']}")
            return created_collector
        
        logger.info(f"CloudFormation自動デプロイ開始: camera_id={collector.camera_id}, collector={collector.collector}, collector_id={created_collector['collector_id']}")
        
        # s3Rec/s3Yoloの場合はカメラのs3pathからバケット名を抽出
        source_s3_bucket = None
        if collector.collector in ["s3Rec", "s3Yolo"]:
            camera = get_camera(collector.camera_id)
            s3path = camera.get('s3path', '')  # 例: s3://bucket-name/endpoint/camera-id/
            # s3://bucket-name/ の部分からバケット名を抽出
            if s3path.startswith('s3://'):
                source_s3_bucket = s3path.split('/')[2]  # bucket-name
                logger.info(f"{collector.collector}コレクター: s3pathからバケット名を抽出: {source_s3_bucket}")
        
        stack_name = await _deploy_cloudformation_internal(
            collector.camera_id, 
            collector.collector, 
            created_collector['collector_id'],
            source_s3_bucket=source_s3_bucket
        )
        
        if stack_name:
            logger.info(f"CloudFormation自動デプロイ成功: stack_name={stack_name}")
            
            # コレクターのcloudformation_stackフィールドを更新
            try:
                update_data = {'cloudformation_stack': stack_name}
                updated_collector = update_collector(created_collector['collector_id'], update_data)
                logger.info(f"コレクターのcloudformation_stack更新完了: {stack_name}")
                return updated_collector
            except Exception as update_error:
                logger.error(f"コレクターのcloudformation_stack更新エラー: {update_error}")
                # 更新エラーでも作成済みのコレクターを返す
                return created_collector
        else:
            logger.warning(f"CloudFormation自動デプロイに失敗しました: camera_id={collector.camera_id}, collector={collector.collector}")
            
    except Exception as e:
        logger.error(f"CloudFormation自動デプロイエラー（コレクター作成は成功）: {e}")
        # CloudFormationエラーでもコレクターは作成済みなのでエラーにしない
    
    return created_collector

@router.delete("/{collector_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_existing_camera_collector(
    collector_id: str, 
    user: dict = Depends(get_current_user)
):
    """
    collector_idでカメラコレクターを削除（CloudFormationスタックも自動削除）
    
    Note:
        配下にDetectorが存在する場合は削除を拒否します
    """
    import boto3
    from boto3.dynamodb.conditions import Key
    
    # まず削除対象のコレクターデータを取得
    target_collector = get_collector_by_id(collector_id)
    if not target_collector:
        raise HTTPException(status_code=404, detail="Camera collector not found")
    
    camera_id = target_collector.get('camera_id')
    collector_name = target_collector.get('collector')
    
    # 配下のDetectorを検索（GSI-2を使用）
    session = create_boto3_session()
    dynamodb = session.resource('dynamodb')
    detector_table = dynamodb.Table(DETECTOR_TABLE)
    
    try:
        response = detector_table.query(
            IndexName='globalindex2',
            KeyConditionExpression=Key('camera_id').eq(camera_id) & Key('collector_id').eq(collector_id)
        )
        
        detectors = response.get('Items', [])
        
        # 仮想 Detector（collector-internal）とユーザー作成 Detector を分離
        virtual_detectors = [d for d in detectors if d.get('is_virtual', False)]
        user_detectors = [d for d in detectors if not d.get('is_virtual', False)]
        
        # ユーザー作成の Detector が存在する場合は削除を拒否
        if user_detectors:
            detector_names = [d.get('detector', 'Unknown') for d in user_detectors]
            raise HTTPException(
                status_code=400, 
                detail=f"このコレクターには {len(user_detectors)} 個のDetectorが紐づいています（{', '.join(detector_names)}）。先にDetectorを削除してください。"
            )
        
        # 仮想 Detector（collector-internal）は自動削除
        for detector in virtual_detectors:
            detector_id = detector.get('detector_id')
            if detector_id:
                detector_table.delete_item(Key={'detector_id': detector_id})
                logger.info(f"仮想 Detector を自動削除: detector_id={detector_id}")
                
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Detector存在チェック/削除エラー: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to check/delete detectors: {str(e)}")
    
    # CloudFormationスタックを先に削除
    try:
        logger.info(f"CloudFormation自動削除開始: collector_id={collector_id}, camera_id={camera_id}, collector={collector_name}")
        
        # コレクターのcloudformation_stackフィールドからスタック名を取得
        stack_name = target_collector.get('cloudformation_stack')
        if stack_name:
            result = await _remove_cloudformation_internal(stack_name)
            
            if result:
                logger.info(f"CloudFormation自動削除開始成功: {result}")
            else:
                logger.warning(f"CloudFormation自動削除に失敗しました: stack_name={stack_name}")
        else:
            logger.info(f"CloudFormationスタック名が未設定のため、スタック削除をスキップします")
            
    except Exception as e:
        logger.error(f"CloudFormation自動削除エラー: {e}")
        # CloudFormationエラーでも後続のコレクター削除は実行
    
    # コレクターを削除
    success = delete_collector(collector_id)
    if not success:
        # この時点では既にコレクターが存在することを確認済みなので、削除失敗は異常
        logger.error(f"コレクター削除に失敗: collector_id={collector_id}")
        raise HTTPException(status_code=500, detail="Failed to delete camera collector")
    
    logger.info(f"コレクター削除完了: collector_id={collector_id}, camera_id={camera_id}, collector={collector_name}")
    return None

@router.put("/{collector_id}", response_model=CameraCollector)
async def update_existing_camera_collector(
    collector_id: str,
    collector_update: CameraCollectorUpdate,
    user: dict = Depends(get_current_user)
):
    """
    collector_idでカメラコレクターの動作設定を更新
    
    更新可能なフィールド:
    - capture_image_interval
    - capture_video_duration
    - capture_track_interval
    - collect_class
    - track_eventtype
    - detect_area
    - area_detect_type
    - area_detect_iou_threshold
    - area_detect_method
    - capture_track_image_flg
    - capture_track_image_counter
    - model_path
    
    基本設定（collector, collector_mode）は変更不可
    """
    from datetime import datetime, timezone
    
    # まず対象のコレクターを取得
    target_collector = get_collector_by_id(collector_id)
    if not target_collector:
        raise HTTPException(status_code=404, detail="Camera collector not found")
    
    camera_id = target_collector.get('camera_id')
    collector_name = target_collector.get('collector')
    
    # 更新データを準備（Noneでないフィールドのみ）
    update_data = collector_update.model_dump(exclude_unset=True)
    
    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")
    
    # DynamoDB用に数値型をDecimalに変換
    from decimal import Decimal
    if 'area_detect_iou_threshold' in update_data and update_data['area_detect_iou_threshold'] is not None:
        update_data['area_detect_iou_threshold'] = Decimal(str(update_data['area_detect_iou_threshold']))
    
    # コレクターを更新
    try:
        updated_collector = update_collector(collector_id, update_data)
        logger.info(f"コレクター更新完了: collector_id={collector_id}, camera_id={camera_id}, collector={collector_name}, updated_fields={list(update_data.keys())}")
        
        # ECSタスクを停止して再起動をトリガー（設定変更を即時反映）
        # s3Recの場合はLambdaなのでスキップされる
        restart_success = await restart_collector_task(updated_collector)
        if restart_success:
            logger.info(f"コレクター再起動トリガー完了: collector_id={collector_id}")
        else:
            logger.warning(f"コレクター再起動トリガーに失敗しましたが、設定は保存されています: collector_id={collector_id}")
        
        return updated_collector
    except Exception as e:
        logger.error(f"コレクター更新エラー: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to update camera collector: {str(e)}")

# @router.post("/deploy", response_model=CloudFormationResponse)
# async def deploy_cloudformation(
#     request: CloudFormationDeployRequest,
#     user: dict = Depends(get_current_user)
# ):
#     """
#     CloudFormationスタックをデプロイ
#     """
#     try:
#         camera_id = request.camera_id
#         collector = request.collector
        
#         logger.info(f"CloudFormationデプロイ開始: camera_id={camera_id}, collector={collector}")
        
#         stack_name = await _deploy_cloudformation_internal(camera_id, collector, request.schedule_expression, request.source_s3_bucket)
        
#         if stack_name:
#             logger.info(f"CloudFormationデプロイ成功: stack_name={stack_name}")
#             return CloudFormationResponse(
#                 success=True,
#                 message="CloudFormation deployment started successfully",
#                 stack_name=stack_name
#             )
#         else:
#             logger.error("CloudFormationデプロイ失敗")
#             return CloudFormationResponse(
#                 success=False,
#                 message="CloudFormation deployment failed"
#             )
            
#     except HTTPException:
#         raise
#     except Exception as e:
#         logger.error(f"CloudFormationデプロイエラー: {e}")
#         raise HTTPException(status_code=500, detail=f"Deployment error: {str(e)}")

@router.get("/deploy-status/{collector_id}", response_model=CloudFormationStatusResponse)
async def deploy_cloudformation_check(
    collector_id: str,
    user: dict = Depends(get_current_user)
):
    """
    collector_idでCloudFormationスタックのデプロイ状態をチェック
    """
    try:
        # collector_idからコレクター情報を取得
        collector_info = get_collector_by_id(collector_id)
        if not collector_info:
            raise HTTPException(status_code=404, detail="Collector not found")
        
        # コレクターに保存されているcloudformation_stackフィールドから直接スタック名を取得
        stack_name = collector_info.get('cloudformation_stack')
        
        if not stack_name:
            # スタック名が未設定の場合
            return CloudFormationStatusResponse(
                status="NOT_FOUND",
                message="CloudFormationスタックが設定されていません",
                stack_name=None
            )
        
        # スタック作成状態をチェック
        status_result, message = check_stack_creation(stack_name)
        
        return CloudFormationStatusResponse(
            status=status_result,
            message=message,
            stack_name=stack_name
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"デプロイ状態チェックエラー: {e}")
        raise HTTPException(status_code=500, detail=f"Status check error: {str(e)}")

# @router.delete("/deploy/{camera_id}/{collector}", response_model=CloudFormationResponse)
# async def remove_cloudformation(
#     camera_id: str,
#     collector: str,
#     user: dict = Depends(get_current_user)
# ):
#     """
#     CloudFormationスタックを削除
#     """
#     try:
#         # スタック名を取得
#         stack_name = get_service_stack_name(camera_id, collector)
#         if not stack_name:
#             raise HTTPException(status_code=400, detail="Failed to generate stack name")
        
#         logger.info(f"CloudFormationスタック削除開始: stack_name={stack_name}")
        
#         # スタックを削除
#         result = delete_cloudformation_stack(stack_name)
        
#         if result:
#             logger.info(f"CloudFormationスタック削除開始: {result}")
#             return CloudFormationResponse(
#                 success=True,
#                 message="CloudFormation stack deletion started successfully",
#                 stack_name=result
#             )
#         else:
#             logger.error("CloudFormationスタック削除失敗")
#             return CloudFormationResponse(
#                 success=False,
#                 message="CloudFormation stack deletion failed"
#             )
            
#     except Exception as e:
#         logger.error(f"CloudFormationスタック削除エラー: {e}")
#         raise HTTPException(status_code=500, detail=f"Deletion error: {str(e)}")

@router.get("/remove-status/{collector_id}", response_model=CloudFormationStatusResponse)
async def remove_cloudformation_check(
    collector_id: str,
    user: dict = Depends(get_current_user)
):
    """
    collector_idでCloudFormationスタックの削除状態をチェック
    """
    try:
        # collector_idからコレクター情報を取得
        collector_info = get_collector_by_id(collector_id)
        if not collector_info:
            raise HTTPException(status_code=404, detail="Collector not found")
        
        # コレクターに保存されているcloudformation_stackフィールドから直接スタック名を取得
        stack_name = collector_info.get('cloudformation_stack')
        
        if not stack_name:
            # スタック名が未設定の場合
            return CloudFormationStatusResponse(
                status="NOT_FOUND",
                message="CloudFormationスタックが設定されていません",
                stack_name=None
            )
        
        # スタック削除状態をチェック
        status_result, message = check_stack_deletion(stack_name)
        
        return CloudFormationStatusResponse(
            status=status_result,
            message=message,
            stack_name=stack_name
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"削除状態チェックエラー: {e}")
        raise HTTPException(status_code=500, detail=f"Status check error: {str(e)}") 