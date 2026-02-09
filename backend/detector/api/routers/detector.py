from fastapi import APIRouter, HTTPException, Depends
from typing import List, Optional, Dict, Any
from pydantic import BaseModel
from shared.auth import get_current_user
from botocore.exceptions import ClientError
from decimal import Decimal
from shared.common import *
from shared.timezone_utils import now_utc_str
import logging

router = APIRouter()

# Initialize DynamoDB resource
session = create_boto3_session()
dynamodb = session.resource('dynamodb')

# ロガーの設定
logger = setup_logger(__name__)

def get_bedrock_lambda_arn() -> Optional[str]:
    """
    SSM Parameter StoreからBedrock Lambda ARNを取得
    
    Returns:
        str: Bedrock Lambda ARN（取得失敗時はNone）
    """
    try:
        ssm_client = session.client('ssm')
        response = ssm_client.get_parameter(
            Name='/Cedix/Detector/BedrockFunctionArn'
        )
        arn = response['Parameter']['Value']
        logger.info(f"Bedrock Lambda ARN取得成功: {arn}")
        return arn
    except Exception as e:
        logger.error(f"Bedrock Lambda ARN取得エラー: {e}")
        return None

async def update_collector_related_time(collector_id: str):
    """
    コレクターの related_data_update_time を更新
    デテクターの追加/更新/削除時に呼び出される
    
    Args:
        collector_id: コレクターID
    """
    from datetime import datetime, timezone
    from shared.database import update_collector
    
    update_data = {
        'related_data_update_time': now_utc_str()
    }
    
    try:
        update_collector(collector_id, update_data)
        logger.info(f"Updated related_data_update_time for collector_id={collector_id}")
    except Exception as e:
        logger.error(f"Failed to update related_data_update_time for collector_id={collector_id}: {e}")

