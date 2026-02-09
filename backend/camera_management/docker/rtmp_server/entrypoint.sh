#!/bin/bash

# AWS SDKの標準認証チェーンを有効化（ECS Fargate対応）
export AWS_SDK_LOAD_CONFIG=1

# ECS Fargate環境でContainer Credentialsエンドポイントから認証情報を取得
if [ -n "$AWS_CONTAINER_CREDENTIALS_RELATIVE_URI" ]; then
    echo "Running on ECS Fargate, retrieving credentials from container endpoint..."
    
    CREDENTIALS_ENDPOINT="http://169.254.170.2${AWS_CONTAINER_CREDENTIALS_RELATIVE_URI}"
    echo "Credentials endpoint: ${CREDENTIALS_ENDPOINT}"
    
    CREDENTIALS_JSON=$(curl -s "${CREDENTIALS_ENDPOINT}")
    
    if [ $? -eq 0 ] && [ -n "$CREDENTIALS_JSON" ]; then
        echo "✅ Successfully retrieved credentials from ECS endpoint"
        
        # JSONから認証情報を抽出
        export AWS_ACCESS_KEY_ID=$(echo "$CREDENTIALS_JSON" | grep -o '"AccessKeyId":"[^"]*"' | cut -d'"' -f4)
        export AWS_SECRET_ACCESS_KEY=$(echo "$CREDENTIALS_JSON" | grep -o '"SecretAccessKey":"[^"]*"' | cut -d'"' -f4)
        export AWS_SESSION_TOKEN=$(echo "$CREDENTIALS_JSON" | grep -o '"Token":"[^"]*"' | cut -d'"' -f4)
        
        if [ -n "$AWS_ACCESS_KEY_ID" ] && [ -n "$AWS_SECRET_ACCESS_KEY" ] && [ -n "$AWS_SESSION_TOKEN" ]; then
            echo "✅ Credentials successfully exported"
            echo "   AWS_ACCESS_KEY_ID: ${AWS_ACCESS_KEY_ID:0:10}..."
            echo "   AWS_SECRET_ACCESS_KEY: ${AWS_SECRET_ACCESS_KEY:0:10}..."
            echo "   AWS_SESSION_TOKEN: ${AWS_SESSION_TOKEN:0:20}..."
        else
            echo "❌ Failed to parse credentials from JSON"
        fi
    else
        echo "❌ Failed to retrieve credentials from ECS endpoint"
    fi
elif [ -n "$AWS_ACCESS_KEY_ID" ]; then
    echo "Using static credentials from environment variables"
else
    echo "Running locally or using instance role"
fi

# AWS_REGIONが設定されていない場合はデフォルト設定
if [ -z "$AWS_REGION" ]; then
    export AWS_REGION="ap-northeast-1"
fi
export AWS_DEFAULT_REGION="$AWS_REGION"

echo ""
echo "=== RTMP Server Configuration ==="
echo "  STREAM_NAME: $STREAM_NAME"
echo "  AWS_REGION: $AWS_REGION"
echo "  RTMP_PORT: ${RTMP_PORT:-1935}"
echo "  RTMPS_PORT: ${RTMPS_PORT:-1936}"
echo "================================="
echo ""

# メインアプリケーションを起動
exec /app/rtmp-kvs
