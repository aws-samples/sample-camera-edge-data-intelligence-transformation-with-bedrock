#!/usr/bin/env python3
import boto3
import uuid
import time
from datetime import datetime, timedelta
import json
import os
import random
import argparse
import sys
from pathlib import Path
from boto3.dynamodb.types import TypeDeserializer, TypeSerializer
from decimal import Decimal

# プロジェクトルートをパスに追加してcommon.pyの定数をインポート
# Docker環境では /app/backend、ローカル環境では相対パスを使用
if os.environ.get('DOCKER_ENV'):
    sys.path.insert(0, '/app/backend')
else:
    project_root = Path(__file__).resolve().parent.parent.parent
    sys.path.insert(0, str(project_root / 'backend'))

from shared.common import ( # type: ignore
    TAG_CATEGORY_TABLE, TAG_TABLE
)

# 言語別翻訳データ
TRANSLATIONS = {
    'ja': {
        'categories': {
            'category-001': {'name': '建設現場安全監視', 'system_prompt': 'あなたは建設現場の安全監視AIです。画像を分析して安全上の問題を検出してください。', 'detect_prompt': '画像を詳細に分析して以下を検出してください：1）作業員のヘルメット着用状況（頭部に白色、黄色、オレンジ色などの安全ヘルメットが着用されているか）、2）重機と作業員の距離（ショベルカー、ダンプカー、クレーン車などの重機から3メートル以内に作業員がいる危険な状況、重機の稼働範囲内や死角に人がいる状況、重機が動いている際に近くに人がいる状況）。作業服の色、ヘルメットの有無、重機の種類、人と重機の相対位置関係を注意深く観察してください。'},
            'category-002': {'name': 'セキュリティ監視', 'system_prompt': 'あなたは事務所エリアのセキュリティ監視AIです。', 'detect_prompt': '不審者の侵入、物品の盗難、火災の兆候を検出してください。'},
            'category-003': {'name': '作業進捗監視', 'system_prompt': 'あなたは建設現場の進捗監視AIです。動画を分析して作業進捗と異常を検出してください。', 'detect_prompt': '重機の稼働状況、作業員の人数、工事の進捗状況を検出してください。'},
            'category-004': {'name': '動画ストリーム監視', 'system_prompt': 'あなたは動画ストリーム監視AIです。ライブ配信の状況と内容を分析してください。', 'detect_prompt': '配信の品質、音声の有無、画面の異常、配信中断、コンテンツの内容を検出してください。'},
            'category-005': {'name': 'コンビニの安全監視', 'system_prompt': 'あなたはコンビニ監視AIです。画像の内容を分析してください。', 'detect_prompt': '画像より人を検出した上で次の状態にあるかを判断してください。1) 人が倒れてる 2) 人が商品を窃盗している(商品を服やカバンに隠している/隠そうとしている)'},
            'category-006': {'name': '工場の安全監視', 'system_prompt': 'あなたは工場監視監視AIです。画像の内容を分析してください。', 'detect_prompt': '画像より人を検出した上で次の状態にあるかを判断してください。1) 人が倒れてる'},
            'category-007': {'name': '物流センターの安全監視', 'system_prompt': 'あなたは物流センター監視監視AIです。画像の内容を分析してください。', 'detect_prompt': '画像より人を検出した上で次の状態にあるかを判断してください。1) 人が倒れてる'},
        },
        'tags': {
            'tag-001': {'name': 'ヘルメット未着用', 'prompt': 'ヘルメットを着用していない作業員が画像内に写っている場合', 'description': '作業員がヘルメットを着用していない状態を検出'},
            'tag-003': {'name': '立入禁止区域侵入', 'prompt': '立入禁止の標識がある区域に人が侵入している場合', 'description': '立入禁止区域への不正侵入を検出'},
            'tag-004': {'name': '安全装備不備', 'prompt': '安全ベスト、作業靴、手袋などの安全装備が不足している場合', 'description': '必要な安全装備の着用不備を検出'},
            'tag-005': {'name': '人', 'prompt': '画像内に人が写っている場合', 'description': '人の存在を検出'},
            'tag-006': {'name': '車', 'prompt': '車両（建設機械含む）が画像内に写っている場合', 'description': '車両や建設機械の存在を検出'},
            'tag-007': {'name': '不審者', 'prompt': '許可されていない人、または不審な行動をしている人が写っている場合', 'description': '不審者の侵入を検出'},
            'tag-008': {'name': '物品移動', 'prompt': '建設車両が大きく移動している、または盗難の可能性がある状況の場合', 'description': '物品の不正移動や盗難を検出'},
            'tag-009': {'name': '火災兆候', 'prompt': '煙、火、または火災の兆候が見られる場合', 'description': '火災の兆候を検出'},
            'tag-010': {'name': '重機稼働', 'prompt': '重機が稼働している状態の場合', 'description': '重機の稼働状況を検出'},
            'tag-011': {'name': '作業員数変化', 'prompt': '作業員数が急激に変化した場合', 'description': '作業員数の急激な変化を検出'},
            'tag-012': {'name': '進捗遅延', 'prompt': '作業が予定より遅れている状況の場合', 'description': '作業進捗の遅延を検出'},
            'tag-013': {'name': 'ロボット稼働', 'prompt': 'ロボットが正常に稼働している状態の場合', 'description': 'ロボットの稼働状況を検出'},
            'tag-014': {'name': 'ロボット異常', 'prompt': 'ロボットが異常停止している、または正常に動作していない場合', 'description': 'ロボットの異常状態を検出'},
            'tag-015': {'name': '障害物検出', 'prompt': 'ロボットの進路に障害物がある場合', 'description': 'ロボットの進路上の障害物を検出'},
            'tag-016': {'name': 'バッテリー低下', 'prompt': 'ロボットのバッテリー残量が低下している場合', 'description': 'ロボットのバッテリー低下を検出'},
            'tag-017': {'name': '配信品質低下', 'prompt': '動画の解像度が低い、フレームレートが不安定、画質が悪化している場合', 'description': '動画ストリームの品質低下を検出'},
            'tag-018': {'name': '音声異常', 'prompt': '音声が途切れている、雑音が多い、音声が全く聞こえない場合', 'description': '音声の異常を検出'},
            'tag-019': {'name': '画面フリーズ', 'prompt': '画面が静止している、同じ画像が続いている、動きが全くない場合', 'description': '画面の停止状態を検出'},
            'tag-020': {'name': '配信中断', 'prompt': '配信が完全に停止している、黒い画面が表示されている、エラー画面が表示されている場合', 'description': '配信の中断を検出'},
            'tag-021': {'name': '不適切コンテンツ', 'prompt': '不適切な内容、暴力的な内容、機密情報の映り込みが検出された場合', 'description': '配信内容の不適切性を検出'},
            'tag-022': {'name': '視聴者数変化', 'prompt': '視聴者数が急激に増減した、または異常な視聴パターンが検出された場合', 'description': '視聴者数の異常な変動を検出'},
            'tag-023': {'name': 'ライブイベント', 'prompt': '特別なイベント、重要な発表、緊急事態が配信されている場合', 'description': 'ライブイベントの発生を検出'},
            'tag-024': {'name': '重機稼働', 'prompt': '重機が動いている、エンジンが稼働している、作業を行っている状態の場合', 'description': '重機の稼働状態を検出'},
            'tag-025': {'name': '重機非稼働', 'prompt': '重機が停止している、エンジンが止まっている、作業をしていない状態の場合', 'description': '重機の非稼働状態を検出'},
            'tag-026': {'name': '重機なし', 'prompt': '画像内に重機が見当たらない、重機が画面外にある場合', 'description': '重機の不在状態を検出'},
            'tag-027': {'name': '事故リスク高', 'prompt': '重機と作業員の距離が3メートル以内で危険、重機のブラインドスポットに人がいる、重機の稼働範囲内に人がいる場合', 'description': '重機と人の接近による事故リスクを検出'},
            'tag-028': {'name': 'ショベルカー', 'prompt': 'アームとバケット（掘削用の先端部）を持つ黄色いおもちゃの重機、掘削作業用の機械の場合', 'description': 'おもちゃのショベルカーを検出'},
            'tag-029': {'name': 'ミキサー車', 'prompt': '回転するドラム（円筒形のタンク）を搭載したおもちゃのトラック、コンクリートミキサー車の場合', 'description': 'おもちゃのミキサー車を検出'},
            'tag-030': {'name': 'クレーン車', 'prompt': '長いアーム（ブーム）とフック付きのワイヤーを持つおもちゃの重機、物を吊り上げる機械の場合', 'description': 'おもちゃのクレーン車を検出'},
            'tag-031': {'name': 'ダンプカー', 'prompt': '荷台が傾いて荷物を落とせる構造のおもちゃのトラック、土砂運搬用の車両の場合', 'description': 'おもちゃのダンプカーを検出'},
            'tag-032': {'name': 'ホイールローダー', 'prompt': '前面に大きなバケット（スコップ状の装置）を持つおもちゃの重機、土砂をすくい上げる機械の場合', 'description': 'おもちゃのホイールローダーを検出'},
            'tag-033': {'name': '人', 'prompt': '人が画像内に写っている場合', 'description': '人の存在を検出'},
            'tag-034': {'name': '倒れている人', 'prompt': '倒れている人が写っている', 'description': '倒れている人の存在を検出'},
            'tag-035': {'name': '窃盗', 'prompt': '商品を服やカバンに隠そうとしている人が写っている', 'description': '窃盗の存在を検出'},
            'tag-036': {'name': '人', 'prompt': '人が画像内に写っている場合', 'description': '人の存在を検出'},
            'tag-037': {'name': '倒れている人', 'prompt': '倒れている人が写っている', 'description': '倒れている人の存在を検出'},
            'tag-038': {'name': '人', 'prompt': '人が画像内に写っている場合', 'description': '人の存在を検出'},
            'tag-039': {'name': '倒れている人', 'prompt': '倒れている人が写っている', 'description': '倒れている人の存在を検出'},
        }
    },
    'en': {
        'categories': {
            'category-001': {'name': 'Construction Site Safety Monitoring', 'system_prompt': 'You are a construction site safety monitoring AI. Analyze images to detect safety issues.', 'detect_prompt': 'Analyze the image in detail to detect: 1) Worker helmet status (whether white, yellow, orange safety helmets are worn on heads), 2) Distance between heavy machinery and workers (dangerous situations where workers are within 3 meters of excavators, dump trucks, cranes, situations where people are in blind spots or operating range of machinery, situations where people are near moving machinery). Carefully observe work clothes colors, helmet presence, machinery types, and relative positions between people and machinery.'},
            'category-002': {'name': 'Security Monitoring', 'system_prompt': 'You are an office area security monitoring AI.', 'detect_prompt': 'Detect intruders, theft of items, and signs of fire.'},
            'category-003': {'name': 'Work Progress Monitoring', 'system_prompt': 'You are a construction site progress monitoring AI. Analyze videos to detect work progress and anomalies.', 'detect_prompt': 'Detect heavy machinery operation status, number of workers, and construction progress.'},
            'category-004': {'name': 'Video Stream Monitoring', 'system_prompt': 'You are a video stream monitoring AI. Analyze live broadcast status and content.', 'detect_prompt': 'Detect broadcast quality, audio presence, screen anomalies, broadcast interruptions, and content.'},
            'category-005': {'name': 'Convenience Store Safety Monitoring', 'system_prompt': 'You are a convenience store monitoring AI. Analyze image content.', 'detect_prompt': 'Detect people in the image and determine if they are in the following states: 1) Person collapsed 2) Person stealing merchandise (hiding/trying to hide items in clothes or bags)'},
            'category-006': {'name': 'Factory Safety Monitoring', 'system_prompt': 'You are a factory monitoring AI. Analyze image content.', 'detect_prompt': 'Detect people in the image and determine if they are in the following state: 1) Person collapsed'},
            'category-007': {'name': 'Logistics Center Safety Monitoring', 'system_prompt': 'You are a logistics center monitoring AI. Analyze image content.', 'detect_prompt': 'Detect people in the image and determine if they are in the following state: 1) Person collapsed'},
        },
        'tags': {
            'tag-001': {'name': 'No Helmet', 'prompt': 'When a worker without a helmet is visible in the image', 'description': 'Detects when a worker is not wearing a helmet'},
            'tag-003': {'name': 'Restricted Area Intrusion', 'prompt': 'When a person enters an area with restricted access signs', 'description': 'Detects unauthorized entry into restricted areas'},
            'tag-004': {'name': 'Missing Safety Equipment', 'prompt': 'When safety vests, work shoes, gloves or other safety equipment is missing', 'description': 'Detects lack of required safety equipment'},
            'tag-005': {'name': 'Person', 'prompt': 'When a person is visible in the image', 'description': 'Detects presence of people'},
            'tag-006': {'name': 'Vehicle', 'prompt': 'When a vehicle (including construction machinery) is visible in the image', 'description': 'Detects presence of vehicles and construction machinery'},
            'tag-007': {'name': 'Suspicious Person', 'prompt': 'When an unauthorized person or someone behaving suspiciously is visible', 'description': 'Detects intruders'},
            'tag-008': {'name': 'Object Movement', 'prompt': 'When construction vehicles are moving significantly or potential theft situation', 'description': 'Detects unauthorized movement or theft of items'},
            'tag-009': {'name': 'Fire Sign', 'prompt': 'When smoke, fire, or signs of fire are visible', 'description': 'Detects signs of fire'},
            'tag-010': {'name': 'Machinery Operating', 'prompt': 'When heavy machinery is operating', 'description': 'Detects heavy machinery operation status'},
            'tag-011': {'name': 'Worker Count Change', 'prompt': 'When the number of workers changes rapidly', 'description': 'Detects rapid changes in worker count'},
            'tag-012': {'name': 'Progress Delay', 'prompt': 'When work is behind schedule', 'description': 'Detects work progress delays'},
            'tag-013': {'name': 'Robot Operating', 'prompt': 'When a robot is operating normally', 'description': 'Detects robot operation status'},
            'tag-014': {'name': 'Robot Error', 'prompt': 'When a robot has stopped abnormally or is not functioning properly', 'description': 'Detects robot abnormal states'},
            'tag-015': {'name': 'Obstacle Detected', 'prompt': 'When there is an obstacle in the robot path', 'description': 'Detects obstacles in robot path'},
            'tag-016': {'name': 'Low Battery', 'prompt': 'When robot battery level is low', 'description': 'Detects robot low battery'},
            'tag-017': {'name': 'Low Stream Quality', 'prompt': 'When video resolution is low, frame rate is unstable, or quality has degraded', 'description': 'Detects video stream quality degradation'},
            'tag-018': {'name': 'Audio Abnormal', 'prompt': 'When audio is cutting out, has noise, or is completely inaudible', 'description': 'Detects audio anomalies'},
            'tag-019': {'name': 'Screen Freeze', 'prompt': 'When screen is frozen, same image continues, or no movement', 'description': 'Detects screen freeze state'},
            'tag-020': {'name': 'Stream Interrupted', 'prompt': 'When broadcast has completely stopped, black screen, or error screen is displayed', 'description': 'Detects broadcast interruption'},
            'tag-021': {'name': 'Inappropriate Content', 'prompt': 'When inappropriate, violent content, or confidential information is detected', 'description': 'Detects inappropriate broadcast content'},
            'tag-022': {'name': 'Viewer Count Change', 'prompt': 'When viewer count changes rapidly or abnormal viewing patterns detected', 'description': 'Detects abnormal viewer count fluctuations'},
            'tag-023': {'name': 'Live Event', 'prompt': 'When special events, important announcements, or emergencies are being broadcast', 'description': 'Detects live event occurrence'},
            'tag-024': {'name': 'Machinery Active', 'prompt': 'When machinery is moving, engine is running, or work is being performed', 'description': 'Detects machinery active state'},
            'tag-025': {'name': 'Machinery Idle', 'prompt': 'When machinery is stopped, engine is off, or no work is being done', 'description': 'Detects machinery idle state'},
            'tag-026': {'name': 'No Machinery', 'prompt': 'When no machinery is visible in the image or machinery is out of frame', 'description': 'Detects absence of machinery'},
            'tag-027': {'name': 'High Accident Risk', 'prompt': 'When machinery and workers are within 3 meters, person in blind spot, or person in operating range', 'description': 'Detects accident risk from machinery-person proximity'},
            'tag-028': {'name': 'Excavator', 'prompt': 'Yellow toy heavy machinery with arm and bucket for excavation', 'description': 'Detects toy excavator'},
            'tag-029': {'name': 'Mixer Truck', 'prompt': 'Toy truck with rotating drum (cylindrical tank), concrete mixer truck', 'description': 'Detects toy mixer truck'},
            'tag-030': {'name': 'Crane Truck', 'prompt': 'Toy heavy machinery with long arm (boom) and wire with hook for lifting', 'description': 'Detects toy crane truck'},
            'tag-031': {'name': 'Dump Truck', 'prompt': 'Toy truck with tilting bed for dumping cargo, earth-moving vehicle', 'description': 'Detects toy dump truck'},
            'tag-032': {'name': 'Wheel Loader', 'prompt': 'Toy heavy machinery with large bucket (scoop) at front for scooping earth', 'description': 'Detects toy wheel loader'},
            'tag-033': {'name': 'Person', 'prompt': 'When a person is visible in the image', 'description': 'Detects presence of people'},
            'tag-034': {'name': 'Collapsed Person', 'prompt': 'When a collapsed person is visible', 'description': 'Detects presence of collapsed person'},
            'tag-035': {'name': 'Theft', 'prompt': 'When a person is trying to hide merchandise in clothes or bags', 'description': 'Detects theft'},
            'tag-036': {'name': 'Person', 'prompt': 'When a person is visible in the image', 'description': 'Detects presence of people'},
            'tag-037': {'name': 'Collapsed Person', 'prompt': 'When a collapsed person is visible', 'description': 'Detects presence of collapsed person'},
            'tag-038': {'name': 'Person', 'prompt': 'When a person is visible in the image', 'description': 'Detects presence of people'},
            'tag-039': {'name': 'Collapsed Person', 'prompt': 'When a collapsed person is visible', 'description': 'Detects presence of collapsed person'},
        }
    }
}

