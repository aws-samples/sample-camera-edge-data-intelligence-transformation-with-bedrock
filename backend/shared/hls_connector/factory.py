"""
HLSコネクターファクトリー

カメラ情報からカメラタイプを判定し、適切なHLSコネクターインスタンスを生成します。
新しいカメラタイプを追加する場合は、実装クラスを作成してこのファクトリーに登録します。
"""

from typing import Dict, List, Optional, Type
import logging

from .base import HlsConnectorBase
from .kinesis import KinesisConnector
from .vsaas import VSaaSConnector


# 登録されたコネクタークラス
_CONNECTOR_CLASSES: Dict[str, Type[HlsConnectorBase]] = {
    'kinesis': KinesisConnector,
    'vsaas': VSaaSConnector,
}


class HlsConnectorFactory:
    """
    HLSコネクターのファクトリークラス
    
    カメラIDまたはカメラ情報から適切なHLSコネクターを生成します。
    
    Example:
        # カメラIDから生成
        >>> connector = HlsConnectorFactory.create(camera_id, logger)
        >>> hls_url, av_options = connector.get_hls_url()
        
        # カメラ情報から生成
        >>> connector = HlsConnectorFactory.create_from_info(camera_info, logger)
        >>> hls_url, av_options = connector.get_hls_url()
        
        # 新しいコネクタータイプを動的に登録
        >>> HlsConnectorFactory.register('newtype', NewTypeConnector)
    """
    
    @classmethod
    def register(cls, camera_type: str, connector_class: Type[HlsConnectorBase]) -> None:
        """
        新しいコネクタークラスを登録
        
        Args:
            camera_type: カメラタイプ文字列（'kinesis', 'vsaas'等）
            connector_class: HlsConnectorBaseを継承したクラス
            
        Example:
            >>> HlsConnectorFactory.register('newtype', NewTypeConnector)
        """
        _CONNECTOR_CLASSES[camera_type] = connector_class
    
    @classmethod
    def unregister(cls, camera_type: str) -> bool:
        """
        コネクタークラスの登録を解除
        
        Args:
            camera_type: カメラタイプ文字列
            
        Returns:
            bool: 解除に成功した場合True
        """
        if camera_type in _CONNECTOR_CLASSES:
            del _CONNECTOR_CLASSES[camera_type]
            return True
        return False
    
    @classmethod
    def create(cls, camera_id: str, logger: Optional[logging.Logger] = None) -> HlsConnectorBase:
        """
        camera_idからカメラ情報を取得し、適切なコネクターを返す
        
        DynamoDBからカメラ情報を取得し、カメラタイプに応じた
        コネクターインスタンスを生成します。
        
        Args:
            camera_id: カメラID
            logger: ロガー（オプション）
            
        Returns:
            HlsConnectorBase: コネクターインスタンス
            
        Raises:
            ValueError: カメラが見つからない場合
            ValueError: サポートされていないカメラタイプの場合
        """
        from shared.common import get_camera_info
        
        camera_info = get_camera_info(camera_id)
        if not camera_info:
            raise ValueError(f"カメラID '{camera_id}' が見つかりません")
        
        return cls.create_from_info(camera_info, logger)
    
    @classmethod
    def create_from_info(cls, camera_info: dict, logger: Optional[logging.Logger] = None) -> HlsConnectorBase:
        """
        カメラ情報から適切なコネクターを返す
        
        カメラ情報のtypeフィールドを参照し、対応するコネクタークラスの
        インスタンスを生成します。
        
        Args:
            camera_info: カメラ情報辞書（DynamoDBから取得したもの）
            logger: ロガー（オプション）
            
        Returns:
            HlsConnectorBase: コネクターインスタンス
            
        Raises:
            ValueError: サポートされていないカメラタイプの場合
        """
        camera_type = camera_info.get('type')
        
        connector_class = _CONNECTOR_CLASSES.get(camera_type)
        if connector_class is None:
            supported = ', '.join(_CONNECTOR_CLASSES.keys())
            raise ValueError(
                f"サポートされていないカメラタイプです: {camera_type}. "
                f"サポート対象: {supported}"
            )
        
        return connector_class(camera_info, logger)
    
    @classmethod
    def get_supported_types(cls) -> List[str]:
        """
        サポートされているカメラタイプの一覧を返す
        
        Returns:
            list: サポートされているカメラタイプのリスト
        """
        return list(_CONNECTOR_CLASSES.keys())
    
    @classmethod
    def is_supported(cls, camera_type: str) -> bool:
        """
        指定されたカメラタイプがサポートされているか確認
        
        Args:
            camera_type: カメラタイプ文字列
            
        Returns:
            bool: サポートされている場合True
        """
        return camera_type in _CONNECTOR_CLASSES
