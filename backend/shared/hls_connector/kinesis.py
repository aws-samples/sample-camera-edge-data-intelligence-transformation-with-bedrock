"""
Kinesis Video Streams用HLSコネクター

AWS Kinesis Video StreamsからHLSストリーミングURLを取得するコネクター実装。
LIVE → LIVE_REPLAY → ON_DEMAND の順でHLS URLの取得を試行します。
"""

from datetime import timedelta
from typing import Optional
import logging

from .base import HlsConnectorBase
from shared.common import create_boto3_session
from shared.timezone_utils import now_utc


class KinesisConnector(HlsConnectorBase):
    """
    Kinesis Video Streams用のHLSコネクター
    
    AWS Kinesis Video StreamsからHLS URLを取得します。
    セッションベースのURLのため、再接続時は毎回新しいURLを取得する必要があります。
    
    Attributes:
        camera_info (dict): カメラ情報（kinesis_streamarn, aws_access_key等を含む）
    """
    
    @property
    def camera_type(self) -> str:
        return 'kinesis'
    
    @property
    def needs_url_refresh(self) -> bool:
        # Kinesisはセッションベースのため、再接続時に毎回新しいURLが必要
        return True
    
    def validate_config(self) -> None:
        """Kinesis用設定の検証"""
        stream_arn = self.camera_info.get('kinesis_streamarn')
        if not stream_arn:
            raise ValueError("kinesis_streamarnが設定されていません")
    
    def _fetch_hls_url(self) -> str:
        """Kinesis Video StreamsからHLS URLを取得"""
        stream_arn = self.camera_info['kinesis_streamarn']
        
        # AWSクレデンシャルの取得
        access_key = (self.camera_info.get('aws_access_key') or '').strip() or None
        secret_key = (self.camera_info.get('aws_secret_access_key') or '').strip() or None
        region_name = (self.camera_info.get('aws_region') or '').strip() or None
        
        # アクセスキーとシークレットキーは両方設定されている場合のみ使用
        if not (access_key and secret_key):
            access_key = secret_key = None
            
        session = create_boto3_session(access_key, secret_key, region_name)
        kinesis_video = session.client('kinesisvideo')
        
        # ストリーム情報の取得とログ出力
        self._log_stream_info(kinesis_video, stream_arn, session)
        
        # エンドポイント取得
        endpoint_response = kinesis_video.get_data_endpoint(
            APIName='GET_HLS_STREAMING_SESSION_URL',
            StreamARN=stream_arn
        )
        endpoint = endpoint_response['DataEndpoint']
        self.logger.info(f"エンドポイント: {endpoint}")
        
        kinesis_video_archived_media = session.client(
            'kinesis-video-archived-media',
            endpoint_url=endpoint
        )
        
        # 複数モードを試行してHLS URLを取得
        return self._try_get_hls_url(kinesis_video_archived_media, stream_arn)
    
    def _build_av_options(self) -> dict:
        """Kinesis用のav.openオプションを構築"""
        return {
            "max_reload": "4",
            "rw_timeout": "8000000",
        }
    
    def _try_get_hls_url(self, client, stream_arn: str) -> str:
        """
        LIVE → LIVE_REPLAY → ON_DEMAND の順でHLS URLを取得
        
        Args:
            client: kinesis-video-archived-media クライアント
            stream_arn: ストリームARN
            
        Returns:
            str: HLS URL
            
        Raises:
            Exception: すべてのモードでURL取得に失敗した場合
        """
        hls_url = None
        live_error = None
        replay_error = None
        ondemand_error = None
        
        # 1. LIVEモードを試行
        try:
            self.logger.info("LIVEモードでHLS URLの取得を試行します...")
            hls_params = {
                'StreamARN': stream_arn,
                'PlaybackMode': 'LIVE',
                'Expires': 43200,  # 12時間（最大値）
            }
            hls_url_response = client.get_hls_streaming_session_url(**hls_params)
            hls_url = hls_url_response['HLSStreamingSessionURL']
            self.logger.info(f"LIVEモードでHLS URLを取得しました")
            return hls_url
            
        except Exception as e:
            live_error = e
            self.logger.warning(f"LIVEモードでの取得に失敗: {e}")
        
        # 2. LIVE_REPLAYモードを試行
        try:
            self.logger.info("LIVE_REPLAYモードでHLS URLの取得を試行します...")
            now = now_utc()
            start_timestamp = now - timedelta(minutes=5)
            
            hls_params = {
                'StreamARN': stream_arn,
                'PlaybackMode': 'LIVE_REPLAY',
                'HLSFragmentSelector': {
                    'FragmentSelectorType': 'SERVER_TIMESTAMP',
                    'TimestampRange': {
                        'StartTimestamp': start_timestamp,
                        'EndTimestamp': now
                    }
                },
                'Expires': 300,
            }
            hls_url_response = client.get_hls_streaming_session_url(**hls_params)
            hls_url = hls_url_response['HLSStreamingSessionURL']
            self.logger.info(f"LIVE_REPLAYモードでHLS URLを取得しました")
            return hls_url
            
        except Exception as e:
            replay_error = e
            self.logger.warning(f"LIVE_REPLAYモードでの取得に失敗: {e}")
        
        # 3. ON_DEMANDモードを試行
        try:
            self.logger.info("ON_DEMANDモードでHLS URLの取得を試行します...")
            now = now_utc()
            start_timestamp = now - timedelta(minutes=5)
            end_timestamp = now - timedelta(minutes=1)
            
            hls_params = {
                'StreamARN': stream_arn,
                'PlaybackMode': 'ON_DEMAND',
                'HLSFragmentSelector': {
                    'FragmentSelectorType': 'SERVER_TIMESTAMP',
                    'TimestampRange': {
                        'StartTimestamp': start_timestamp,
                        'EndTimestamp': end_timestamp
                    }
                },
                'Expires': 300,
            }
            hls_url_response = client.get_hls_streaming_session_url(**hls_params)
            hls_url = hls_url_response['HLSStreamingSessionURL']
            self.logger.info(f"ON_DEMANDモードでHLS URLを取得しました")
            return hls_url
            
        except Exception as e:
            ondemand_error = e
            self.logger.error(f"ON_DEMANDモードでの取得に失敗: {e}")
        
        # すべてのモードで失敗
        raise Exception(
            f"すべてのPlaybackModeでHLS URLの取得に失敗しました: "
            f"LIVE={live_error}, LIVE_REPLAY={replay_error}, ON_DEMAND={ondemand_error}"
        )
    
    def _log_stream_info(self, kinesis_video, stream_arn: str, session) -> None:
        """
        ストリーム情報をログ出力
        
        Args:
            kinesis_video: kinesisvideo クライアント
            stream_arn: ストリームARN
            session: boto3セッション
        """
        try:
            stream_info = kinesis_video.describe_stream(StreamARN=stream_arn)
            self.logger.info(f"ストリーム情報:")
            self.logger.info(f"  - ストリームARN: {stream_arn}")
            self.logger.info(f"  - 状態: {stream_info['StreamInfo']['Status']}")
            self.logger.info(f"  - 作成日時: {stream_info['StreamInfo']['CreationTime']}")
            self.logger.info(f"  - データ保持期間: {stream_info['StreamInfo']['DataRetentionInHours']}時間")
            
            # フラグメント情報を確認
            self._log_fragment_info(kinesis_video, stream_arn, session)
            
        except Exception as e:
            self.logger.warning(f"ストリーム情報の取得に失敗: {e}")
    
    def _log_fragment_info(self, kinesis_video, stream_arn: str, session) -> None:
        """
        フラグメント情報をログ出力
        
        Args:
            kinesis_video: kinesisvideo クライアント
            stream_arn: ストリームARN
            session: boto3セッション
        """
        try:
            # データエンドポイントを取得してフラグメント情報を確認
            endpoint_response_fragments = kinesis_video.get_data_endpoint(
                APIName='LIST_FRAGMENTS',
                StreamARN=stream_arn
            )
            endpoint_fragments = endpoint_response_fragments['DataEndpoint']
            
            kinesis_video_archived_media_fragments = session.client(
                'kinesis-video-archived-media',
                endpoint_url=endpoint_fragments
            )
            
            # 最近のフラグメントを確認
            now = now_utc()
            start_time = now - timedelta(hours=1)
            
            fragments_response = kinesis_video_archived_media_fragments.list_fragments(
                StreamARN=stream_arn,
                FragmentSelector={
                    'FragmentSelectorType': 'SERVER_TIMESTAMP',
                    'TimestampRange': {
                        'StartTimestamp': start_time,
                        'EndTimestamp': now
                    }
                },
                MaxResults=10
            )
            
            fragments = fragments_response.get('Fragments', [])
            self.logger.info(f"  - 過去1時間のフラグメント数: {len(fragments)}")
            
            if fragments:
                latest_fragment = fragments[-1]
                self.logger.info(f"  - 最新フラグメント番号: {latest_fragment.get('FragmentNumber')}")
                self.logger.info(f"  - 最新フラグメント時刻: {latest_fragment.get('ServerTimestamp')}")
                self.logger.info(f"  - フラグメントサイズ: {latest_fragment.get('FragmentLengthInMilliseconds')}ms")
            else:
                self.logger.warning("  - フラグメントが見つかりません。ストリームにデータが送信されていない可能性があります。")
                
        except Exception as e:
            self.logger.warning(f"フラグメント情報の取得に失敗: {e}")
