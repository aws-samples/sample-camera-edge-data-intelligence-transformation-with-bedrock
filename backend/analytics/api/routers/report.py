from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import os
import json
from typing import List
from datetime import datetime
import base64
import logging
from shared.common import *
from shared.url_generator import generate_presigned_url

# ロガーの設定
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

router = APIRouter()

# DynamoDBテーブル名はcommon.pyの定数を使用
# BOOKMARK_DETAIL_TABLE, DETECT_LOG_TABLE は common.py から import 済み

IS_S3_LOCATION = False

# --- リクエストモデル ---
class ReportRequest(BaseModel):
    bookmark_id: str
    report_title: str
    report_content: str
    model_id: str

# --- DynamoDBからデータ取得 ---
def get_bookmark_details(bookmark_id: str):
    try:
        logger.info(f"ブックマーク詳細取得開始: bookmark_id={bookmark_id}")
        session = create_boto3_session()
        dynamodb = session.resource('dynamodb')
        table = dynamodb.Table(BOOKMARK_DETAIL_TABLE)
        resp = table.query(
            KeyConditionExpression='bookmark_id = :bid',
            ExpressionAttributeValues={':bid': bookmark_id}
        )
        items = resp.get('Items', [])
        logger.info(f"ブックマーク詳細取得完了: 件数={len(items)}")
        return items
    except Exception as e:
        logger.error(f"ブックマーク詳細取得エラー: {e}")
        raise

def get_detect_logs(details: List[dict]):
    try:
        logger.info(f"検出ログ取得開始: 件数={len(details)}")
        session = create_boto3_session()
        dynamodb = session.resource('dynamodb')
        table = dynamodb.Table(DETECT_LOG_TABLE)
        result = []
        for i, d in enumerate(details):
            logger.info(f"検出ログ処理中: {i+1}/{len(details)}")
            
            # bookmark_detail から collector_id を直接取得
            collector_id = d.get('collector_id', '')
            file_type = d.get('file_type', '')
            start_time = d.get('datetime')
            
            if not start_time:
                result.append(d)
                continue  # start_timeがなければそのまま返す
            
            # collector_id と file_type で検索
            if collector_id and file_type:
                # collector_id_file_type で検索
                key = f"{collector_id}|{file_type}"
            else:
                logger.warning(f"collector_id or file_type が不足: collector_id={collector_id}, file_type={file_type}")
                result.append(d)
                continue
                
            resp = table.query(
                IndexName='globalindex1',
                KeyConditionExpression='collector_id_file_type = :k AND start_time = :s',
                ExpressionAttributeValues={':k': key, ':s': start_time},
                Limit=1  # 1件だけ取得
            )
            items = resp.get('Items', [])
            logger.info(f"検出ログ検索結果: key={key}, 件数={len(items)}")
            if items:
                # detect_logの内容をdetailsに追記（重複しないキーのみ追加）
                merged = d.copy()
                for k, v in items[0].items():
                    if k not in merged:
                        merged[k] = v
                result.append(merged)
            else:
                result.append(d)
        logger.info(f"検出ログ取得完了: 結果件数={len(result)}")
        return result
    except Exception as e:
        logger.error(f"検出ログ取得エラー: {e}")
        raise



# --- Bedrock推論 ---
def get_image_bytes_from_s3(s3_uri):
    try:
        logger.info(f"S3画像取得開始: {s3_uri}")
        session = create_boto3_session()
        s3 = session.client('s3')
        parts = s3_uri.replace('s3://', '').split('/', 1)
        bucket = parts[0]
        key = parts[1]
        obj = s3.get_object(Bucket=bucket, Key=key)
        image_bytes = obj['Body'].read()  # バイト列で返す
        logger.info(f"S3画像取得完了: {s3_uri}")
        return image_bytes
    except Exception as e:
        logger.error(f"S3画像取得エラー: bucket={bucket}, key={key}, s3_uri={s3_uri}, error={e}")
        return None

