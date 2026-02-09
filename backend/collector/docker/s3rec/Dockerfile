# AWS Lambda Python Runtime
# checkov:skip=CKV_DOCKER_2:Lambda container - HEALTHCHECK is not applicable for serverless functions
FROM public.ecr.aws/lambda/python:3.11

# 作業ディレクトリを設定
WORKDIR ${LAMBDA_TASK_ROOT}

# 共通モジュールをコピー
COPY shared/ ./shared/

# s3rec固有のファイルをコピー
COPY collector/docker/s3rec/requirements.txt ./
COPY collector/docker/s3rec/s3rec.py ./

# 依存関係をインストール
RUN pip install -r requirements.txt

# セキュリティ対策: Lambda の非 root ユーザーを使用
USER 1051

# Lambda関数ハンドラーを指定
CMD ["s3rec.lambda_handler"] 