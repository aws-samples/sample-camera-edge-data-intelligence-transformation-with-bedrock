#!/usr/bin/env python3
"""
VLM Image Detection Lambda Function

EventBridge S3イベントをトリガーに、画像・動画をBedrock Modelで解析し、
検出結果をDynamoDBに保存するLambda関数です。

機能:
- EventBridge S3 "Object Created"イベントの受信
- S3パスの解析によるカメラ情報の抽出
- DynamoDBからDetector設定の取得
- Bedrock Model (Converse API)での画像・動画解析
- 検出結果のDynamoDBへの保存
- リージョン別モデルID対応
"""

import boto3
import json
import logging
import os
import time
import random
from datetime import datetime, timezone
from typing import Dict, Any, Optional, Tuple, List
from botocore.exceptions import ClientError
from pathlib import Path

from shared.common import *

# ロガーの設定
logger = setup_logger('bedrock')


# def get_model_id_by_region(region: str, model: str) -> Optional[str]:
#     """
#     Args:
#         region: AWSリージョン
#         model: モデル名
    
#     Returns:
#         モデルID、未知のリージョンの場合はNone
#     """
#     # USリージョン
#     us_regions = ['us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'us-gov-east-1', 'us-gov-west-1']

#     # APACリージョン  
#     apac_regions = [
#         'ap-northeast-1', 'ap-northeast-2', 'ap-northeast-3',
#         'ap-south-1', 'ap-south-2', 'ap-southeast-1', 'ap-southeast-2', 'ap-southeast-4'
#     ]

#     # EUリージョン
#     eu_regions = [
#         'eu-central-1', 'eu-central-2', 'eu-north-1', 
#         'eu-south-1', 'eu-south-2', 'eu-west-1', 'eu-west-2', 'eu-west-3'
#     ]

#     if region in us_regions:
#         return f"us.{model}"
#     elif region in apac_regions:
#         return f"apac.{model}"
#     elif region in eu_regions:
#         return f"eu.{model}"
#     else:
#         # デフォルトはUS
#         logger.warning(f"未知のリージョン {region}。USリージョン用モデルIDを使用します。")
#         return None


def build_detection_prompt(detector_settings: Dict[str, Any], compare_file_flg: bool = False, has_previous_file: bool = False) -> str:
    """
    Detector設定からプロンプトを構築
    
    Args:
        detector_settings: Detector設定
        compare_file_flg: ファイル比較フラグ
        has_previous_file: 前回ファイルが利用可能かどうか
        
    Returns:
        構築されたプロンプト
    """
    system_prompt = detector_settings.get('system_prompt', '')
    detect_prompt = detector_settings.get('detect_prompt', '')
    tag_prompt_list = detector_settings.get('tag_prompt_list', {})
    
    # 比較モードの場合、system_promptに説明を追加
    if compare_file_flg and has_previous_file:
        system_prompt += "\n\n- 画像は2枚添付されています。1枚目は（現在）と2枚目（前回）の画像となります。画像を比較して以下を検出してください。"

    tag_criteria = []
    available_tags = []
    
    # tag_prompt_listを処理（SetまたはDict形式に対応）
    if isinstance(tag_prompt_list, dict):
        for key, tag_info in tag_prompt_list.items():
            tag_name = tag_info.get('tag_name', '')
            tag_prompt = tag_info.get('tag_prompt', '')
            notify_flg = tag_info.get('notify_flg', False)
            tag_compare_flg = tag_info.get('compare_file_flg', False)
            
            if tag_name:
                available_tags.append(tag_name)
                notify_text = "notify=true" if notify_flg else "notify=false"
                
                # 比較モードかつタグレベルでも比較フラグがTrueの場合、比較指示を追加
                if tag_compare_flg and compare_file_flg and has_previous_file:
                    criterion = f" - {tag_prompt} (1枚目と2枚目の画像を比較して必ず判定すること) → {notify_text}、tag=[{tag_name}]"
                else:
                    criterion = f" - {tag_prompt} → {notify_text}、tag=[{tag_name}]"
                tag_criteria.append(criterion)
    
    tag_criteria_text = '\n'.join(tag_criteria) if tag_criteria else "タグ判定基準が設定されていません"
    available_tags_text = str(available_tags)

    prompt = f"""{system_prompt}

### あなたがやること:
- まず、「検出条件」に従って検出を行い、その検出結果が、各「タグ出力の判定基準」に該当するかを判定してタグを検出してください (ただし、「利用可能なタグ一覧」以外のタグの抽出は禁止)。
- その際、検出されたタグが notify=true の場合、notify_reason にその理由を出力してください。

### 検出条件：
{detect_prompt}

### 出力フォーマット:
あなたは最終的に以下のJSONを出力してください (検出した結果の詳細と、通知に該当する理由 は日本語で出力してください)：
{{
    "result": "<検出した結果の詳細>",
    "notify": true または false,
    "notify_reason": "<通知に該当する理由（通知がfalseの場合は空文字）>",
    "tag": ["<該当するタグ1>", "<該当するタグ2>"]
}}

### タグ出力の判定基準：
{tag_criteria_text}

### 通知出力判定基準：
検出されたタグの notify指定がtrueの場合、出力フォーマットの notify を true とし、何を検出し何のタグに該当をしたのか？の説明を notify_reason に出力してください。複数タグが該当する場合、複数タグ分の説明を出力してください

### 利用可能なタグ一覧：
{available_tags_text}

### 重要 (必ず守る事)
出力フォーマットの指定に従ってレスポンスしてください。
JSONの前後に余計な文章は含めず、必ずJSON形式で回答してください。
繰り返しますが日本語で出力してください"""

    return prompt