@router.get("/trigger-events")
async def get_trigger_events(
    collector_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    指定されたコレクターで利用可能なトリガーイベントのリストを返す
    
    Args:
        collector_id: コレクターID
        
    Returns:
        dict: {"trigger_events": [{"value": "SaveImageEvent", "label": "..."}]}
    """
    try:
        from shared.database import get_collector_by_id
        
        # collector情報を取得
        collector_info = get_collector_by_id(collector_id)
        if not collector_info:
            raise HTTPException(status_code=404, detail=f"Collector not found: {collector_id}")
        
        collector = collector_info.get('collector', '')
        collector_mode = collector_info.get('collector_mode', 'image')
        
        # collector_modeに基づいてイベントリストを構築
        events = []
        
        if collector_mode in ['image', 'image_and_video']:
            events.append({"value": "SaveImageEvent", "label": "SaveImageEvent（画像保存時）"})
        
        if collector_mode in ['video', 'image_and_video']:
            events.append({"value": "SaveVideoEvent", "label": "SaveVideoEvent（動画保存時）"})
        
        # hlsYolo の場合のみ追加イベント
        if collector == 'hlsYolo':
            events.extend([
                {"value": "ClassDetectEvent", "label": "ClassDetectEvent（クラス検知時）"},
                {"value": "AreaDetectEvent", "label": "AreaDetectEvent（エリア検知時）"}
            ])
        
        logger.info(f"Trigger events for collector_id={collector_id}, collector={collector}, collector_mode={collector_mode}: {len(events)} events")
        
        return {"trigger_events": events}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting trigger events: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@router.get("/cameras/{camera_id}/detectors")
async def get_camera_detectors(
    camera_id: str,
    collector_id: Optional[str] = None,
    file_type: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """
    指定されたカメラ、コレクターID、ファイルタイプの検知器一覧を取得
    """
    try:
        from boto3.dynamodb.conditions import Key, Attr
        table = dynamodb.Table(DETECTOR_TABLE)
        
        if collector_id:
            # GSI-2を使ってcamera_id + collector_idで検索
            response = table.query(
                IndexName='globalindex2',
                KeyConditionExpression=Key('camera_id').eq(camera_id) & Key('collector_id').eq(collector_id)
            )
            detectors = response.get('Items', [])
            
            # file_typeでフィルタ（オプション）
            if file_type:
                detectors = [d for d in detectors if d.get('file_type') == file_type]
        else:
            # collector_idが指定されていない場合、camera_idで検索
            response = table.query(
                IndexName='globalindex2',
                KeyConditionExpression=Key('camera_id').eq(camera_id)
            )
            detectors = response.get('Items', [])
            
            # file_typeでフィルタ（オプション）
            if file_type:
                detectors = [d for d in detectors if d.get('file_type') == file_type]
        
        return {"detectors": detectors}
    
    except ClientError as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@router.get("/detectors/{detector_id}")
async def get_detector_details(
    detector_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    指定された検知器の詳細情報を取得
    """
    try:
        table = dynamodb.Table(DETECTOR_TABLE)
        
        # detector_idで直接取得（Primary Key）
        response = table.get_item(
            Key={'detector_id': detector_id}
        )
        
        if 'Item' not in response:
            raise HTTPException(status_code=404, detail="Detector not found")
        
        return response['Item']
        
    except ClientError as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@router.post("/", response_model=Dict[str, Any])
async def create_detector(
    detector_data: Dict[str, Any],
    current_user: dict = Depends(get_current_user)
):
    """
    検知器を作成（EventBridgeルールも自動デプロイ）
    """
    try:
        import uuid
        from shared.database import get_camera_collector
        table = dynamodb.Table(DETECTOR_TABLE)
        
        # detector_idの生成
        detector_id = str(uuid.uuid4())
        detector_data['detector_id'] = detector_id
        
        # collector_id_file_typeキーの作成
        camera_id = detector_data.get('camera_id')
        file_type = detector_data.get('file_type')
        
        # 新規: collector_idが直接渡された場合（推奨）
        if 'collector_id' in detector_data:
            collector_id = detector_data['collector_id']
        # 従来: collector名が渡された場合（後方互換性）
        elif 'collector' in detector_data:
            collector_name = detector_data.get('collector')
            if camera_id and collector_name:
                collector_info = get_camera_collector(camera_id, collector_name)
                if not collector_info:
                    raise HTTPException(status_code=404, detail=f"Collector not found: {collector_name}")
                collector_id = collector_info.get('collector_id')
                detector_data['collector_id'] = collector_id
            else:
                raise HTTPException(status_code=400, detail="camera_id and collector are required when collector_id is not provided")
        else:
            raise HTTPException(status_code=400, detail="collector_id or collector is required")
        
        if file_type:
            detector_data['collector_id_file_type'] = f"{collector_id}|{file_type}"
        
        # collectorフィールドは削除（名前は保存しない、collector_idのみ保存）
        if 'collector' in detector_data:
            del detector_data['collector']
        
        # 数値型フィールドの型変換とデフォルト値設定
        if 'max_tokens' in detector_data:
            try:
                detector_data['max_tokens'] = int(detector_data['max_tokens'])
            except (ValueError, TypeError):
                detector_data['max_tokens'] = 2000
        else:
            detector_data['max_tokens'] = 2000
            
        # temperature: 値があればDecimal変換、なければ明示的にNone
        if 'temperature' in detector_data and detector_data['temperature'] is not None and detector_data['temperature'] != '':
            try:
                detector_data['temperature'] = Decimal(str(detector_data['temperature']))
            except (ValueError, TypeError):
                detector_data['temperature'] = None  # 変換失敗時はnull
        else:
            detector_data['temperature'] = None  # 明示的にnull
            
        # top_p: 値があればDecimal変換、なければ明示的にNone
        if 'top_p' in detector_data and detector_data['top_p'] is not None and detector_data['top_p'] != '':
            try:
                detector_data['top_p'] = Decimal(str(detector_data['top_p']))
            except (ValueError, TypeError):
                detector_data['top_p'] = None  # 変換失敗時はnull
        else:
            detector_data['top_p'] = None  # 明示的にnull
        
        # detect_interval の型変換とデフォルト値設定
        if 'detect_interval' in detector_data:
            try:
                detector_data['detect_interval'] = int(detector_data['detect_interval'])
            except (ValueError, TypeError):
                detector_data['detect_interval'] = 5000
        else:
            detector_data['detect_interval'] = 5000
        
        # trigger_event のデフォルト値設定
        if 'trigger_event' not in detector_data or not detector_data['trigger_event']:
            detector_data['trigger_event'] = 'SaveImageEvent'
        
        # lambda_endpoint_arn の設定（detectorタイプに応じて）
        detector_type = detector_data.get('detector')
        
        if detector_type == 'bedrock':
            # bedrockの場合: SSM Parameter StoreからLambda ARNを自動取得
            bedrock_lambda_arn = get_bedrock_lambda_arn()
            if bedrock_lambda_arn:
                detector_data['lambda_endpoint_arn'] = bedrock_lambda_arn
                logger.info(f"Bedrock Lambda ARN自動設定: {bedrock_lambda_arn}")
            else:
                logger.warning("Bedrock Lambda ARNの取得に失敗しました。lambda_endpoint_arnは未設定です。")
        
        elif detector_type == 'custom':
            # customの場合: lambda_endpoint_arnが必須
            if not detector_data.get('lambda_endpoint_arn'):
                raise HTTPException(
                    status_code=400, 
                    detail="detector='custom'の場合、lambda_endpoint_arnは必須です。"
                )
            logger.info(f"Custom Lambda ARN設定: {detector_data.get('lambda_endpoint_arn')}")
        
        # 新しいデータ構造をそのまま保存
        table.put_item(Item=detector_data)
        
        # Detector個別EventBridge Ruleを作成（疎結合: collector_id でフィルタリング）
        if detector_data.get('lambda_endpoint_arn'):
            try:
                from detector.deployment.detector_eventbridge_rule import create_detector_eventbridge_rule
                from shared.common import is_detector_resource_deploy_enabled
                
                # Detectorリソースデプロイチェック
                if not is_detector_resource_deploy_enabled():
                    logger.info(f"[DISABLED] DETECTOR_RESOURCE_DEPLOY=off: EventBridge Rule作成スキップ: detector_id={detector_id}")
                else:
                    rule_arn = create_detector_eventbridge_rule(
                        detector_id=detector_id,
                        collector_id=collector_id,
                        trigger_event=detector_data.get('trigger_event', 'SaveImageEvent'),
                        lambda_endpoint_arn=detector_data['lambda_endpoint_arn']
                    )
                    
                    if rule_arn:
                        logger.info(f"Detector EventBridge Rule作成成功: detector_id={detector_id}, collector_id={collector_id}, rule_arn={rule_arn}")
                    else:
                        logger.warning(f"Detector EventBridge Rule作成失敗: detector_id={detector_id}")
            except Exception as e:
                logger.error(f"Detector EventBridge Rule作成エラー（検知器作成は成功）: detector_id={detector_id}, error={e}")
                # EventBridgeエラーでも検知器は作成済みなのでエラーにしない
        else:
            logger.info(f"lambda_endpoint_arn未設定のためEventBridge Rule作成スキップ: detector_id={detector_id}")
        
        # コレクターの related_data_update_time を更新（コレクター自動再起動用）
        await update_collector_related_time(collector_id)
        
        return detector_data
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"検知器作成エラー: {str(e)}")

