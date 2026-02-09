#!/bin/bash
# CDK実行用のラッパースクリプト
# 使い方: ./run-cdk.sh list
#        ./run-cdk.sh diff

# スクリプトのディレクトリに移動
cd "$(dirname "$0")"

# cdk.config.json から設定を読み込み
source ./load-config.sh

# AWS アカウントIDを取得
export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)

# 設定確認
echo "=== CDK 環境設定 ==="
echo "Account: $CDK_DEFAULT_ACCOUNT"
echo "Region: $AWS_REGION"
echo "Stack Prefix: $STACK_PREFIX"

echo "Available Stacks:"
echo "  ${STACK_PREFIX}-keys"
echo "  ${STACK_PREFIX}-api-ecr"
echo "  ${STACK_PREFIX}-ingestion-ecr"
echo "  ${STACK_PREFIX}-foundation"
echo "  ${STACK_PREFIX}-application"
echo "  ${STACK_PREFIX}-frontend"
echo "  ${STACK_PREFIX}-bedrock"
echo "  ${STACK_PREFIX}-hlsyolo-ecr"
echo "  ${STACK_PREFIX}-hlsrec-ecr"
echo "  ${STACK_PREFIX}-s3rec-ecr"
echo "  ${STACK_PREFIX}-s3yolo-ecr"
echo "  ${STACK_PREFIX}-rtsp-receiver-ecr"
echo "  ${STACK_PREFIX}-rtsp-movie-ecr"
echo "  ${STACK_PREFIX}-kvs-base-ecr"
echo "  ${STACK_PREFIX}-rtmp-server-ecr"
echo "===================="
echo ""

# CDKコマンドを実行（直接バイナリを使用）
./node_modules/.bin/cdk "$@"