def call_bedrock(report_title, report_content, details_plus, model_id, add_image_blocks=False):
    try:
        logger.info(f"Bedrock推論開始: model_id={model_id}, 詳細件数={len(details_plus)}")
        session = create_boto3_session()
        bedrock = session.client('bedrock-runtime')
        
        prompt = f"""
あなたは Markdown 形式のレポートを作成するエージェントです。
以下の指示に基づいて美しいレポートを作成してください。

[レポートタイトル]
{report_title}

[レポートして欲しい内容]
{report_content}

[レポートの出力フォーマット]
Markdown形式

[レポートで利用するデータ]
注意。image_url は presigned_url ですので、埋め込む場合はURLをそのまま使用してください。
"""
        for i, log in enumerate(details_plus):
            logger.info(f"プロンプト作成中: {i+1}/{len(details_plus)}")
            prompt += f"""
---
detect_result: {log.get('detect_result','')}
detect_tag: {log.get('detect_tag','')}
detect_notify_reason: {log.get('detect_notify_reason','')}
detect_notify_flg: {log.get('detect_notify_flg','')}
place_name: {log.get('place_name','')}
camera_name: {log.get('camera_name','')}
"""
            # s3pathが存在する場合、署名付きURLを生成してpromptに追加
            s3path = log.get('s3path', '')
            if s3path:
                try:
                    presigned_url = generate_presigned_url(s3path, expiration=3600)
                    if presigned_url:
                        prompt += f"image_url: {presigned_url}\n"
                    print(f"presigned_url: {presigned_url}")
                except Exception as e:
                    logger.error(f"署名付きURL生成失敗: {s3path}: {e}")

        # API Gatewayの30秒制限を考慮し、画像処理は省略してテキストのみでレポート生成
        # 将来的に非同期処理が必要な場合は別途実装
        image_blocks = []
        logger.info(f"プロンプト作成完了: 文字数={len(prompt)}")
                
        # converse呼び出し
        messages = [
            {
                'role': 'user',
                'content': [
                    {'text': prompt}
                ]
            }
        ]
        
        logger.info("Bedrock推論実行中...")
        response = bedrock.converse(
            modelId=model_id,
            messages=messages,
            inferenceConfig={
                'maxTokens': 4092,
                'temperature': 0.2
            }
        )
        
        output = response.get('output', {})
        message = output.get('message', {})
        content = message.get('content', [])
        if content and 'text' in content[0]:
            result = content[0]['text']
            logger.info(f"Bedrock推論完了: 出力文字数={len(result)}")
            return result
            
        logger.error("Bedrockからの応答が不正です")
        return 'レポート生成に失敗しました（応答が不正）'
        
    except Exception as e:
        logger.error(f"Bedrock推論エラー: {e}")
        return f'レポート生成に失敗しました: {str(e)}'

# --- エンドポイント ---
@router.post('/create')
async def create_report(req: ReportRequest, request: Request):
    try:
        logger.info(f"レポート作成開始: bookmark_id={req.bookmark_id}, model_id={req.model_id}")
        
        # 1. ブックマーク詳細取得
        details = get_bookmark_details(req.bookmark_id)
        if not details:
            logger.warning(f"ブックマーク詳細が見つかりません: {req.bookmark_id}")
            return JSONResponse({'error': 'ブックマーク詳細が見つかりません'}, status_code=404)
            
        # 2. 検出ログ取得
        details_plus = get_detect_logs(details)
        
        # 3. Bedrockでレポート生成
        report = call_bedrock(req.report_title, req.report_content, details_plus, req.model_id)
        
        logger.info("レポート作成完了")
        return {'report': report}
        
    except Exception as e:
        logger.error(f"レポート作成エラー: {e}")
        return JSONResponse(
            {'error': f'レポート作成中にエラーが発生しました: {str(e)}'}, 
            status_code=500
        ) 