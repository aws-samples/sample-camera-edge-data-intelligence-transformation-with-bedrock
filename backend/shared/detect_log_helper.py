#!/usr/bin/env python3
"""
detect-log ヘルパーモジュール

仮想 Detector の作成/取得と detect-log 保存を提供します。
hlsyolo などのコレクターが直接 detect-log を保存できるようにします。

仮想 Detector:
- collector_id に対して一意の detector_id を生成 (col-{collector_id})
- 既存があれば再利用、なければ新規作成
- DynamoDB の cedix-detector テーブルに保存
"""

import logging
import json
from typing import Dict, List, Any, Optional
from datetime import datetime
from decimal import Decimal

from .common import (
    create_boto3_session,
    DETECTOR_TABLE,
    save_detect_log,
    save_tag_timeseries,
    setup_logger
)
from .timezone_utils import now_utc_str, format_for_db

logger = setup_logger(__name__)

# 仮想 Detector の ID プレフィックス
COLLECTOR_INTERNAL_DETECTOR_PREFIX = 'col-'


def _convert_decimal(obj):
    """
    DynamoDB から取得したデータに含まれる Decimal 型を
    JSON シリアライズ可能な型に変換する
    
    Args:
        obj: 変換対象のオブジェクト
        
    Returns:
        Decimal を int/float に変換したオブジェクト
    """
    if isinstance(obj, dict):
        return {k: _convert_decimal(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [_convert_decimal(item) for item in obj]
    elif isinstance(obj, Decimal):
        # 整数であれば int、そうでなければ float に変換
        if obj % 1 == 0:
            return int(obj)
        return float(obj)
    return obj


def get_collector_internal_detector_id(collector_id: str) -> str:
    """
    collector_id から仮想 Detector の detector_id を生成
    
    Args:
        collector_id: コレクターID
        
    Returns:
        仮想 Detector の detector_id (例: col-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
    """
    return f"{COLLECTOR_INTERNAL_DETECTOR_PREFIX}{collector_id}"


def _convert_event_type_to_trigger_event(event_type: str) -> str:
    """
    内部イベントタイプをトリガーイベント形式に変換
    
    Args:
        event_type: 'class_detect' or 'area_detect'
        
    Returns:
        'ClassDetectEvent' or 'AreaDetectEvent'
    """
    event_type_mapping = {
        'class_detect': 'ClassDetectEvent',
        'area_detect': 'AreaDetectEvent',
    }
    return event_type_mapping.get(event_type, event_type)


def get_or_create_collector_internal_detector(
    collector_id: str,
    camera_id: str,
    event_type: str,
    collector_mode: str = 'image'
) -> Optional[Dict[str, Any]]:
    """
    仮想 Detector を取得または作成
    
    collector_id に対して一意の detector_id (col-{collector_id}) で DynamoDB を検索し、
    存在すれば返却、なければ新規作成して返却します。
    
    Args:
        collector_id: コレクターID
        camera_id: カメラID
        event_type: イベントタイプ ('class_detect' or 'area_detect')
        collector_mode: コレクターモード ('image', 'video', 'image_and_video')
        
    Returns:
        仮想 Detector の設定データ、エラー時は None
    """
    detector_id = get_collector_internal_detector_id(collector_id)
    
    try:
        session = create_boto3_session()
        dynamodb = session.resource('dynamodb')
        detector_table = dynamodb.Table(DETECTOR_TABLE)
        
        # 既存の仮想 Detector を検索
        response = detector_table.get_item(
            Key={'detector_id': detector_id}
        )
        
        if 'Item' in response:
            logger.info(f"既存の仮想 Detector を取得: detector_id={detector_id}")
            return response['Item']
        
        # trigger_event を正しい形式に変換
        trigger_event = _convert_event_type_to_trigger_event(event_type)
        
        # 新規作成
        logger.info(f"仮想 Detector を新規作成: detector_id={detector_id}, camera_id={camera_id}, trigger_event={trigger_event}, collector_mode={collector_mode}")
        
        detector_data = {
            'detector_id': detector_id,
            'camera_id': camera_id,
            'collector_id': collector_id,
            'collector_id_file_type': f'{collector_id}|image',
            'file_type': 'image',
            'collector_mode': collector_mode,  # コレクターモードを追加
            'detector': 'collector-internal',  # 仮想 Detector 識別用
            'trigger_event': trigger_event,  # AreaDetectEvent / ClassDetectEvent 形式
            'lambda_endpoint_arn': '',  # 仮想 Detector は Lambda を持たない
            'updatedate': now_utc_str(),
            'is_virtual': True  # 仮想 Detector フラグ
        }
        
        detector_table.put_item(Item=detector_data)
        logger.info(f"仮想 Detector を作成しました: {detector_id}")
        
        return detector_data
        
    except Exception as e:
        logger.error(f"仮想 Detector の取得/作成に失敗: {e}")
        import traceback
        logger.error(f"スタックトレース: {traceback.format_exc()}")
        return None


def save_area_detect_log(
    detector_id: str,
    file_data: Dict[str, Any],
    area_event: Dict[str, Any],
    area_in_data: Dict[str, Any],
    area_out_data: Dict[str, Any],
    area_in_count: int,
    area_out_count: int,
    area_detect_method: str,
    track_log_id: Optional[str] = None,
    s3path_detect: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """
    AreaDetectEvent の情報を detect-log に保存
    
    Args:
        detector_id: 検出器ID (仮想 Detector の ID)
        file_data: ファイルデータ
        area_event: エリアイベント情報
        area_in_data: エリア内データ
        area_out_data: エリア外データ
        area_in_count: エリア内カウント
        area_out_count: エリア外カウント
        area_detect_method: エリア検出判定方法
        track_log_id: トラックログID
        s3path_detect: 検出結果画像のS3パス
        
    Returns:
        保存したデータ、エラー時は None
    """
    try:
        # エリアイベント情報を取得
        event_type = area_event.get('type', 'no_change')
        intrusion_ids = area_event.get('intrusion_ids', [])
        exit_ids = area_event.get('exit_ids', [])
        intrusion_count = area_event.get('intrusion_count', 0)
        exit_count = area_event.get('exit_count', 0)
        
        logger.info(f"AreaDetectEvent保存: event_type={event_type}, intrusion_count={intrusion_count}, exit_count={exit_count}, area_detect_method={area_detect_method}")
        
        # event_type で判定
        detect_tags = []
        detect_notify_reason = ""
        
        if event_type == 'both':
            detect_notify_reason = f"エリア侵入&退出イベントが発生しました（侵入: {intrusion_count}件, 退出: {exit_count}件）"
            detect_tags = ['エリア侵入', 'エリア退出']
        elif event_type == 'intrusion':
            detect_notify_reason = f"エリア侵入イベントが発生しました（{intrusion_count}件）"
            detect_tags = ['エリア侵入']
        elif event_type == 'exit':
            detect_notify_reason = f"エリア退出イベントが発生しました（{exit_count}件）"
            detect_tags = ['エリア退出']
        else:
            logger.warning(f"AreaDetectEvent: 保存対象のイベントタイプではありません（event_type={event_type}）")
            return None
        
        # detect_result を生成（JSON形式）
        # Decimal 型を変換してからJSON化
        detect_result = json.dumps(_convert_decimal({
            'event_type': event_type,
            'area_detect_method': area_detect_method,
            'intrusion_ids': intrusion_ids,
            'intrusion_count': intrusion_count,
            'exit_ids': exit_ids,
            'exit_count': exit_count,
            'area_in_data': area_in_data,
            'area_out_data': area_out_data,
            'area_in_count': area_in_count,
            'area_out_count': area_out_count
        }), ensure_ascii=False)
        
        logger.info(f"AreaDetectEvent: {detect_notify_reason}")
        
        # detect-log に保存
        detect_log_data = save_detect_log(
            detector_id=detector_id,
            detect_result=detect_result,
            detect_notify=True,
            detect_notify_reason=detect_notify_reason,
            detect_tags=detect_tags,
            file_data=file_data,
            detector='collector-internal',
            track_log_id=track_log_id,
            s3path_detect=s3path_detect
        )
        
        if not detect_log_data:
            logger.error("detect-log への保存に失敗")
            return None
        
        # 時系列データを保存
        if not save_tag_timeseries(detect_log_data):
            logger.warning("時系列データの保存に失敗（警告レベル）")
        
        return detect_log_data
        
    except Exception as e:
        logger.error(f"AreaDetect ログ保存エラー: {e}")
        import traceback
        logger.error(f"スタックトレース: {traceback.format_exc()}")
        return None


def save_class_detect_log(
    detector_id: str,
    file_data: Dict[str, Any],
    detections: Dict[str, Any],
    track_log_id: Optional[str] = None,
    s3path_detect: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """
    ClassDetectEvent の情報を detect-log に保存
    
    Args:
        detector_id: 検出器ID (仮想 Detector の ID)
        file_data: ファイルデータ
        detections: 検出情報 (classes, tracks, total_count, filtered_count)
        track_log_id: トラックログID
        s3path_detect: 検出結果画像のS3パス
        
    Returns:
        保存したデータ、エラー時は None
    """
    try:
        # 検出情報を取得
        classes = detections.get('classes', [])
        tracks = detections.get('tracks', [])
        
        if not classes:
            logger.warning("検出されたクラスがありません")
            return None
        
        # detect_notify_reason を生成
        classes_str = ', '.join(classes)
        detect_notify_reason = f"{classes_str}のクラスが検出されました"
        
        # detect_result を生成（JSON形式）
        # Decimal 型を変換してからJSON化
        detect_result = json.dumps(_convert_decimal({
            'classes': classes,
            'total_count': detections.get('total_count', 0),
            'filtered_count': detections.get('filtered_count', 0),
            'tracks': tracks
        }), ensure_ascii=False)
        
        logger.info(f"ClassDetectEvent保存: {detect_notify_reason}")
        
        # detect-log に保存（検出されたクラス名をタグとして設定）
        detect_log_data = save_detect_log(
            detector_id=detector_id,
            detect_result=detect_result,
            detect_notify=True,
            detect_notify_reason=detect_notify_reason,
            detect_tags=classes,
            file_data=file_data,
            detector='collector-internal',
            track_log_id=track_log_id,
            s3path_detect=s3path_detect
        )
        
        if not detect_log_data:
            logger.error("detect-log への保存に失敗")
            return None
        
        # 時系列データを保存
        if not save_tag_timeseries(detect_log_data):
            logger.warning("時系列データの保存に失敗（警告レベル）")
        
        return detect_log_data
        
    except Exception as e:
        logger.error(f"ClassDetect ログ保存エラー: {e}")
        import traceback
        logger.error(f"スタックトレース: {traceback.format_exc()}")
        return None
