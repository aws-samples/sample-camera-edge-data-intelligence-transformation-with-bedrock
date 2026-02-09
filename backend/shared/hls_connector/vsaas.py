"""
VSaaS用HLSコネクター

VSaaS（Video Surveillance as a Service）からHLSストリーミングURLを取得するコネクター実装。
固定のURLパターンを使用し、APIキーによる認証を行います。
"""

from typing import Optional
import logging

from .base import HlsConnectorBase


# VSaaS API設定
# 注意: 実際のSafie APIを使用する場合は、このURLを変更する必要があります
# 詳細は .cursor/SAFIE_RESTORE_GUIDE.md を参照
VSAAS_API_BASE_URL = "https://openapi.vsaas.link"


class VSaaSConnector(HlsConnectorBase):
    """
    VSaaS用のHLSコネクター
    
    VSaaSサービスからHLS URLを取得します。
    固定URLパターンのため、再接続時にURLの再取得は不要です。
    
    Attributes:
        camera_info (dict): カメラ情報（vsaas_device_id, vsaas_apikey等を含む）
    """
    
    @property
    def camera_type(self) -> str:
        return 'vsaas'
    
    @property
    def needs_url_refresh(self) -> bool:
        # VSaaSは固定URLパターンのため、再取得不要
        return False
    
    def validate_config(self) -> None:
        """VSaaS用設定の検証"""
        device_id = self.camera_info.get('vsaas_device_id')
        apikey = self.camera_info.get('vsaas_apikey')
        
        if not device_id:
            raise ValueError("vsaas_device_idが設定されていません")
        if not apikey:
            raise ValueError("vsaas_apikeyが設定されていません")
    
    def _fetch_hls_url(self) -> str:
        """VSaaSのHLS URLを構築"""
        device_id = self.camera_info['vsaas_device_id']
        apikey = self.camera_info['vsaas_apikey']
        
        # VSaaS設定をログ出力
        self.logger.info(f"VSaaS設定:")
        self.logger.info(f"  - デバイスID: {device_id}")
        # APIキーは一部マスク
        masked_apikey = '*' * (len(apikey) - 4) + apikey[-4:] if len(apikey) > 4 else '****'
        self.logger.info(f"  - APIキー: {masked_apikey}")
        
        # HLS URLを構築
        hls_url = f"{VSAAS_API_BASE_URL}/v2/devices/{device_id}/live/playlist.m3u8"
        self.logger.info(f"VSaaS HLS URL: {hls_url}")
        
        return hls_url
    
    def _build_av_options(self) -> dict:
        """VSaaS用のav.openオプションを構築"""
        apikey = self.camera_info['vsaas_apikey']
        
        # 注意: 実際のSafie APIを使用する場合は、ヘッダー名を変更する必要があります
        # 詳細は .cursor/SAFIE_RESTORE_GUIDE.md を参照
        av_options = {
            "headers": f"VSaaS-API-Key: {apikey}\r\n",
            "max_reload": "2",  # VSaaS固有の制限値
            "rw_timeout": "8000000",
        }
        
        self.logger.info(f"VSaaS av.openオプション: max_reload=2, rw_timeout=8000000")
        
        return av_options
