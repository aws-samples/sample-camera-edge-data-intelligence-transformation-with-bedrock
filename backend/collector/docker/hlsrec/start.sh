#!/bin/bash

# コレクター固有の設定
export CAMERA_ID="01c80439-b667-415c-b9f6-039def6b293f"
export COLLECTOR_ID="3d6d0dfb-bdb3-4fc8-a4b9-82f586db1179"

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
    echo "Warning: BUCKET_NAMEが取得できませんでした。デフォルト値を使用します。"
    exit 1
fi


echo "=== 設定情報 ==="
echo "AWS_REGION: $AWS_REGION"
echo "STACK_NAME: $FOUNDATION_STACK"
echo "BUCKET_NAME: $BUCKET_NAME"
echo "CAMERA_ID: $CAMERA_ID"
echo "COLLECTOR_ID: $COLLECTOR_ID"
echo "=================="

# オプションに応じた処理
if [[ "$1" == "--build-no-cache" ]]; then
    echo "Building with no-cache and clean restart..."
    docker compose down --remove-orphans
    docker compose build --no-cache
    docker compose up
elif [[ "$1" == "--build" ]]; then
    echo "Building with clean restart..."
    docker compose down --remove-orphans
    docker compose up --build
else
    echo "Starting with existing containers..."
    docker compose up
fi


