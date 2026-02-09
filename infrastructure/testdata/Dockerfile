FROM python:3.11-slim

WORKDIR /app

# 環境変数を設定
ENV DOCKER_ENV=1

# 非rootユーザーを作成
RUN useradd -m -u 1000 appuser

# 依存関係のインストール
COPY infrastructure/testdata/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# バックエンドの共通モジュールをコピー
COPY backend/shared /app/backend/shared

# スクリプトをコピー
COPY infrastructure/testdata/sample_data_create_tagonly.py .

# 非rootユーザーに切り替え
USER appuser

ENTRYPOINT ["python", "sample_data_create_tagonly.py"]