def get_dynamodb_client(region):
    """DynamoDBクライアントを初期化"""
    if not region:
        print("ERROR: AWSリージョンが指定されていません。")
        print("使用方法: python sample_data_create.py --region <region>")
        sys.exit(1)
    
    try:
        return boto3.resource('dynamodb', region_name=region)
    except Exception as e:
        print(f"ERROR: DynamoDBクライアントの初期化に失敗しました: {e}")
        sys.exit(1)


def delete_all_data(dynamodb):
    """Delete all data from all tables"""
    tables = [
        TAG_CATEGORY_TABLE, 
        TAG_TABLE
    ]
    
    for table_name in tables:
        try:
            table = dynamodb.Table(table_name)
            print(f"\nDeleting all data from {table_name}...")
            
            # Scan the table to get all items
            response = table.scan()
            items = response.get('Items', [])
            
            # Delete each item
            with table.batch_writer() as batch:
                for item in items:
                    if table_name == TAG_CATEGORY_TABLE:
                        batch.delete_item(Key={'tagcategory_id': item['tagcategory_id']})
                    elif table_name == TAG_TABLE:
                        batch.delete_item(Key={'tag_id': item['tag_id']})
            
            print(f"Deleted {len(items)} items from {table_name}")
            
        except Exception as e:
            print(f"Error deleting data from {table_name}: {e}")