@router.put("/{detector_id}", response_model=Dict[str, Any])
async def update_detector(
    detector_id: str,
    detector_data: Dict[str, Any],
    current_user: dict = Depends(get_current_user)
):
    """
    検知器を更新
    """
    try:
        print(f"Received detector data: {detector_data}")  # デバッグログ
        from shared.database import get_camera_collector
        table = dynamodb.Table(DETECTOR_TABLE)
        
        # 既存の検知器の確認
        response = table.get_item(Key={'detector_id': detector_id})
        if 'Item' not in response:
            raise HTTPException(status_code=404, detail="検知器が見つかりません")
        
        # collector_id_file_typeキーの更新
        camera_id = detector_data.get('camera_id')
        file_type = detector_data.get('file_type')
        
        # 新規: collector_idが直接渡された場合（推奨）
        if 'collector_id' in detector_data:
            collector_id = detector_data['collector_id']
        # 従来: collector名が渡された場合（後方互換性）
        elif 'collector' in detector_data:
            collector_name = detector_data.get('collector')
            if camera_id and collector_name:
                collector_info = get_camera_collector(camera_id, collector_name)
                if not collector_info:
                    raise HTTPException(status_code=404, detail=f"Collector not found: {collector_name}")
                collector_id = collector_info.get('collector_id')
                detector_data['collector_id'] = collector_id
            else:
                # 既存のレコードからcollector_idを取得
                existing_item = response.get('Item', {})
                if 'collector_id' in existing_item:
                    collector_id = existing_item['collector_id']
                else:
                    raise HTTPException(status_code=400, detail="camera_id and collector are required when collector_id is not provided")
        else:
            # 既存のレコードからcollector_idを取得
            existing_item = response.get('Item', {})
            if 'collector_id' in existing_item:
                collector_id = existing_item['collector_id']
            else:
                raise HTTPException(status_code=400, detail="collector_id or collector is required")
        
        if file_type:
            detector_data['collector_id_file_type'] = f"{collector_id}|{file_type}"
        
        # collectorフィールドは削除（名前は保存しない、collector_idのみ保存）
        if 'collector' in detector_data:
            del detector_data['collector']
        
        # 更新式の構築
        update_expression = "SET "
        expression_values = {}
        update_parts = []
        
        for key, value in detector_data.items():
            if key not in ['detector_id']:
                # 数値型フィールドの型変換
                if key == 'max_tokens':
                    try:
                        value = int(value) if value is not None and value != '' else 2000
                    except (ValueError, TypeError):
                        value = 2000  # デフォルト値
                elif key == 'detect_interval':
                    try:
                        value = int(value) if value is not None and value != '' else 5000
                    except (ValueError, TypeError):
                        value = 5000  # デフォルト値
                elif key in ['temperature', 'top_p']:
                    # 空文字列や None の場合は明示的にnull
                    if value is None or value == '':
                        value = None
                    else:
                        try:
                            # 文字列、数値、float、Decimalに対応
                            value = Decimal(str(value))
                        except (ValueError, TypeError, AttributeError):
                            value = None  # 変換失敗時はnull
                elif key == 'trigger_event':
                    # trigger_event が空文字列や None の場合はデフォルト値
                    if value is None or value == '':
                        value = 'SaveImageEvent'
                
                update_parts.append(f"{key} = :{key}")
                expression_values[f":{key}"] = value
        
        if not update_parts:
            raise HTTPException(status_code=400, detail="更新するデータがありません")
        
        update_expression += ", ".join(update_parts)
        
        response = table.update_item(
            Key={'detector_id': detector_id},
            UpdateExpression=update_expression,
            ExpressionAttributeValues=expression_values,
            ReturnValues="ALL_NEW"
        )
        
        updated_item = dict(response['Attributes'])
        
        # Detector個別EventBridge Ruleを更新（削除 → 再作成、疎結合: collector_id でフィルタリング）
        if updated_item.get('lambda_endpoint_arn'):
            try:
                from detector.deployment.detector_eventbridge_rule import update_detector_eventbridge_rule
                from shared.common import is_detector_resource_deploy_enabled
                
                # Detectorリソースデプロイチェック
                if not is_detector_resource_deploy_enabled():
                    logger.info(f"[DISABLED] DETECTOR_RESOURCE_DEPLOY=off: EventBridge Rule更新スキップ: detector_id={detector_id}")
                else:
                    success = update_detector_eventbridge_rule(
                        detector_id=detector_id,
                        collector_id=collector_id,
                        trigger_event=updated_item.get('trigger_event', 'SaveImageEvent'),
                        lambda_endpoint_arn=updated_item['lambda_endpoint_arn']
                    )
                    
                    if success:
                        logger.info(f"Detector EventBridge Rule更新成功: detector_id={detector_id}, collector_id={collector_id}")
                    else:
                        logger.warning(f"Detector EventBridge Rule更新失敗: detector_id={detector_id}")
            except Exception as e:
                logger.error(f"Detector EventBridge Rule更新エラー（検知器更新は成功）: detector_id={detector_id}, error={e}")
                # EventBridgeエラーでも検知器は更新済みなのでエラーにしない
        else:
            logger.info(f"lambda_endpoint_arn未設定のためEventBridge Rule更新スキップ: detector_id={detector_id}")
        
        # コレクターの related_data_update_time を更新（コレクター自動再起動用）
        await update_collector_related_time(collector_id)
        
        return updated_item
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        error_detail = f"検知器更新エラー: {str(e)}\n詳細: {traceback.format_exc()}"
        print(f"Update detector error: {error_detail}")  # ログに出力
        raise HTTPException(status_code=500, detail=f"検知器更新エラー: {str(e)}")

