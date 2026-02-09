#!/bin/bash

# Lambda関数にテストイベントを送信
echo "Lambda関数にテストイベントを送信中..."

# 共通設定の取得
source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$source_dir"

# CDK の情報ロード
CONFIG_LOADER="../../../../infrastructure/cdk/load-config.sh"
if [[ -f "$CONFIG_LOADER" ]]; then
    source "$CONFIG_LOADER"
    echo "AWS設定:"
    echo "  - AWS_REGION: ${AWS_REGION}"
    echo "  - STACK_PREFIX: ${STACK_PREFIX}"
    echo ""
else
    echo "⚠️  Warning: $CONFIG_LOADER not found"
    echo "   AWS_REGIONを環境変数で設定してください"
    exit 1
fi

# CloudFormationからBUCKET_NAMEを取得
export BUCKET_NAME=$(aws cloudformation describe-stacks \
    --stack-name $FOUNDATION_STACK \
    --region $AWS_REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`CameraBucketName`].OutputValue' \
    --output text 2>/dev/null)

if [[ -z "$BUCKET_NAME" ]]; then
    echo "Warning: BUCKET_NAMEが取得できませんでした。"
    exit 1
fi

# テスト用カメラID
CAMERA_ID="358ff67e-d04f-4d83-adab-1c09c25c0d3f"

echo "=== S3Yolo Lambda テスト ==="
echo "BUCKET_NAME: ${BUCKET_NAME}"
echo "CAMERA_ID: ${CAMERA_ID}"
echo ""

# S3 EventBridge形式のイベントを送信
curl -XPOST "http://localhost:9000/2015-03-31/functions/function/invocations" \
  -H "Content-Type: application/json" \
  -d '{
    "version": "0",
    "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "detail-type": "Object Created",
    "source": "aws.s3",
    "account": "123456789012",
    "time": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "resources": ["arn:aws:s3:::'"${BUCKET_NAME}"'"],
    "detail": {
      "bucket": {
        "name": "'"${BUCKET_NAME}"'"
      },
      "object": {
        "key": "endpoint/'"${CAMERA_ID}"'/test.jpg"
      }
    }
  }'

echo ""
echo "=== テスト完了 ==="
