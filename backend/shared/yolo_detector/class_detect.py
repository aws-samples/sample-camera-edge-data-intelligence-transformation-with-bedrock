"""
class_detect 共通処理モジュール

hlsyolo / s3yolo で共通利用する class_detect 処理を提供します。
"""

from typing import List, Dict, Any
import logging

logger = logging.getLogger(__name__)


def filter_detections_by_class(
    detections: List[Dict[str, Any]],
    collect_classes: List[str],
    confidence_threshold: float
) -> List[Dict[str, Any]]:
    """
    検出結果をクラスと信頼度でフィルタリング
    
    Args:
        detections: YoloDetector.detect()の結果
        collect_classes: 収集対象クラスリスト（例: ['person', 'car']）
        confidence_threshold: 信頼度閾値
        
    Returns:
        フィルタ後の検出結果
    """
    collect_classes_lower = [c.lower() for c in collect_classes]
    
    return [
        d for d in detections
        if d['class'].lower() in collect_classes_lower
        and d['confidence'] >= confidence_threshold
    ]


def build_class_detect_data(
    detections: List[Dict[str, Any]],
    filtered_detections: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    class_detect用のデータ構造を構築
    
    Args:
        detections: 全検出結果
        filtered_detections: フィルタ後の検出結果
        
    Returns:
        detect-log保存用のデータ
    """
    classes = list(set([d.get('class', 'unknown') for d in filtered_detections]))
    
    # track_idがある場合（hlsyolo）とない場合（s3yolo）を考慮
    tracks = []
    for d in filtered_detections:
        track_info = {'class': d.get('class')}
        if 'track_id' in d:
            track_info['track_id'] = d.get('track_id')
        tracks.append(track_info)
    
    return {
        'classes': classes,
        'total_count': len(detections),
        'filtered_count': len(filtered_detections),
        'tracks': tracks
    }