@router.get("/load-from-category/{tagcategory_id}")
async def load_from_tag_category(
    tagcategory_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    指定されたタグカテゴリから system_prompt、detect_prompt、およびタグ情報をロード
    """
    try:
        # タグカテゴリ情報を取得
        category_table = dynamodb.Table(TAG_CATEGORY_TABLE)
        category_response = category_table.get_item(Key={'tagcategory_id': tagcategory_id})
        
        if 'Item' not in category_response:
            raise HTTPException(status_code=404, detail="タグカテゴリが見つかりません")
        
        category_data = category_response['Item']
        
        # そのカテゴリに属するタグ情報を取得
        tag_table = dynamodb.Table(TAG_TABLE)
        tag_response = tag_table.query(
            IndexName="globalindex1",  # tagcategory_idでクエリするためのGSI
            KeyConditionExpression="tagcategory_id = :tagcategory_id",
            ExpressionAttributeValues={':tagcategory_id': tagcategory_id}
        )
        
        tags = tag_response.get('Items', [])
        
        # tag_prompt_list形式に変換
        tag_prompt_list = {}
        for i, tag in enumerate(tags):
            tag_prompt_list[str(i)] = {
                'tag_id': tag.get('tag_id'),
                'tag_name': tag.get('tag_name'),
                'tag_prompt': tag.get('tag_prompt', ''),
                'notify_flg': False  # デフォルトでfalse
            }
        
        # tag_list（パイプ区切り）を生成
        tag_list = '|'.join([tag.get('tag_name', '') for tag in tags])
        
        return {
            'system_prompt': category_data.get('system_prompt', ''),
            'detect_prompt': category_data.get('detect_prompt', ''),
            'tag_prompt_list': tag_prompt_list,
            'tag_list': tag_list,
            'category_name': category_data.get('tagcategory_name', ''),
            'tags_count': len(tags),
            'max_tokens': 2000,
            'temperature': None,
            'top_p': None
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"タグカテゴリロードエラー: {str(e)}")

@router.delete("/{detector_id}")
async def delete_detector(
    detector_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    検知器を削除（EventBridgeルールも自動更新）
    """
    try:
        table = dynamodb.Table(DETECTOR_TABLE)
        
        # 既存の検知器の確認
        response = table.get_item(Key={'detector_id': detector_id})
        if 'Item' not in response:
            raise HTTPException(status_code=404, detail="検知器が見つかりません")
        
        detector_item = response['Item']
        detector_name = detector_item.get('detector')
        collector_id = detector_item.get('collector_id')
        
        # 削除実行
        table.delete_item(Key={'detector_id': detector_id})
        
        # Detector個別EventBridge Ruleを削除
        try:
            from detector.deployment.detector_eventbridge_rule import delete_detector_eventbridge_rule
            from shared.common import is_detector_resource_deploy_enabled
            
            # Detectorリソースデプロイチェック
            if not is_detector_resource_deploy_enabled():
                logger.info(f"[DISABLED] DETECTOR_RESOURCE_DEPLOY=off: EventBridge Rule削除スキップ: detector_id={detector_id}")
            else:
                success = delete_detector_eventbridge_rule(detector_id=detector_id)
                
                if success:
                    logger.info(f"Detector EventBridge Rule削除成功: detector_id={detector_id}")
                else:
                    logger.warning(f"Detector EventBridge Rule削除失敗: detector_id={detector_id}")
        except Exception as e:
            logger.error(f"Detector EventBridge Rule削除エラー（検知器削除は成功）: detector_id={detector_id}, error={e}")
            # EventBridgeエラーでも検知器は削除済みなのでエラーにしない
        
        # コレクターの related_data_update_time を更新（コレクター自動再起動用）
        if collector_id:
            await update_collector_related_time(collector_id)
        
        return {"message": "検知器が削除されました"}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"検知器削除エラー: {str(e)}") 