FROM python:3.11-slim

# 必要なパッケージのインストール（FFmpeg + OpenCV用ライブラリ + procps）
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libavcodec-extra \
    libavformat-dev \
    libavutil-dev \
    libswscale-dev \
    libgl1 \
    libglib2.0-0 \
    procps \
    && rm -rf /var/lib/apt/lists/*

# 作業ディレクトリの作成
WORKDIR /app

# 共通モジュールをコピー
COPY shared/ ./shared/

# 必要なPythonパッケージのインストール
COPY collector/docker/hlsyolo/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# YOLOv9 MIT版をGitHubから直接インストール
RUN apt-get update && apt-get install -y git && \
    git clone https://github.com/WongKinYiu/YOLO.git /tmp/yolo && \
    cd /tmp/yolo && \
    pip install --no-cache-dir . && \
    cd /app && \
    rm -rf /tmp/yolo && \
    apt-get remove -y git && \
    apt-get autoremove -y && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# アプリケーションコードをコピー
# NOTE: YOLOv9設定ファイルは shared/yolo_detector/yolo/config に含まれる
COPY collector/docker/hlsyolo/hlsyolo.py .
COPY collector/docker/hlsyolo/run_hlsyolo.sh .

# シェルスクリプトに実行権限を付与
RUN chmod +x run_hlsyolo.sh

# セキュリティ対策: 非 root ユーザーの作成と使用
RUN groupadd -r appuser && useradd --no-log-init -r -g appuser appuser \
    && chown -R appuser:appuser /app \
    && mkdir -p /home/appuser/.cache \
    && chown -R appuser:appuser /home/appuser

# 環境変数の設定
ENV PYTHONPATH=/app
ENV YOLO_VERBOSE=False
ENV HOME=/home/appuser

USER appuser

# ヘルスチェック: hlsyolo.pyプロセスが動作していることを確認
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD ps aux | grep -v grep | grep "hlsyolo.py" || exit 1

# シェルスクリプトを実行
CMD ["./run_hlsyolo.sh"] 