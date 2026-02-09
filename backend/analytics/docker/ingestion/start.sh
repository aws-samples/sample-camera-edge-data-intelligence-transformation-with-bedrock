#!/bin/bash

# Cedix Ingestion コンテナ起動スクリプト

cd "$(dirname "$0")"

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

echo "=================================================="
echo "  Cedix Ingestion Lambda - Local Test"
echo "=================================================="
echo ""

# 環境変数のチェック
if [ -z "$OPENSEARCH_ENDPOINT" ]; then
    echo "⚠ WARNING: OPENSEARCH_ENDPOINT is not set."
    echo "   Please set it before running tests:"
    echo "   export OPENSEARCH_ENDPOINT=<your-opensearch-endpoint>"
    echo ""
fi

echo "Starting Cedix Ingestion container..."
docker compose up 

if [ $? -eq 0 ]; then
    echo ""
    echo "✓ Container started successfully."
    echo ""
    echo "Available commands:"
    echo "  ./test-run.sh  : Run Lambda function with sample event"
    echo "  ./test.sh      : Run integration tests"
    echo "  ./stop.sh      : Stop the container"
    echo ""
else
    echo ""
    echo "✗ Failed to start container."
    exit 1
fi