def create_sample_data(dynamodb, lang='ja'):
    """Create sample data in all tables"""
    
    trans = TRANSLATIONS[lang]
    
    # Create sample tag category data
    tag_category_table = dynamodb.Table(TAG_CATEGORY_TABLE)
    tag_category_items = [
        {
            'tagcategory_id': 'category-001',
            'tagcategory_name': trans['categories']['category-001']['name'],
            'updatedate': '2024-01-15T09:00:00',
            'system_prompt': trans['categories']['category-001']['system_prompt'],
            'detect_prompt': trans['categories']['category-001']['detect_prompt']
        },
        {
            'tagcategory_id': 'category-002',
            'tagcategory_name': trans['categories']['category-002']['name'],
            'updatedate': '2024-01-15T09:30:00',
            'system_prompt': trans['categories']['category-002']['system_prompt'],
            'detect_prompt': trans['categories']['category-002']['detect_prompt']
        },
        {
            'tagcategory_id': 'category-003',
            'tagcategory_name': trans['categories']['category-003']['name'],
            'updatedate': '2024-01-15T10:00:00',
            'system_prompt': trans['categories']['category-003']['system_prompt'],
            'detect_prompt': trans['categories']['category-003']['detect_prompt']
        },
        {
            'tagcategory_id': 'category-004',
            'tagcategory_name': trans['categories']['category-004']['name'],
            'updatedate': '2024-01-15T11:00:00',
            'system_prompt': trans['categories']['category-004']['system_prompt'],
            'detect_prompt': trans['categories']['category-004']['detect_prompt']
        },
        {
            'tagcategory_id': 'category-004',
            'tagcategory_name': trans['categories']['category-004']['name'],
            'updatedate': '2024-01-15T11:00:00',
            'system_prompt': trans['categories']['category-004']['system_prompt'],
            'detect_prompt': trans['categories']['category-004']['detect_prompt']
        },
        {
            'tagcategory_id': 'category-005',
            'tagcategory_name': trans['categories']['category-005']['name'],
            'updatedate': '2024-01-15T11:00:00',
            'system_prompt': trans['categories']['category-005']['system_prompt'],
            'detect_prompt': trans['categories']['category-005']['detect_prompt']
        },
        {
            'tagcategory_id': 'category-006',
            'tagcategory_name': trans['categories']['category-006']['name'],
            'updatedate': '2024-01-15T11:00:00',
            'system_prompt': trans['categories']['category-006']['system_prompt'],
            'detect_prompt': trans['categories']['category-006']['detect_prompt']
        },
        {
            'tagcategory_id': 'category-007',
            'tagcategory_name': trans['categories']['category-007']['name'],
            'updatedate': '2024-01-15T11:00:00',
            'system_prompt': trans['categories']['category-007']['system_prompt'],
            'detect_prompt': trans['categories']['category-007']['detect_prompt']
        }
    ]
    
    print("\nAdding sample data to tag category table...")
    for item in tag_category_items:
        tag_category_table.put_item(Item=item)
        print(f"Added tag category: {item['tagcategory_name']}")
    
    # Create sample tag data
    tag_table = dynamodb.Table(TAG_TABLE)
    tag_items = [
        # 建設現場安全監視カテゴリのタグ
        {
            'tag_id': 'tag-001',
            'tag_name': trans['tags']['tag-001']['name'],
            'detect_tag_name': 'no_helmet',
            'tag_prompt': trans['tags']['tag-001']['prompt'],
            'description': trans['tags']['tag-001']['description'],
            'tagcategory_id': 'category-001',
            's3path': f'',
            'file_format': '',
            'updatedate': '2024-01-15T09:00:00'
        },
        {
            'tag_id': 'tag-003',
            'tag_name': trans['tags']['tag-003']['name'],
            'detect_tag_name': 'restricted_area',
            'tag_prompt': trans['tags']['tag-003']['prompt'],
            'description': trans['tags']['tag-003']['description'],
            'tagcategory_id': 'category-001',
            's3path': f'',
            'file_format': '',
            'updatedate': '2024-01-15T09:00:00'
        },
        {
            'tag_id': 'tag-004',
            'tag_name': trans['tags']['tag-004']['name'],
            'detect_tag_name': 'safety_equipment_missing',
            'tag_prompt': trans['tags']['tag-004']['prompt'],
            'description': trans['tags']['tag-004']['description'],
            'tagcategory_id': 'category-001',
            's3path': f'',
            'file_format': '',
            'updatedate': '2024-01-15T09:00:00'
        },
        {
            'tag_id': 'tag-005',
            'tag_name': trans['tags']['tag-005']['name'],
            'detect_tag_name': 'person',
            'tag_prompt': trans['tags']['tag-005']['prompt'],
            'description': trans['tags']['tag-005']['description'],
            'tagcategory_id': 'category-001',
            's3path': f'',
            'file_format': '',
            'updatedate': '2024-01-15T09:00:00'
        },
        {
            'tag_id': 'tag-006',
            'tag_name': trans['tags']['tag-006']['name'],
            'detect_tag_name': 'vehicle',
            'tag_prompt': trans['tags']['tag-006']['prompt'],
            'description': trans['tags']['tag-006']['description'],
            'tagcategory_id': 'category-001',
            's3path': f'',
            'file_format': '',
            'updatedate': '2024-01-15T09:00:00'
        },
        # セキュリティ監視カテゴリのタグ
        {
            'tag_id': 'tag-007',
            'tag_name': trans['tags']['tag-007']['name'],
            'detect_tag_name': 'suspicious_person',
            'tag_prompt': trans['tags']['tag-007']['prompt'],
            'description': trans['tags']['tag-007']['description'],
            'tagcategory_id': 'category-002',
            's3path': f'',
            'file_format': '',
            'updatedate': '2024-01-15T09:30:00'
        },
        {
            'tag_id': 'tag-008',
            'tag_name': trans['tags']['tag-008']['name'],
            'detect_tag_name': 'object_movement',
            'tag_prompt': trans['tags']['tag-008']['prompt'],
            'description': trans['tags']['tag-008']['description'],
            'tagcategory_id': 'category-002',
            's3path': f'',
            'file_format': '',
            'updatedate': '2024-01-15T09:30:00'
        },
        {
            'tag_id': 'tag-009',
            'tag_name': trans['tags']['tag-009']['name'],
            'detect_tag_name': 'fire_sign',
            'tag_prompt': trans['tags']['tag-009']['prompt'],
            'description': trans['tags']['tag-009']['description'],
            'tagcategory_id': 'category-002',
            's3path': f'',
            'file_format': '',
            'updatedate': '2024-01-15T09:30:00'
        },
        # 作業進捗監視カテゴリのタグ
        {
            'tag_id': 'tag-010',
            'tag_name': trans['tags']['tag-010']['name'],
            'detect_tag_name': 'machinery_operation',
            'tag_prompt': trans['tags']['tag-010']['prompt'],
            'description': trans['tags']['tag-010']['description'],
            'tagcategory_id': 'category-003',
            's3path': f'',
            'file_format': '',
            'updatedate': '2024-01-15T10:00:00'
        },
        {
            'tag_id': 'tag-011',
            'tag_name': trans['tags']['tag-011']['name'],
            'detect_tag_name': 'worker_count_change',
            'tag_prompt': trans['tags']['tag-011']['prompt'],
            'description': trans['tags']['tag-011']['description'],
            'tagcategory_id': 'category-003',
            's3path': f'',
            'file_format': '',
            'updatedate': '2024-01-15T10:00:00'
        },
        {
            'tag_id': 'tag-012',
            'tag_name': trans['tags']['tag-012']['name'],
            'detect_tag_name': 'progress_delay',
            'tag_prompt': trans['tags']['tag-012']['prompt'],
            'description': trans['tags']['tag-012']['description'],
            'tagcategory_id': 'category-003',
            's3path': f'',
            'file_format': '',
            'updatedate': '2024-01-15T10:00:00'
        },
        # ロボット監視用タグ
        {
            'tag_id': 'tag-013',
            'tag_name': trans['tags']['tag-013']['name'],
            'detect_tag_name': 'robot_operation',
            'tag_prompt': trans['tags']['tag-013']['prompt'],
            'description': trans['tags']['tag-013']['description'],
            'tagcategory_id': 'category-003',
            's3path': f'',
            'file_format': '',
            'updatedate': '2024-01-15T10:30:00'
        },
        {
            'tag_id': 'tag-014',
            'tag_name': trans['tags']['tag-014']['name'],
            'detect_tag_name': 'robot_error',
            'tag_prompt': trans['tags']['tag-014']['prompt'],
            'description': trans['tags']['tag-014']['description'],
            'tagcategory_id': 'category-003',
            's3path': f'',
            'file_format': '',
            'updatedate': '2024-01-15T10:30:00'
        },
        {
            'tag_id': 'tag-015',
            'tag_name': trans['tags']['tag-015']['name'],
            'detect_tag_name': 'obstacle_detected',
            'tag_prompt': trans['tags']['tag-015']['prompt'],
            'description': trans['tags']['tag-015']['description'],
            'tagcategory_id': 'category-003',
            's3path': f'',
            'file_format': '',
            'updatedate': '2024-01-15T10:30:00'
        },
        {
            'tag_id': 'tag-016',
            'tag_name': trans['tags']['tag-016']['name'],
            'detect_tag_name': 'low_battery',
            'tag_prompt': trans['tags']['tag-016']['prompt'],
            'description': trans['tags']['tag-016']['description'],
            'tagcategory_id': 'category-003',
            's3path': f'',
            'file_format': '',
            'updatedate': '2024-01-15T10:30:00'
        },
        # 動画ストリーム監視カテゴリのタグ
        {
            'tag_id': 'tag-017',
            'tag_name': trans['tags']['tag-017']['name'],
            'detect_tag_name': 'stream_quality_low',
            'tag_prompt': trans['tags']['tag-017']['prompt'],
            'description': trans['tags']['tag-017']['description'],
            'tagcategory_id': 'category-004',
            's3path': f'',
            'file_format': '',
            'updatedate': '2024-01-15T11:00:00'
        },
        {
            'tag_id': 'tag-018',
            'tag_name': trans['tags']['tag-018']['name'],
            'detect_tag_name': 'audio_abnormal',
            'tag_prompt': trans['tags']['tag-018']['prompt'],
            'description': trans['tags']['tag-018']['description'],
            'tagcategory_id': 'category-004',
            's3path': f'',
            'file_format': '',
            'updatedate': '2024-01-15T11:00:00'
        },
        {
            'tag_id': 'tag-019',
            'tag_name': trans['tags']['tag-019']['name'],
            'detect_tag_name': 'screen_freeze',
            'tag_prompt': trans['tags']['tag-019']['prompt'],
            'description': trans['tags']['tag-019']['description'],
            'tagcategory_id': 'category-004',
            's3path': f'',
            'file_format': '',
            'updatedate': '2024-01-15T11:00:00'
        },
        {
            'tag_id': 'tag-020',
            'tag_name': trans['tags']['tag-020']['name'],
            'detect_tag_name': 'stream_interrupted',
            'tag_prompt': trans['tags']['tag-020']['prompt'],
            'description': trans['tags']['tag-020']['description'],
            'tagcategory_id': 'category-004',
            's3path': f'',
            'file_format': '',
            'updatedate': '2024-01-15T11:00:00'
        },
        {
            'tag_id': 'tag-021',
            'tag_name': trans['tags']['tag-021']['name'],
            'detect_tag_name': 'inappropriate_content',
            'tag_prompt': trans['tags']['tag-021']['prompt'],
            'description': trans['tags']['tag-021']['description'],
            'tagcategory_id': 'category-004',
            's3path': f'',
            'file_format': '',
            'updatedate': '2024-01-15T11:00:00'
        },
        {
            'tag_id': 'tag-022',
            'tag_name': trans['tags']['tag-022']['name'],
            'detect_tag_name': 'viewer_count_change',
            'tag_prompt': trans['tags']['tag-022']['prompt'],
            'description': trans['tags']['tag-022']['description'],
            'tagcategory_id': 'category-004',
            's3path': f'',
            'file_format': '',
            'updatedate': '2024-01-15T11:00:00'
        },
        {
            'tag_id': 'tag-023',
            'tag_name': trans['tags']['tag-023']['name'],
            'detect_tag_name': 'live_event',
            'tag_prompt': trans['tags']['tag-023']['prompt'],
            'description': trans['tags']['tag-023']['description'],
            'tagcategory_id': 'category-004',
            's3path': f'',
            'file_format': '',
            'updatedate': '2024-01-15T11:00:00'
        },
        # 重機稼働監視用タグ（cam-004用）
        {
            'tag_id': 'tag-024',
            'tag_name': trans['tags']['tag-024']['name'],
            'detect_tag_name': 'machinery_active',
            'tag_prompt': trans['tags']['tag-024']['prompt'],
            'description': trans['tags']['tag-024']['description'],
            'tagcategory_id': 'category-003',
            's3path': f'',
            'file_format': '',
            'updatedate': '2024-01-15T12:00:00'
        },
        {
            'tag_id': 'tag-025',
            'tag_name': trans['tags']['tag-025']['name'],
            'detect_tag_name': 'machinery_idle',
            'tag_prompt': trans['tags']['tag-025']['prompt'],
            'description': trans['tags']['tag-025']['description'],
            'tagcategory_id': 'category-003',
            's3path': f'',
            'file_format': '',
            'updatedate': '2024-01-15T12:00:00'
        },
        {
            'tag_id': 'tag-026',
            'tag_name': trans['tags']['tag-026']['name'],
            'detect_tag_name': 'no_machinery',
            'tag_prompt': trans['tags']['tag-026']['prompt'],
            'description': trans['tags']['tag-026']['description'],
            'tagcategory_id': 'category-003',
            's3path': f'',
            'file_format': '',
            'updatedate': '2024-01-15T12:00:00'
        },
        # 事故リスク監視用タグ（cam-002用）
        {
            'tag_id': 'tag-027',
            'tag_name': trans['tags']['tag-027']['name'],
            'detect_tag_name': 'high_accident_risk',
            'tag_prompt': trans['tags']['tag-027']['prompt'],
            'description': trans['tags']['tag-027']['description'],
            'tagcategory_id': 'category-001',
            's3path': f'',
            'file_format': '',
            'updatedate': '2024-01-15T12:30:00'
        },
        # おもちゃ建機種類識別用タグ（cam-001用）
        {
            'tag_id': 'tag-028',
            'tag_name': trans['tags']['tag-028']['name'],
            'detect_tag_name': 'excavator',
            'tag_prompt': trans['tags']['tag-028']['prompt'],
            'description': trans['tags']['tag-028']['description'],
            'tagcategory_id': 'category-003',
            's3path': f'',
            'file_format': '',
            'updatedate': '2024-01-15T13:00:00'
        },
        {
            'tag_id': 'tag-029',
            'tag_name': trans['tags']['tag-029']['name'],
            'detect_tag_name': 'mixer_truck',
            'tag_prompt': trans['tags']['tag-029']['prompt'],
            'description': trans['tags']['tag-029']['description'],
            'tagcategory_id': 'category-003',
            's3path': f'',
            'file_format': '',
            'updatedate': '2024-01-15T13:00:00'
        },
        {
            'tag_id': 'tag-030',
            'tag_name': trans['tags']['tag-030']['name'],
            'detect_tag_name': 'crane_truck',
            'tag_prompt': trans['tags']['tag-030']['prompt'],
            'description': trans['tags']['tag-030']['description'],
            'tagcategory_id': 'category-003',
            's3path': f'',
            'file_format': '',
            'updatedate': '2024-01-15T13:00:00'
        },
        {
            'tag_id': 'tag-031',
            'tag_name': trans['tags']['tag-031']['name'],
            'detect_tag_name': 'dump_truck',
            'tag_prompt': trans['tags']['tag-031']['prompt'],
            'description': trans['tags']['tag-031']['description'],
            'tagcategory_id': 'category-003',
            's3path': f'',
            'file_format': '',
            'updatedate': '2024-01-15T13:00:00'
        },
        {
            'tag_id': 'tag-032',
            'tag_name': trans['tags']['tag-032']['name'],
            'detect_tag_name': 'wheel_loader',
            'tag_prompt': trans['tags']['tag-032']['prompt'],
            'description': trans['tags']['tag-032']['description'],
            'tagcategory_id': 'category-003',
            's3path': f'',
            'file_format': '',
            'updatedate': '2024-01-15T13:00:00'
        },
        {
            'tag_id': 'tag-033',
            'tag_name': trans['tags']['tag-033']['name'],
            'detect_tag_name': 'peaple',
            'tag_prompt': trans['tags']['tag-033']['prompt'],
            'description': trans['tags']['tag-033']['description'],
            'tagcategory_id': 'category-005',
            's3path': f'',
            'file_format': '',
            'updatedate': '2024-01-15T09:00:00'
        },
        {
            'tag_id': 'tag-034',
            'tag_name': trans['tags']['tag-034']['name'],
            'detect_tag_name': 'collapsed_person',
            'tag_prompt': trans['tags']['tag-034']['prompt'],
            'description': trans['tags']['tag-034']['description'],
            'tagcategory_id': 'category-005',
            's3path': f'',
            'file_format': '',
            'updatedate': '2024-01-15T09:00:00'
        },
        {
            'tag_id': 'tag-035',
            'tag_name': trans['tags']['tag-035']['name'],
            'detect_tag_name': 'collapsed_person',
            'tag_prompt': trans['tags']['tag-035']['prompt'],
            'description': trans['tags']['tag-035']['description'],
            'tagcategory_id': 'category-005',
            's3path': f'',
            'file_format': '',
            'updatedate': '2024-01-15T09:00:00'
        },
        {
            'tag_id': 'tag-036',
            'tag_name': trans['tags']['tag-036']['name'],
            'detect_tag_name': 'peaple',
            'tag_prompt': trans['tags']['tag-036']['prompt'],
            'description': trans['tags']['tag-036']['description'],
            'tagcategory_id': 'category-006',
            's3path': f'',
            'file_format': '',
            'updatedate': '2024-01-15T09:00:00'
        },
        {
            'tag_id': 'tag-037',
            'tag_name': trans['tags']['tag-037']['name'],
            'detect_tag_name': 'collapsed_person',
            'tag_prompt': trans['tags']['tag-037']['prompt'],
            'description': trans['tags']['tag-037']['description'],
            'tagcategory_id': 'category-006',
            's3path': f'',
            'file_format': '',
            'updatedate': '2024-01-15T09:00:00'
        },
        {
            'tag_id': 'tag-038',
            'tag_name': trans['tags']['tag-038']['name'],
            'detect_tag_name': 'peaple',
            'tag_prompt': trans['tags']['tag-038']['prompt'],
            'description': trans['tags']['tag-038']['description'],
            'tagcategory_id': 'category-007',
            's3path': f'',
            'file_format': '',
            'updatedate': '2024-01-15T09:00:00'
        },
        {
            'tag_id': 'tag-039',
            'tag_name': trans['tags']['tag-039']['name'],
            'detect_tag_name': 'collapsed_person',
            'tag_prompt': trans['tags']['tag-039']['prompt'],
            'description': trans['tags']['tag-039']['description'],
            'tagcategory_id': 'category-007',
            's3path': f'',
            'file_format': '',
            'updatedate': '2024-01-15T09:00:00'
        }  
    ]

    print("\nAdding sample data to tag table...")
    for item in tag_items:
        tag_table.put_item(Item=item)
        print(f"Added tag: {item['tag_name']} (category: {item['tagcategory_id']})")
    
   


