FROM ubuntu:24.04

# 環境変数設定（非対話モード）
ENV DEBIAN_FRONTEND=noninteractive

# システムアップデート
RUN apt-get update && apt-get upgrade -y

# 基本開発パッケージのインストール
RUN apt-get install -y python3 python3-pip python3-venv python3-dev gcc g++ make cmake

# GStreamer基本パッケージのインストール
RUN apt-get install -y gstreamer1.0-tools gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly gstreamer1.0-libav

# GStreamer開発パッケージのインストール
RUN apt-get install -y libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev

# RTSPサーバー用パッケージのインストール
RUN apt-get install -y gstreamer1.0-rtsp libgstrtspserver-1.0-dev

# H.264エンコーダーをインストール
RUN apt-get install -y gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly

# Python開発用パッケージのインストール（Ubuntu 24.04ではgirepository-2.0が必要）
RUN apt-get install -y libgirepository-2.0-dev gir1.2-girepository-2.0 gir1.2-gstreamer-1.0 gir1.2-gst-rtsp-server-1.0 libcairo2-dev pkg-config

# キャッシュクリーンアップ
RUN apt-get clean && rm -rf /var/lib/apt/lists/*

# 作業ディレクトリを設定
WORKDIR /app
RUN mkdir -p /app/videos

# Python仮想環境を作成
RUN python3 -m venv /app/venv
ENV PATH="/app/venv/bin:$PATH"

# Python依存関係をインストール
COPY test_movie/docker/requirements.txt /tmp/requirements.txt
RUN pip install --upgrade pip && pip install -r /tmp/requirements.txt

# movieRtsp.pyをコピー
COPY test_movie/docker/movieRtsp.py /app/movieRtsp.py

# セキュリティ対策: 非 root ユーザーの作成と使用
RUN groupadd -r rtspuser && useradd --no-log-init -r -g rtspuser rtspuser \
    && chown -R rtspuser:rtspuser /app

# 環境変数設定
ENV GST_PLUGIN_PATH=/usr/lib/x86_64-linux-gnu/gstreamer-1.0
ENV PYTHONUNBUFFERED=1

# RTSPサーバーポートを明示的に宣言
EXPOSE 8554

USER rtspuser

# ヘルスチェック: movieRtsp.pyプロセスが動作していることを確認
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD ps aux | grep -v grep | grep "movieRtsp.py" || exit 1

ENTRYPOINT ["/app/venv/bin/python3", "-u", "/app/movieRtsp.py"]
