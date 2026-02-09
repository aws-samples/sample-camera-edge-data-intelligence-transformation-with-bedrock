#!/bin/bash

# 引数解析
# TEST_MODEの時は、local detectorを使用する
BUILD_MODE=""
TEST_MODE=true

# コレクター固有の設定
export CAMERA_ID="87786a5b-5dbb-4f06-a9ca-15d95e337c27"
export COLLECTOR_ID="2e73ba0c-ee14-4d27-bbb1-31e4145be447"

for arg in "$@"; do
    if [[ "$arg" == "--build-no-cache" ]]; then
        BUILD_MODE="--build-no-cache"
    elif [[ "$arg" == "--build" ]]; then
        BUILD_MODE="--build"
    elif [[ "$arg" == "--test" ]]; then
        TEST_MODE=true
    fi
done

# テストモードフラグ（デフォルト: false）
# export DETECTOR_TEST_MODE=true でローカルDetectorを使用
if [[ "$TEST_MODE" == "true" ]]; then
    export DETECTOR_TEST_MODE=true
else
    export DETECTOR_TEST_MODE=${DETECTOR_TEST_MODE:-false}
fi


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
echo "DETECTOR_TEST_MODE: $DETECTOR_TEST_MODE"
if [[ "$TEST_MODE" == "true" ]]; then
    echo "モード: テストモード（ローカルDetector使用）"
    echo "DETECTOR_LOCAL_ENDPOINT: ${DETECTOR_LOCAL_ENDPOINT:-http://host.docker.internal:9000}"
fi
echo "=================="

# オプションに応じた処理
if [[ "$BUILD_MODE" == "--build-no-cache" ]]; then
    echo "Building with no-cache and clean restart..."
    docker compose down --remove-orphans
    docker compose build --no-cache
    docker compose up
elif [[ "$BUILD_MODE" == "--build" ]]; then
    echo "Building with clean restart..."
    docker compose down --remove-orphans
    docker compose up --build
else
    echo "Starting with existing containers..."
    docker compose up
fi