def analyze_media_with_bedrock(media_data: bytes, prompt: str, model: str, file_type: str, detector_settings: Dict[str, Any], previous_media_data: Optional[bytes] = None, s3_bucket: Optional[str] = None, s3_key: Optional[str] = None, previous_s3_key: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Bedrock Modelでメディア（画像・動画）を解析
    ThrottlingExceptionに対してexponential backoffでリトライ
    
    Args:
        media_data: メディアのバイナリデータ（画像用、または動画のフォールバック用）
        prompt: 解析用プロンプト
        model: モデル名
        file_type: ファイルタイプ（'image' or 'video'）
        detector_settings: Detector設定（AIパラメータを含む）
        previous_media_data: 前回のメディアのバイナリデータ（比較用、Optional）
        s3_bucket: S3バケット名（動画のS3 URI用、Optional）
        s3_key: S3キー（動画のS3 URI用、Optional）
        previous_s3_key: 前回ファイルのS3キー（動画比較のS3 URI用、Optional）
        
    Returns:
        解析結果の辞書、失敗時はNone
    """
    max_retries = 3
    base_delay = 1  # 基本遅延時間（秒）
    max_delay = 60  # 最大遅延時間（秒）
    
    for attempt in range(max_retries):
        try:
            # create_boto3_session関数を使用してセッションを作成
            session = create_boto3_session()
            bedrock_client = session.client('bedrock-runtime')
            # model_id = get_model_id_by_region(REGION, model)
            
            # if model_id is None:
            #     logger.error(f"未対応のリージョンです: {REGION}")
            #     return None
            
            logger.info(f"Bedrock解析開始: model_id={model}, file_type={file_type}, attempt={attempt + 1}, has_previous={previous_media_data is not None}")
            
            # content配列の構築
            content = [{'text': prompt}]
            
            # Amazon Novaモデルかどうかを判定（S3 URI形式はNovaのみサポート）
            is_nova_model = 'amazon.nova' in model.lower()
            
            # 現在のメディア（1枚目）を追加
            # Amazon Novaモデルの場合のみS3 URI形式を使用（最大1GBまで対応）
            # その他のモデルはbytes形式を使用
            if is_nova_model and s3_bucket and s3_key:
                s3_uri = f's3://{s3_bucket}/{s3_key}'
                logger.info(f"Novaモデルのため、メディアをS3 URI形式で渡します: {s3_uri}")
                
                if file_type == 'image':
                    content.append({
                        'image': {
                            'format': 'jpeg',
                            'source': {
                                's3Location': {
                                    'uri': s3_uri
                                }
                            }
                        }
                    })
                elif file_type == 'video':
                    content.append({
                        'video': {
                            'format': 'mp4',
                            'source': {
                                's3Location': {
                                    'uri': s3_uri
                                }
                            }
                        }
                    })
                else:
                    logger.error(f"未対応のファイルタイプです: {file_type}")
                    return None
            else:
                # Nova以外のモデル、またはS3情報がない場合はbytes形式を使用
                if not is_nova_model:
                    logger.info(f"Nova以外のモデル({model})のため、メディアをbytes形式で渡します")
                else:
                    logger.warning("S3情報がないため、メディアをbytes形式で渡します（25MB制限に注意）")
                
                if file_type == 'image':
                    content.append({
                        'image': {
                            'format': 'jpeg',
                            'source': {
                                'bytes': media_data
                            }
                        }
                    })
                elif file_type == 'video':
                    content.append({
                        'video': {
                            'format': 'mp4',
                            'source': {
                                'bytes': media_data
                            }
                        }
                    })
                else:
                    logger.error(f"未対応のファイルタイプです: {file_type}")
                    return None
            
            # 前回のメディア（2枚目）を追加（比較モード時）
            # Amazon Novaモデルの場合のみS3 URI形式を使用
            if is_nova_model and previous_s3_key and s3_bucket:
                previous_s3_uri = f's3://{s3_bucket}/{previous_s3_key}'
                logger.info(f"Novaモデルのため、前回メディアをS3 URI形式で渡します: {previous_s3_uri}")
                
                if file_type == 'image':
                    content.append({
                        'image': {
                            'format': 'jpeg',
                            'source': {
                                's3Location': {
                                    'uri': previous_s3_uri
                                }
                            }
                        }
                    })
                elif file_type == 'video':
                    content.append({
                        'video': {
                            'format': 'mp4',
                            'source': {
                                's3Location': {
                                    'uri': previous_s3_uri
                                }
                            }
                        }
                    })
            elif previous_media_data:
                # Nova以外のモデル、またはS3情報がない場合はbytes形式を使用
                logger.info("前回メディアをbytes形式で渡します")
                if file_type == 'image':
                    content.append({
                        'image': {
                            'format': 'jpeg',
                            'source': {
                                'bytes': previous_media_data
                            }
                        }
                    })
                elif file_type == 'video':
                    content.append({
                        'video': {
                            'format': 'mp4',
                            'source': {
                                'bytes': previous_media_data
                            }
                        }
                    })
            
            # detector_settingsからAIパラメータを取得
            max_tokens = detector_settings.get('max_tokens', 2000)
            temperature_raw = detector_settings.get('temperature')  # デフォルト値なし（任意項目）
            top_p_raw = detector_settings.get('top_p')              # デフォルト値なし（任意項目）
            
            # max_tokensの処理（必須パラメータなのでデフォルト値あり）
            max_tokens = max(1, int(max_tokens)) if max_tokens else 4000
            
            # temperature/top_pの処理（None, Decimal, int, float対応）
            temperature = None
            if temperature_raw is not None:
                try:
                    # Decimal型、int型、float型、文字列に対応
                    temperature = max(0.0, min(1.0, float(temperature_raw)))
                except (ValueError, TypeError):
                    temperature = None  # 変換失敗時はNone
            
            top_p = None
            if top_p_raw is not None:
                try:
                    top_p = max(0.0, min(1.0, float(top_p_raw)))
                except (ValueError, TypeError):
                    top_p = None
            
            logger.info(f"AIパラメータ: max_tokens={max_tokens}, temperature={temperature}, top_p={top_p}")
            
            # Claude Sonnet 4.5 / Haiku 4.5 は temperature と top_p の両方を同時に設定できない
            # 両方設定されている場合は top_p のみを使用する
            model_lower = model.lower()
            is_claude_45 = 'claude-sonnet-4-5' in model_lower or 'claude-haiku-4-5' in model_lower
            if is_claude_45 and temperature is not None and top_p is not None:
                logger.info(f"Claude 4.5モデル検出: temperature と top_p の両方が設定されているため、top_p のみを使用します")
                temperature = None
            
            # inferenceConfigを動的に構築（値がある場合のみ含める）
            inference_config = {
                'maxTokens': max_tokens
            }
            
            # temperatureがNoneでない場合のみ追加
            if temperature is not None:
                inference_config['temperature'] = temperature
            
            # top_pがNoneでない場合のみ追加
            if top_p is not None:
                inference_config['topP'] = top_p
            
            logger.info(f"inferenceConfig: {inference_config}")
            
            # Converse APIでリクエスト
            response = bedrock_client.converse(
                modelId=model,
                messages=[
                    {
                        'role': 'user',
                        'content': content
                    }
                ],
                inferenceConfig=inference_config
            )
            
            # レスポンス解析
            output = response.get('output', {})
            message = output.get('message', {})
            content = message.get('content', [])
            
            if not content or 'text' not in content[0]:
                logger.error("Bedrockからの応答が不正です")
                return None
            
            response_text = content[0]['text']
            logger.info(f"Bedrock応答: {response_text}")
            
            # JSONを解析
            try:
                # 応答からJSON部分のみを抽出（説明文がある場合に対応）
                json_start = response_text.find('{')
                json_end = response_text.rfind('}') + 1
                
                if json_start != -1 and json_end > json_start:
                    json_text = response_text[json_start:json_end]
                    result = json.loads(json_text)
                    return result
                else:
                    # JSON形式が見つからない場合
                    logger.error(f"JSON形式が見つかりません: {response_text}")
                    return None
                    
            except json.JSONDecodeError as e:
                logger.error(f"JSON解析エラー: {e}, 応答: {response_text}")
                return None
                
        except ClientError as e:
            error_code = e.response.get('Error', {}).get('Code', '')
            
            if error_code == 'ThrottlingException':
                if attempt < max_retries - 1:
                    # Exponential backoff with jitter
                    delay = min(base_delay * (2 ** attempt) + random.uniform(0, 1), max_delay)
                    logger.warning(f"ThrottlingException detected. Retrying in {delay:.2f} seconds... (attempt {attempt + 1}/{max_retries})")
                    time.sleep(delay)
                    continue
                else:
                    logger.error(f"ThrottlingException: 最大リトライ回数に到達しました: {e}")
                    return None
            else:
                logger.error(f"Bedrock解析エラー: {e}")
                return None
                
        except Exception as e:
            logger.error(f"Bedrock解析エラー: {e}")
            if attempt < max_retries - 1:
                delay = min(base_delay * (2 ** attempt) + random.uniform(0, 1), max_delay)
                logger.warning(f"予期しないエラー。{delay:.2f}秒後にリトライします... (attempt {attempt + 1}/{max_retries})")
                time.sleep(delay)
                continue
            return None
    
    logger.error("すべてのリトライが失敗しました")
    return None

def lambda_handler(event, context):
    """
    Lambda関数のメインハンドラー
    
    Detector個別EventBridge Ruleからの呼び出しに対応
    
    Args:
        event: EventBridge イベントデータ
        context: Lambda実行コンテキスト
        
    Returns:
        処理結果
    """
    try:
        logger.info(f"イベント受信: {json.dumps(event, default=str)}")
        logger.info(f"AWSリージョン: {REGION}")
        
        # イベント形式を判定
        source = event.get('source', '')
        detail_type = event.get('detail-type', '')
        
        # Detector個別EventBridge形式のチェック
        if source.startswith('cedix.collector.') and detail_type in [
            'SaveImageEvent', 'SaveVideoEvent', 'ClassDetectEvent', 'AreaDetectEvent'
        ]:
            logger.info(f"Detector EventBridge形式を検出: source={source}, detail-type={detail_type}")
            return handle_detector_event(event, context)
        else:
            logger.warning(f"未対応のイベント形式です: source={source}, detail-type={detail_type}")
            return {
                'statusCode': 400,
                'body': json.dumps({
                    'message': 'Unsupported event format',
                    'source': source,
                    'detail-type': detail_type
                })
            }
        
    except Exception as e:
        logger.error(f"処理中にエラーが発生しました: {e}")
        return {'statusCode': 500, 'body': f'Internal server error: {str(e)}'}


def handle_detector_event(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Detector個別EventBridgeイベントを処理
    
    疎結合設計:
    - detector_id は InputTransformer でイベントのトップレベルに注入される
    - detector_data は DynamoDB から取得
    
    Args:
        event: EventBridgeイベント
        context: Lambda実行コンテキスト
        
    Returns:
        処理結果
    """
    try:
        detail = event.get('detail', {})
        event_type = detail.get('eventType', '')
        
        # detector_id は InputTransformer でトップレベルに注入される
        detector_id = event.get('detector_id')
        
        # 必須フィールドを取得（detail から）
        camera_id = detail.get('camera_id')
        collector_id = detail.get('collector_id')
        file_id = detail.get('file_id')
        s3path = detail.get('s3path')
        timestamp = detail.get('timestamp')
        
        # detector_id のバリデーション
        if not detector_id:
            logger.error("detector_id が見つかりません（InputTransformer で注入されているはずです）")
            return {
                'statusCode': 400,
                'body': json.dumps({
                    'message': 'detector_id not found in event',
                    'hint': 'detector_id should be injected by InputTransformer'
                })
            }
        
        # DynamoDB から detector 設定を取得
        detector_data = get_detector_by_id(detector_id)
        if not detector_data:
            logger.error(f"Detector設定が見つかりません: detector_id={detector_id}")
            return {
                'statusCode': 404,
                'body': json.dumps({
                    'message': 'Detector not found',
                    'detector_id': detector_id
                })
            }
        
        logger.info(f"DynamoDB から Detector設定を取得しました: detector_id={detector_id}")
        
        # NOTE: event_notify 処理は削除
        # area_detect / class_detect の detect-log 保存は collector (hlsyolo) 側で行う
        # save_image / save_video の detect-log 保存も不要（必要に応じて collector 側で行う）
        
        # バリデーション
        if not all([camera_id, collector_id, file_id, s3path]):
            logger.error("必須フィールドが不足しています")
            missing_fields = []
            if not camera_id: missing_fields.append('camera_id')
            if not collector_id: missing_fields.append('collector_id')
            if not file_id: missing_fields.append('file_id')
            if not s3path: missing_fields.append('s3path')
            
            return {
                'statusCode': 400,
                'body': json.dumps({
                    'message': 'Missing required fields',
                    'missing_fields': missing_fields,
                    'required': ['camera_id', 'collector_id', 'file_id', 's3path']
                })
            }
        
        logger.info(f"Detector情報: detector_id={detector_id}, camera_id={camera_id}, collector_id={collector_id}")
        logger.info(f"ファイル情報: file_id={file_id}, s3path={s3path}")
        logger.info(f"detector_dataの内容: {json.dumps(detector_data, default=str, ensure_ascii=False)}")
        
        # S3パスからバケット名とキーを抽出
        if not s3path.startswith('s3://'):
            logger.error(f"不正なS3パス形式: {s3path}")
            return {
                'statusCode': 400,
                'body': json.dumps({'message': 'Invalid S3 path format', 's3path': s3path})
            }
        
        s3path_parts = s3path.replace('s3://', '').split('/', 1)
        if len(s3path_parts) != 2:
            logger.error(f"S3パスの解析に失敗: {s3path}")
            return {
                'statusCode': 400,
                'body': json.dumps({'message': 'Failed to parse S3 path', 's3path': s3path})
            }
        
        bucket_name, s3_key = s3path_parts
        logger.info(f"S3情報: bucket={bucket_name}, key={s3_key}")
        
        # file_typeを取得（detector_dataから）
        file_type = detector_data.get('file_type')
        if file_type not in ['image', 'video']:
            logger.error(f"未対応のファイルタイプ: {file_type}")
            return {
                'statusCode': 400,
                'body': json.dumps({'message': 'Unsupported file type', 'file_type': file_type})
            }
        
        # file_dataを構築
        file_data = {
            'file_id': file_id,
            'camera_id': camera_id,
            'collector_id': collector_id,
            'file_type': file_type,
            's3path': s3path,
            's3path_detect': detail.get('s3path_detect', ''),
            'start_time': detail.get('start_time', timestamp),
            'end_time': detail.get('end_time', timestamp)
        }
        
        # イベントタイプ別の追加データを取得
        track_data = None
        track_log_id = detail.get('track_log_id')
        
        # ClassDetectEventまたはAreaDetectEventの場合
        event_type = detail.get('eventType', '')
        if event_type == 'class_detect':
            # トラックデータを取得
            detections = detail.get('detections', {})
            if detections:
                track_data = detections.get('tracks', [])
                logger.info(f"ClassDetectEvent: トラックデータ取得 {len(track_data)}件")
        elif event_type == 'area_detect':
            # エリア検出の場合もトラックデータを取得可能
            track_classdata = detail.get('track_classdata', {})
            if track_classdata:
                # track_classdataをリスト形式に変換（オプション）
                # 現時点では使用しないが、将来的に利用可能
                logger.info(f"AreaDetectEvent: エリアトラックデータあり")
        
        # detector_dataをdetector_settingsとして使用
        detector_settings = detector_data
        
        logger.info(f"Detector設定: detector={detector_settings.get('detector')}, model={detector_settings.get('model')}")
        
        # Bedrock解析処理（detectorがbedrockの場合のみ）
        detector_type = detector_settings.get('detector')
        if detector_type == 'bedrock':
            logger.info("Bedrock解析処理を実行します")
            # 共通処理を実行
            return process_detection(
                detector_settings=detector_settings,
                file_data=file_data,
                bucket_name=bucket_name,
                s3_key=s3_key,
                track_data=track_data,
                track_log_id=track_log_id
            )
        else:
            logger.info(f"Bedrock以外のdetector ({detector_type})のため、Bedrock解析処理をスキップします")
            return {
                'statusCode': 200,
                'body': json.dumps({
                    'message': 'Event processed successfully (no bedrock analysis)',
                    'detector_type': detector_type,
                    'event_notify_processed': event_notify
                })
            }
        
    except Exception as e:
        logger.error(f"Detectorイベント処理中にエラーが発生しました: {e}")
        import traceback
        logger.error(f"スタックトレース: {traceback.format_exc()}")
        return {'statusCode': 500, 'body': f'Internal server error: {str(e)}'}


def process_detection(detector_settings: Dict[str, Any], file_data: Dict[str, Any], 
                     bucket_name: str, s3_key: str, track_data: Optional[List[Dict]] = None,
                     track_log_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Bedrock検出処理の共通関数
    
    Args:
        detector_settings: Detector設定
        file_data: ファイルデータ
        bucket_name: S3バケット名
        s3_key: S3キー
        track_data: トラックデータ（hlsYolo用、オプション）
        track_log_id: トラックログID（hlsYolo用、オプション）
        
    Returns:
        処理結果
    """
    try:
        camera_id = file_data.get('camera_id')
        collector_id = file_data.get('collector_id')
        file_type = file_data.get('file_type')
        
        # compare_file_flgをチェックして前回ファイルを取得
        previous_media_data = None
        previous_s3_key_for_compare = None  # 比較用のS3キー（画像・動画共通）
        compare_file_flg = detector_settings.get('compare_file_flg', False)
        has_previous_file = False
        
        if compare_file_flg:
            logger.info("ファイル比較モードが有効です。前回ファイルを取得します。")
            previous_file_data = get_previous_file_data(collector_id, file_type, file_data.get('start_time'))
            logger.info(f"前回ファイルデータ: {previous_file_data}")
            if previous_file_data:
                # 前回ファイルのS3オブジェクトを取得
                previous_s3_key = previous_file_data.get('s3path')
                if previous_s3_key:
                    # S3フルパスの場合、キー部分のみを抽出
                    if previous_s3_key.startswith('s3://'):
                        # s3://bucket-name/key の形式からkey部分を抽出
                        s3_parts = previous_s3_key.replace('s3://', '').split('/', 1)
                        if len(s3_parts) == 2:
                            previous_s3_key = s3_parts[1]  # キー部分のみ
                        else:
                            logger.warning(f"不正なS3パス形式: {previous_s3_key}")
                            previous_s3_key = None
                    
                    if previous_s3_key:
                        # S3 URI形式で統一するため、S3キーを保持（画像・動画共通）
                        previous_s3_key_for_compare = previous_s3_key
                        has_previous_file = True
                        logger.info(f"前回ファイルのS3キーを取得しました: {previous_s3_key}")
                    else:
                        logger.warning("前回ファイルのS3キーが無効です")
                else:
                    logger.warning("前回ファイルデータにs3pathが含まれていません")
            else:
                logger.warning("前回ファイルが見つかりません。通常モードで実行します。")
        
        # S3からメディアファイルを取得
        media_data = get_s3_object(bucket_name, s3_key)
        if not media_data:
            logger.error("S3からのメディアファイル取得に失敗")
            return {'statusCode': 500, 'body': 'Failed to get media file from S3'}
        
        # プロンプトを構築（track_dataがある場合は追加情報として含める）
        prompt = build_detection_prompt(detector_settings, compare_file_flg, has_previous_file)
        
        # track_dataがある場合はプロンプトに追加
        if track_data:
            track_info = f"\n\n### トラック情報\n検出されたオブジェクト数: {len(track_data)}\n"
            for i, track in enumerate(track_data[:5]):  # 最大5件まで表示
                track_info += f"- オブジェクト{i+1}: {track.get('class')} (信頼度: {track.get('confidence', 0):.2f})\n"
            if len(track_data) > 5:
                track_info += f"...他 {len(track_data) - 5}件\n"
            prompt += track_info
        
        logger.info(f"プロンプト: {prompt}")
        
        # Bedrock でメディア解析
        # S3 URI形式で統一して処理（最大1GBまで対応、パフォーマンス向上）
        detection_result = analyze_media_with_bedrock(
            media_data=media_data,
            prompt=prompt,
            model=detector_settings['model'],
            file_type=file_type,
            detector_settings=detector_settings,
            previous_media_data=previous_media_data,
            s3_bucket=bucket_name,
            s3_key=s3_key,
            previous_s3_key=previous_s3_key_for_compare
        )
        if not detection_result:
            logger.error("Bedrockメディア解析に失敗")
            return {'statusCode': 500, 'body': 'Failed to analyze media with Bedrock'}
        
        logger.info(f"検出結果: {detection_result}")

        # 検出結果を保存
        detect_log_data = save_detect_log(
            detector_settings['detector_id'],
            detection_result.get('result', ''),
            detection_result.get('notify', False),
            detection_result.get('notify_reason', ''),
            detection_result.get('tag', []),
            file_data,
            'bedrock',
            track_log_id=track_log_id,  # トラックログIDを渡す
            s3path_detect=file_data.get('s3path_detect')  # 検出結果画像のS3パスを渡す
        )
        if not detect_log_data:
            logger.error("検出結果の保存に失敗")
            return {'statusCode': 500, 'body': 'Failed to save detection result'}
        
        # 時系列データを更新
        if not save_tag_timeseries(detect_log_data):
            logger.error("時系列データの更新に失敗")
            # 時系列データの更新失敗は警告レベルで継続
        
        logger.info("メディア解析が正常に完了しました")
        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'Media analysis completed successfully',
                'detection_result': detection_result,
                'track_data_count': len(track_data) if track_data else 0
            })
        }
        
    except Exception as e:
        logger.error(f"検出処理中にエラーが発生しました: {e}")
        return {'statusCode': 500, 'body': f'Internal server error: {str(e)}'}


# NOTE: event_notify 系の関数 (save_event_notify_log, _save_area_detect_log, 
# _save_class_detect_log, _save_media_save_log) は削除しました。
# area_detect / class_detect の detect-log 保存は collector (hlsyolo) 側で行います。
# save_image / save_video の detect-log 保存も必要に応じて collector 側で行います。
