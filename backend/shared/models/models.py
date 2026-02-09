from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime

# Place models
class PlaceBase(BaseModel):
    name: str

class PlaceCreate(PlaceBase):
    pass  # place_id is auto-generated on the backend

class Place(PlaceBase):
    place_id: str

    class Config:
        from_attributes = True


# Camera models
class CameraBase(BaseModel):
    name: str
    place_id: str
    type: str
    vsaas_device_id: Optional[str] = None
    vsaas_apikey: Optional[str] = None
    kinesis_streamarn: Optional[str] = None
    capture: Optional[str] = None
    s3path: Optional[str] = None
    aws_access_key: Optional[str] = None
    aws_secret_access_key: Optional[str] = None
    aws_region: Optional[str] = None
    camera_endpoint: Optional[str] = None  # none, rtsp, rtmp
    camera_endpoint_cloudformation_stack: Optional[str] = None
    rtsp_url: Optional[str] = None
    # RTMP関連フィールド
    rtmp_endpoint: Optional[str] = None
    rtmp_stream_key: Optional[str] = None
    rtmp_port: Optional[int] = None
    rtmp_kvs_stream_name: Optional[str] = None
    rtmp_deploy_status: Optional[str] = None
    rtmp_nlb_id: Optional[str] = None
    rtmp_server_stack: Optional[str] = None

class CameraCreate(CameraBase):
    camera_id: Optional[str] = None
    # RTSP デプロイ用の一時的なフィールド（DBには保存しない）
    stream_name: Optional[str] = None        # KVS Stream名 (camera_endpoint=rtspの場合必須)
    retention_period: Optional[str] = "24"   # KVS保持期間
    fragment_duration: Optional[str] = "500" # フラグメント期間
    storage_size: Optional[str] = "512"      # ストレージサイズ

class Camera(CameraBase):
    camera_id: str
    presigned_url: Optional[str] = None

    class Config:
        from_attributes = True

# CameraCollector models
class CameraCollectorBase(BaseModel):
    camera_id: str
    collector: str
    collector_mode: Optional[str] = None
    cloudformation_stack: Optional[str] = None
    capture_cron: Optional[str] = None
    capture_image_interval: Optional[int] = None
    capture_video_duration: Optional[int] = None
    capture_track_interval: Optional[int] = None
    collect_class: Optional[str] = None
    track_eventtype: Optional[str] = None
    detect_area: Optional[str] = None
    area_detect_type: Optional[str] = None
    area_detect_iou_threshold: Optional[float] = None
    area_detect_method: Optional[str] = None
    capture_track_image_flg: Optional[bool] = True
    capture_track_image_counter: Optional[int] = 25
    model_path: Optional[str] = 'yolo11n.pt'
    confidence: Optional[float] = 0.5  # YOLO confidence threshold

class CameraCollectorCreate(CameraCollectorBase):
    collector_id: Optional[str] = None

class CameraCollectorUpdate(BaseModel):
    """コレクター更新用モデル（動作設定のみ更新可能）"""
    capture_image_interval: Optional[int] = None
    capture_video_duration: Optional[int] = None
    capture_track_interval: Optional[int] = None
    collect_class: Optional[str] = None
    track_eventtype: Optional[str] = None
    detect_area: Optional[str] = None
    area_detect_type: Optional[str] = None
    area_detect_iou_threshold: Optional[float] = None
    area_detect_method: Optional[str] = None
    capture_track_image_flg: Optional[bool] = None
    capture_track_image_counter: Optional[int] = None
    model_path: Optional[str] = None
    confidence: Optional[float] = None  # YOLO confidence threshold

class CameraCollector(CameraCollectorBase):
    collector_id: str

    class Config:
        from_attributes = True

# File models
class FileBase(BaseModel):
    camera_id: str
    start_time: str
    end_time: Optional[str] = None
    s3path: Optional[str] = None
    collector_id: str
    file_type: str
    collector_id_file_type: Optional[str] = None
    s3path_detect: Optional[str] = None

class FileCreate(FileBase):
    file_id: Optional[str] = None

class File(FileBase):
    file_id: str
    presigned_url: Optional[str] = None
    presigned_url_detect: Optional[str] = None  # Presigned URL for detect image (hlsYolo)
    has_detect: Optional[bool] = None  # Detection log existence flag

    class Config:
        from_attributes = True

# User info model
class UserInfo(BaseModel):
    username: str
    email: Optional[str] = None
    groups: Optional[List[str]] = None
    attributes: Optional[Dict[str, Any]] = None

# HLS URL model
class HlsUrl(BaseModel):
    camera_id: str
    url: str

# MP4 Download model
class Mp4Download(BaseModel):
    file_id: str
    s3path: str
    presigned_url: Optional[str] = None

# File query model
class FileQuery(BaseModel):
    camera_id: str
    datetime: str  # Format: YYYYMMDDHH
    files: List[File] = []

class FileUpdate(BaseModel):
    camera_id: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    s3path: Optional[str] = None
    collector: Optional[str] = None
    file_type: Optional[str] = None
