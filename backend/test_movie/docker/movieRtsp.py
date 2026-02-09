import gi
import socket
import os
import boto3
import sys

# 標準出力のバッファリングを無効化
sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)

print("🔧 GStreamerライブラリを初期化中...")

try:
    gi.require_version('Gst', '1.0')
    gi.require_version('GstRtspServer', '1.0')
    from gi.repository import Gst, GstRtspServer, GLib
    print("✅ GStreamerライブラリの読み込み成功")
except Exception as e:
    print(f"❌ GStreamerライブラリの読み込みエラー: {e}")
    sys.exit(1)

def download_from_s3(s3_url, local_path):
    """S3から動画ファイルをダウンロード"""
    try:
        # S3 URLをパース
        # s3://bucket/key の形式を想定
        s3_path = s3_url.replace('s3://', '')
        bucket_name, key = s3_path.split('/', 1)
        
        # S3クライアントを作成
        s3_client = boto3.client('s3')
        
        # ダウンロード実行
        s3_client.download_file(bucket_name, key, local_path)
        print(f"✅ S3からダウンロード完了: {local_path}")
        return local_path
        
    except Exception as e:
        print(f"❌ S3ダウンロードエラー: {e}")
        return None

class LoopingMediaFactory(GstRtspServer.RTSPMediaFactory):
    """
    ループ再生をサポートするカスタムメディアファクトリ
    videotestsrcのパターンを応用したループ再生パイプライン
    """
    def __init__(self, movie_path):
        super().__init__()
        self.movie_path = movie_path
        print(f"🔄 ループ再生メディアファクトリを初期化: {movie_path}")
    
    def do_create_element(self, url):
        """
        カスタムパイプラインを作成
        avidemuxとqueueを使用してループ対応を改善
        """
        # uridecodebin を使用してより安定したループ処理
        pipeline_str = (
            f'uridecodebin uri=file://{self.movie_path} '
            f'! videoconvert ! videoscale ! video/x-raw,width=1280,height=720 '
            f'! x264enc tune=zerolatency bitrate=2000 key-int-max=30 '
            f'! rtph264pay name=pay0 pt=96 config-interval=1'
        )
        print(f"🔧 パイプラインを作成: {pipeline_str}")
        return Gst.parse_launch(pipeline_str)
    
    def do_configure(self, rtsp_media):
        """
        メディアの設定
        """
        print("🔧 メディアを設定中...")
        # reusableを有効にすると、EOSの代わりに自動的にループする
        rtsp_media.set_reusable(True)
        print("✅ メディアを再利用可能に設定（ループ対応）")


class RTSPServer:
    def __init__(self, movie_path):
        print(f"🎬 使用する動画ファイル: {movie_path}")

        # ファイル存在確認
        if not os.path.exists(movie_path):
            print(f"❌ エラー: 動画ファイルが見つかりません: {movie_path}")
            sys.exit(1)

        print("🔧 GStreamerを初期化中...")
        Gst.init(None)
        print("✅ GStreamer初期化完了")

        self.movie_path = movie_path
        print("🔧 RTSPサーバーを作成中...")
        self.server = GstRtspServer.RTSPServer()
        self.server.set_service("8554")
        # 環境変数でホストを制御可能にする（デフォルトは 0.0.0.0）
        # セキュリティ注記: Docker環境ではコンテナ外からのアクセスに0.0.0.0が必要
        rtsp_host = os.getenv('RTSP_HOST', '0.0.0.0')  # nosec B104
        self.server.set_address(rtsp_host)
        print("✅ RTSPサーバー作成完了")

        self.mount_points = self.server.get_mount_points()
        

        # ver 1.0
        # factory.set_launch(f'( filesrc location={self.movie_path} ! qtdemux ! h264parse ! decodebin ! videoconvert ! videoscale ! video/x-raw,width=1280,height=720 ! x264enc tune=zerolatency ! rtph264pay name=pay0 pt=96 )')
        # ver 2.0
        # factory.set_launch(f'( multifilesrc location={self.movie_path} loop=true ! qtdemux ! h264parse ! decodebin ! videoconvert ! videoscale ! video/x-raw,width=1280,height=720 ! x264enc tune=zerolatency bitrate=2000 key-int-max=30 ! rtph264pay name=pay0 pt=96 config-interval=1 )')
        # ver 3.0 カスタムループメディアファクトリを使用
        factory = LoopingMediaFactory(self.movie_path)
        factory.set_shared(True)
        factory.set_eos_shutdown(False)  # EOSでシャットダウンしない
        
        self.mount_points.add_factory("/camera", factory)
        self.server.attach(None)
        try:
            # 外部接続用のIPアドレスを取得
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            ip_address = s.getsockname()[0]
            s.close()
            print(f"\n推奨接続IPアドレス: {ip_address}")
        except:
            ip_address = "127.0.0.1"  # フォールバック
            print(f"\nIPアドレス取得エラー、ローカルホストを使用: {ip_address}")

        print(f"\n✅ RTSPサーバーを起動しました")
        print(f"📡 RTSP URL: rtsp://{ip_address}:8554/camera")
        print(f"🌐 ローカルアクセス: rtsp://localhost:8554/camera")
        print(f"🌐 ローカルアクセス: rtsp://127.0.0.1:8554/camera")

if __name__ == '__main__':
    print("=" * 50)
    print("🎬 RTSPサーバーを起動します")
    print("=" * 50)
    
    movie_path = os.getenv('MOVIE_PATH')
    print(f"📁 MOVIE_PATH: {movie_path}")
    
    # デフォルトの動画パスを設定
    if not movie_path:
        movie_path = '/app/edge/rtsp_camera/Scenes_at_construction_sites.mp4'
        print(f"📁 デフォルト動画パスを使用: {movie_path}")
    
    # S3のURLかどうかチェック
    if movie_path and movie_path.startswith('s3://'):
        print("☁️ S3から動画をダウンロード中...")
        # セキュアな一時ファイルを生成
        import tempfile
        fd, local_movie_path = tempfile.mkstemp(suffix='_downloaded_movie.mp4')
        os.close(fd)
        
        # S3からダウンロード
        downloaded_path = download_from_s3(movie_path, local_movie_path)
        
        if downloaded_path:
            # ダウンロード成功時はローカルパスを使用
            movie_path = downloaded_path
        else:
            print("❌ S3ダウンロードに失敗しました")
            sys.exit(1)
    
    print("🔧 RTSPサーバーを初期化中...")
    s = RTSPServer(movie_path)
    print("🔄 メインループを開始します...")
    loop = GLib.MainLoop()
    loop.run()