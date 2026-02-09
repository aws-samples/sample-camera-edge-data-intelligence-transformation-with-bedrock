"""
YOLO Detector モジュール

YOLO検出処理を提供します。

使用例:
    # HLS用（トラッキングあり）
    detector = YoloDetector(model_path='v9-c')
    detections = detector.detect(frame)  # track_id, velocity を含む
    
    # S3用（トラッキングあり、track_idは無視）
    detector = YoloDetector(model_path='v9-c')
    detections = detector.detect(image)  # track_idは含まれるが、ワンショットでは意味なし
    
    # フィルタリング
    filtered = filter_detections_by_class(detections, ['person', 'car'], 0.5)
"""

from .detector import YoloDetector
from .class_detect import filter_detections_by_class, build_class_detect_data

__all__ = [
    'YoloDetector',
    'filter_detections_by_class',
    'build_class_detect_data'
]
