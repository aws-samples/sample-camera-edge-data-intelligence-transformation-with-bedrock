FROM python:3.11-slim

# 必要なパッケージのインストール（FFmpegライブラリ + procps）
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libavcodec-extra \
    libavformat-dev \
    libavutil-dev \
    libswscale-dev \
    procps \
    && rm -rf /var/lib/apt/lists/*

# 作業ディレクトリの作成
WORKDIR /app

# 共通モジュールをコピー
COPY shared/ ./shared/

# 必要なPythonパッケージのインストール
COPY collector/docker/hlsrec/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# アプリケーションコードをコピー
COPY collector/docker/hlsrec/hlsrec.py .
COPY collector/docker/hlsrec/run_hlsrec.sh .

# シェルスクリプトに実行権限を付与
RUN chmod +x run_hlsrec.sh

# セキュリティ対策: 非 root ユーザーの作成と使用
RUN groupadd -r appuser && useradd --no-log-init -r -g appuser appuser \
    && chown -R appuser:appuser /app \
    && mkdir -p /home/appuser/.cache \
    && chown -R appuser:appuser /home/appuser

# 環境変数の設定
ENV CAPTURE_INTERVAL=5
ENV CAPTURE_DURATION=0
ENV PYTHONPATH=/app
ENV HOME=/home/appuser

USER appuser

# ヘルスチェック: hlsrec.pyプロセスが動作していることを確認
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD ps aux | grep -v grep | grep "hlsrec.py" || exit 1

# シェルスクリプトを実行
CMD ["./run_hlsrec.sh"] 