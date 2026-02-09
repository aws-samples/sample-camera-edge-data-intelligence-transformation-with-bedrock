# checkov:skip=CKV_DOCKER_2:Lambda container - HEALTHCHECK is not applicable for serverless functions
FROM public.ecr.aws/lambda/python:3.11

# 依存関係のインストール
COPY requirements.txt ${LAMBDA_TASK_ROOT}/
RUN pip install --no-cache-dir -r requirements.txt

# Lambda関数のコピー
COPY lambda_function.py ${LAMBDA_TASK_ROOT}/
COPY opensearch_client.py ${LAMBDA_TASK_ROOT}/
COPY dynamodb_converter.py ${LAMBDA_TASK_ROOT}/
COPY mapping.json ${LAMBDA_TASK_ROOT}/

# セキュリティ対策: Lambda の非 root ユーザーを使用
USER 1051

# ハンドラー指定
CMD ["lambda_function.handler"]

