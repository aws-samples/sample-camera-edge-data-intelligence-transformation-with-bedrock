# checkov:skip=CKV_DOCKER_2:Lambda container - HEALTHCHECK is not applicable for serverless functions
FROM public.ecr.aws/lambda/python:3.11

# 作業ディレクトリの設定
WORKDIR ${LAMBDA_TASK_ROOT}

# 依存関係のインストール
COPY detector/docker/bedrock/requirements.txt .
RUN pip install -r requirements.txt

# 共通モジュールをコピー
COPY shared/ ./shared/

# アプリケーションファイルをコピー
COPY detector/docker/bedrock/bedrock.py .

# 環境変数の設定
ENV PYTHONPATH="${LAMBDA_TASK_ROOT}:${PYTHONPATH}"

# セキュリティ対策: Lambda の非 root ユーザーを使用
USER 1051

# Lambda関数のハンドラーを指定
CMD ["bedrock.lambda_handler"] 