"""
HLSコネクター抽象基底クラス

各カメラタイプ（Kinesis, VSaaS等）に対応するコネクターの
共通インターフェースを定義します。
"""

from abc import ABC, abstractmethod
from typing import Tuple, Dict, Optional
import logging


class HlsConnectorBase(ABC):
    """
    HLSストリーム接続の抽象基底クラス
    
    各カメラタイプ（kinesis, vsaas等）に対応するコネクターは
    このクラスを継承して実装します。
    
    Attributes:
        camera_info (dict): カメラ情報辞書
        logger (Logger): ロガーインスタンス
    
    Example:
        >>> connector = HlsConnectorFactory.create_from_info(camera_info, logger)
        >>> hls_url, av_options = connector.get_hls_url()
        >>> # 再接続時
        >>> if connector.needs_url_refresh:
        ...     hls_url, av_options = connector.refresh_url()
    """
    
    def __init__(self, camera_info: dict, logger: Optional[logging.Logger] = None):
        """
        コネクターを初期化
        
        Args:
            camera_info: カメラ情報辞書（DynamoDBから取得したもの）
            logger: ロガーインスタンス（オプション）
        """
        self.camera_info = camera_info
        self.logger = logger or logging.getLogger(__name__)
        self._hls_url: Optional[str] = None
        self._av_options: Optional[dict] = None
        
        # 設定の検証
        self.validate_config()
    
    @property
    @abstractmethod
    def camera_type(self) -> str:
        """
        サポートするカメラタイプを返す
        
        Returns:
            str: カメラタイプ（'kinesis', 'vsaas'等）
        """
        pass
    
    @property
    @abstractmethod
    def needs_url_refresh(self) -> bool:
        """
        再接続時にHLS URLの再取得が必要かどうか
        
        Kinesis: セッションURLのため、再接続時は再取得が必要
        VSaaS: 固定URLのため、再取得不要
        
        Returns:
            bool: 再取得が必要な場合True
        """
        pass
    
    @abstractmethod
    def validate_config(self) -> None:
        """
        設定の検証
        
        必要な設定が存在するかチェックし、
        不足している場合はValueErrorをraiseする。
        
        Raises:
            ValueError: 必要な設定が不足している場合
        """
        pass
    
    @abstractmethod
    def _fetch_hls_url(self) -> str:
        """
        HLS URLを取得する内部メソッド
        
        実装クラスで各カメラタイプに応じたURL取得ロジックを実装する。
        
        Returns:
            str: HLS URL
            
        Raises:
            Exception: URL取得に失敗した場合
        """
        pass
    
    @abstractmethod
    def _build_av_options(self) -> dict:
        """
        av.openに渡すオプションを構築
        
        実装クラスで各カメラタイプに応じたオプションを返す。
        
        Returns:
            dict: av.openに渡すオプション辞書
        """
        pass
    
    def get_hls_url(self, force_refresh: bool = False) -> Tuple[str, dict]:
        """
        HLS URLとav_optionsを取得
        
        キャッシュがある場合はキャッシュを返す。
        needs_url_refreshがTrueの場合は毎回再取得する。
        
        Args:
            force_refresh: Trueの場合、キャッシュを無視して再取得
            
        Returns:
            tuple: (hls_url, av_options)
            
        Raises:
            Exception: URL取得に失敗した場合
        """
        if force_refresh or self._hls_url is None or self.needs_url_refresh:
            self.logger.info(f"{self.camera_type}のHLS URLを取得中...")
            self._hls_url = self._fetch_hls_url()
            self._av_options = self._build_av_options()
            # URLの一部のみログ出力（セキュリティ考慮）
            url_preview = self._hls_url[:80] + "..." if len(self._hls_url) > 80 else self._hls_url
            self.logger.info(f"HLS URL取得完了: {url_preview}")
            
        return self._hls_url, self._av_options
    
    def refresh_url(self) -> Tuple[str, dict]:
        """
        URLを強制的に再取得
        
        再接続時などに使用する。
        
        Returns:
            tuple: (hls_url, av_options)
        """
        return self.get_hls_url(force_refresh=True)
    
    def get_camera_id(self) -> str:
        """
        カメラIDを取得
        
        Returns:
            str: カメラID
        """
        return self.camera_info.get('camera_id', '')
    
    def __repr__(self) -> str:
        return f"<{self.__class__.__name__}(camera_id={self.get_camera_id()}, type={self.camera_type})>"