if __name__ == "__main__":
    # コマンドライン引数の解析
    parser = argparse.ArgumentParser(description='DynamoDB sample data creation for Cedix project')
    parser.add_argument('--region', type=str, default=os.environ.get('AWS_REGION'), help='AWS region (e.g., ap-northeast-1)')
    parser.add_argument('--lang', type=str, default='ja', choices=['ja', 'en'], help='Language for sample data (ja or en)')
    args = parser.parse_args()
    
    # リージョンの検証
    if not args.region:
        print("ERROR: AWSリージョンが指定されていません。")
        print("使用方法: python sample_data_create_tagonly.py --region <region>")
        print("または環境変数 AWS_REGION を設定してください。")
        sys.exit(1)
    
    print("Testing DynamoDB tables for Cedix project")
    print("=============================================")
    print(f"Using AWS Region: {args.region}")
    print(f"Language: {args.lang}")
    
    # DynamoDBクライアントを初期化
    dynamodb = get_dynamodb_client(args.region)
    
    try:
        # First delete all existing data
        delete_all_data(dynamodb)
        time.sleep(2)  # nosemgrep: arbitrary-sleep - DynamoDB処理完了待ち
        
        # Then create new sample data
        create_sample_data(dynamodb, args.lang)
        time.sleep(2)  # nosemgrep: arbitrary-sleep - DynamoDB処理完了待ち
        
        print("\n" + "=" * 50)
        print("Test completed successfully!")
        print("=" * 50)
    except Exception as e:
        print(f"\nError: {e}")
        print("\nMake sure:")
        print("1. The DynamoDB tables have been created using the deploy.sh script")
        print("2. You have AWS credentials configured with appropriate permissions")
        print(f"3. You're in the correct AWS region ({args.region})")
