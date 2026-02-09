"""
EventBridge イベント発行モジュール

各コレクターからEventBridgeにイベントを発行する共通モジュール

疎結合設計:
- collector は detector を知らない
- イベントには detector_id, detector_data を含めない
- EventBridge Rule が collector_id でフィルタリングし、InputTransformer で detector_id を注入
"""

import boto3
import json
import logging
from datetime import datetime
from typing import Dict, List, Any, Optional
from decimal import Decimal
from .timezone_utils import format_for_db

logger = logging.getLogger(__name__)

# イベント名定数
EVENT_TYPE_CLASS_DETECT = 'ClassDetectEvent'
EVENT_TYPE_AREA_DETECT = 'AreaDetectEvent'
EVENT_TYPE_SAVE_IMAGE = 'SaveImageEvent'
EVENT_TYPE_SAVE_VIDEO = 'SaveVideoEvent'


def decimal_to_float(obj):
    """Decimal型をfloatに変換するヘルパー"""
    if isinstance(obj, Decimal):
        return float(obj)
    raise TypeError


class EventBridgePublisher:
    """EventBridgeイベント発行クラス"""
    
    def __init__(self, create_boto3_session_func, collector_type: str, event_bus_name: str = 'default'):
        """
        Args:
            create_boto3_session_func: boto3セッション作成関数
            collector_type: コレクタータイプ（例: 'hlsYolo', 'hlsRec'）
            event_bus_name: EventBusの名前（デフォルトは'default'）
        """
        session = create_boto3_session_func()
        self.events_client = session.client('events')
        self.event_bus_name = event_bus_name
        self.collector_type = collector_type
        self.source = f'cedix.collector.{collector_type.lower()}'
    
    def publish_class_detect_event(
        self, 
        camera_id: str,
        collector_id: str,
        file_id: str,
        s3path: str,
        s3path_detect: str,
        track_log_id: str,
        detections: List[Dict],
        filtered_detections: List[Dict],
        image_width: int,
        image_height: int,
        timestamp: datetime
    ) -> bool:
        """
        Class Detectイベントを発行
        
        Args:
            camera_id: カメラID
            collector_id: コレクターID（EventBridge Rule のフィルタキー）
            file_id: ファイルID
            s3path: S3パス（元画像）
            s3path_detect: S3パス（アノテーション画像）
            track_log_id: トラックログID
            detections: 全検出結果
            filtered_detections: フィルタ後の検出結果
            image_width: 画像幅
            image_height: 画像高さ
            timestamp: タイムスタンプ
            
        Returns:
            bool: 発行成功したらTrue
        """
        detail = {
            'eventType': 'class_detect',
            'camera_id': camera_id,
            'collector_id': collector_id,
            'collector_type': self.collector_type,
            'timestamp': format_for_db(timestamp),
            'file_id': file_id,
            's3path': s3path,
            's3path_detect': s3path_detect,
            'track_log_id': track_log_id,
            'detections': {
                'total_count': len(detections),
                'filtered_count': len(filtered_detections),
                'classes': list(set([d['class'] for d in filtered_detections])),
                'tracks': filtered_detections
            },
            'image_info': {
                'width': image_width,
                'height': image_height,
                'format': 'jpeg'
            }
        }
        
        return self._publish_event(EVENT_TYPE_CLASS_DETECT, detail)
    
    def publish_area_detect_event(
        self,
        camera_id: str,
        collector_id: str,
        file_id: str,
        s3path: str,
        s3path_detect: str,
        track_log_id: str,
        time: str,
        track_alldata: Dict[str, Dict],
        track_classdata: Dict[str, Dict],
        area_in_data: Dict[str, Dict],
        area_out_data: Dict[str, Dict],
        area_in_count: int,
        area_out_count: int,
        intrusion_ids: List[int],
        exit_ids: List[int],
        area_polygon: Optional[List[List[int]]],
        image_width: int,
        image_height: int,
        timestamp: datetime,
        area_detect_method: str = 'track_ids_change',
        intrusion_count: int = 0,
        exit_count: int = 0
    ) -> bool:
        """
        Area Detectイベントを発行
        
        DBに保存している全データを含める
        
        Args:
            camera_id: カメラID
            collector_id: コレクターID（EventBridge Rule のフィルタキー）
            file_id: ファイルID
            s3path: S3パス（元画像）
            s3path_detect: S3パス（アノテーション画像）
            track_log_id: トラックログID
            time: 時刻（ISO形式文字列）
            track_alldata: 全検出結果のMap
            track_classdata: フィルタ後の検出結果のMap
            area_in_data: エリア内のtrackのMap
            area_out_data: エリア外のtrackのMap
            area_in_count: エリア内のtrack数
            area_out_count: エリア外のtrack数
            intrusion_ids: 侵入したtrack_idのリスト
            exit_ids: 退出したtrack_idのリスト
            area_polygon: エリアポリゴン座標
            image_width: 画像幅
            image_height: 画像高さ
            timestamp: タイムスタンプ
            area_detect_method: エリア検出方式（'track_ids_change' or 'class_count_change'）
            intrusion_count: 侵入数（class_count_changeモード用）
            exit_count: 退出数（class_count_changeモード用）
            
        Returns:
            bool: 発行成功したらTrue
        """
        # event_type を決定（IDまたはcountで判定）
        has_intrusion = bool(intrusion_ids) or intrusion_count > 0
        has_exit = bool(exit_ids) or exit_count > 0
        
        if has_intrusion and has_exit:
            event_type = 'both'
        elif has_intrusion:
            event_type = 'intrusion'
        elif has_exit:
            event_type = 'exit'
        else:
            event_type = 'no_change'
        
        # intrusion_count / exit_count の計算（IDがある場合はその数を使用）
        actual_intrusion_count = len(intrusion_ids) if intrusion_ids else intrusion_count
        actual_exit_count = len(exit_ids) if exit_ids else exit_count
        
        detail = {
            'eventType': 'area_detect',
            'camera_id': camera_id,
            'collector_id': collector_id,
            'collector_type': self.collector_type,
            'timestamp': format_for_db(timestamp),
            'file_id': file_id,
            's3path': s3path,
            's3path_detect': s3path_detect,
            'track_log_id': track_log_id,
            'time': time,
            'area_detect_method': area_detect_method,
            'area_event': {
                'type': event_type,
                'intrusion_ids': intrusion_ids,
                'exit_ids': exit_ids,
                'intrusion_count': actual_intrusion_count,
                'exit_count': actual_exit_count,
                'area_polygon': area_polygon,
                'area_track_count': area_in_count
            },
            # DBに保存している全データ
            'track_alldata': track_alldata,
            'track_classdata': track_classdata,
            'area_in_data': area_in_data,
            'area_out_data': area_out_data,
            'area_in_count': area_in_count,
            'area_out_count': area_out_count,
            'image_info': {
                'width': image_width,
                'height': image_height,
                'format': 'jpeg'
            }
        }
        
        return self._publish_event(EVENT_TYPE_AREA_DETECT, detail)
    
    def publish_save_image_event(
        self,
        camera_id: str,
        collector_id: str,
        file_id: str,
        s3path: str,
        timestamp: datetime
    ) -> bool:
        """
        Save Imageイベントを発行
        
        画像保存完了通知イベント
        
        Args:
            camera_id: カメラID
            collector_id: コレクターID（EventBridge Rule のフィルタキー）
            file_id: ファイルID
            s3path: S3パス（元画像のみ）
            timestamp: タイムスタンプ
            
        Returns:
            bool: 発行成功したらTrue
        """
        detail = {
            'eventType': 'save_image',
            'camera_id': camera_id,
            'collector_id': collector_id,
            'collector_type': self.collector_type,
            'timestamp': format_for_db(timestamp),
            'file_id': file_id,
            's3path': s3path,
            'image_info': {
                'format': 'jpeg'
            }
        }
        
        return self._publish_event(EVENT_TYPE_SAVE_IMAGE, detail)
    
    def publish_save_video_event(
        self,
        camera_id: str,
        collector_id: str,
        file_id: str,
        s3path: str,
        timestamp: datetime,
        video_duration: Optional[float] = None
    ) -> bool:
        """
        Save Videoイベントを発行
        
        動画保存完了通知イベント
        
        Args:
            camera_id: カメラID
            collector_id: コレクターID（EventBridge Rule のフィルタキー）
            file_id: ファイルID
            s3path: S3パス（動画ファイル）
            timestamp: タイムスタンプ
            video_duration: 動画の長さ（秒、オプション）
            
        Returns:
            bool: 発行成功したらTrue
        """
        video_info = {'format': 'mp4'}
        if video_duration is not None:
            video_info['duration'] = video_duration
        
        detail = {
            'eventType': 'save_video',
            'camera_id': camera_id,
            'collector_id': collector_id,
            'collector_type': self.collector_type,
            'timestamp': format_for_db(timestamp),
            'file_id': file_id,
            's3path': s3path,
            'video_info': video_info
        }
        
        return self._publish_event(EVENT_TYPE_SAVE_VIDEO, detail)
    
    def _publish_event(self, detail_type: str, detail: Dict[str, Any]) -> bool:
        """
        EventBridgeにイベントを発行
        
        Args:
            detail_type: イベントのDetailType
            detail: イベントの詳細
            
        Returns:
            bool: 発行成功したらTrue
        """
        try:
            response = self.events_client.put_events(
                Entries=[
                    {
                        'Source': self.source,
                        'DetailType': detail_type,
                        'Detail': json.dumps(detail, default=decimal_to_float),
                        'EventBusName': self.event_bus_name
                    }
                ]
            )
            
            if response['FailedEntryCount'] > 0:
                logger.error(f"EventBridge発行失敗: {response['Entries']}")
                return False
            
            logger.info(f"EventBridge発行成功: {detail_type}, camera_id={detail.get('camera_id')}, collector_id={detail.get('collector_id')}")
            return True
            
        except Exception as e:
            logger.error(f"EventBridge発行エラー ({detail_type}): {e}", exc_info=True)
            return False
