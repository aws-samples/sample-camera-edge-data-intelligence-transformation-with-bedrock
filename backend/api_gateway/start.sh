#!/bin/bash

# 固定値の設定
export AUTH_MODE="middleware"
export DEPLOY_MODE="production"

# リソースデプロイ制御（開発環境ではすべてoff）
export CAMERA_RESOURCE_DEPLOY="on"
export COLLECTION_RESOURCE_DEPLOY="off"
export DETECTOR_RESOURCE_DEPLOY="on"

# 共通設定の取得
source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$source_dir"

echo "=== CEDIX Integrated API Gateway Development Environment ==="

# cdk.config.json から設定を読み込み
CONFIG_LOADER="../../infrastructure/cdk/load-config.sh"
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

echo "=== CloudFormationから設定を取得中 ==="
echo "STACK_PREFIX: $STACK_PREFIX"
echo "FOUNDATION_STACK: $FOUNDATION_STACK"
echo "APPLICATION_STACK: $APPLICATION_STACK"
echo "FRONTEND_STACK: $FRONTEND_STACK"
echo "AWS_REGION: $AWS_REGION"

# CloudFormationから各種設定を取得（各スタックから取得）
export COGNITO_USER_POOL_ID=$(aws cloudformation describe-stacks \
    --stack-name $FOUNDATION_STACK \
    --region $AWS_REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue' \
    --output text 2>/dev/null)

export COGNITO_CLIENT_ID=$(aws cloudformation describe-stacks \
    --stack-name $FOUNDATION_STACK \
    --region $AWS_REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`UserPoolClientId`].OutputValue' \
    --output text 2>/dev/null)

export CLOUDFRONT_DOMAIN=$(aws cloudformation describe-stacks \
    --stack-name $FRONTEND_STACK \
    --region $AWS_REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`CloudFrontDistributionDomainName`].OutputValue' \
    --output text 2>/dev/null)

export CLOUDFRONT_KEY_PAIR_ID=$(aws cloudformation describe-stacks \
    --stack-name $FRONTEND_STACK \
    --region $AWS_REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`CloudFrontKeyPairId`].OutputValue' \
    --output text 2>/dev/null)


export CLOUDFRONT_SECRET_NAME=$(aws cloudformation describe-stacks \
    --stack-name $KEY_STACK \
    --region $AWS_REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`SecretName`].OutputValue' \
    --output text 2>/dev/null)

export BUCKET_NAME=$(aws cloudformation describe-stacks \
    --stack-name $FOUNDATION_STACK \
    --region $AWS_REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`CameraBucketName`].OutputValue' \
    --output text 2>/dev/null)

export AOSS_COLLECTION_ENDPOINT=$(aws cloudformation describe-stacks \
    --stack-name $APPLICATION_STACK \
    --region $AWS_REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`AossCollectionEndpoint`].OutputValue' \
    --output text 2>/dev/null)



# フォールバック値の設定をエラー終了に変更
if [[ -z "$COGNITO_USER_POOL_ID" ]]; then
    echo "ERROR: COGNITO_USER_POOL_IDが取得できませんでした。"
    echo "CloudFormationスタックが正しくデプロイされているか確認してください。"
    exit 1
fi

if [[ -z "$COGNITO_CLIENT_ID" ]]; then
    echo "ERROR: COGNITO_CLIENT_IDが取得できませんでした。"
    echo "CloudFormationスタックが正しくデプロイされているか確認してください。"
    exit 1
fi

if [[ -z "$CLOUDFRONT_DOMAIN" ]]; then
    echo "ERROR: CLOUDFRONT_DOMAINが取得できませんでした。"
    echo "CloudFormationスタックが正しくデプロイされているか確認してください。"
    exit 1
fi

if [[ -z "$CLOUDFRONT_KEY_PAIR_ID" ]]; then
    echo "ERROR: CLOUDFRONT_KEY_PAIR_IDが取得できませんでした。"
    echo "CloudFormationスタックが正しくデプロイされているか確認してください。"
    exit 1
fi

if [[ -z "$CLOUDFRONT_SECRET_NAME" ]]; then
    echo "ERROR: CLOUDFRONT_SECRET_NAMEが取得できませんでした。"
    echo "CloudFormationスタックが正しくデプロイされているか確認してください。"
    exit 1
fi

if [[ -z "$BUCKET_NAME" ]]; then
    echo "ERROR: BUCKET_NAMEが取得できませんでした。"
    echo "CloudFormationスタックが正しくデプロイされているか確認してください。"
    exit 1
fi

if [[ -z "$AOSS_COLLECTION_ENDPOINT" ]]; then
    echo "ERROR: AOSS_COLLECTION_ENDPOINTが取得できませんでした。"
    echo "CloudFormationスタックが正しくデプロイされているか確認してください。"
    exit 1
fi

echo "=== 設定情報 ==="
echo "AWS_STACK_NAME: $AWS_STACK_NAME"
echo "COGNITO_USER_POOL_ID: $COGNITO_USER_POOL_ID"
echo "COGNITO_CLIENT_ID: $COGNITO_CLIENT_ID"
echo "COGNITO_REGION: $COGNITO_REGION"
echo "AUTH_MODE: $AUTH_MODE"
echo "DEPLOY_MODE: $DEPLOY_MODE"
echo "CAMERA_RESOURCE_DEPLOY: $CAMERA_RESOURCE_DEPLOY"
echo "COLLECTION_RESOURCE_DEPLOY: $COLLECTION_RESOURCE_DEPLOY"
echo "DETECTOR_RESOURCE_DEPLOY: $DETECTOR_RESOURCE_DEPLOY"
echo "AWS_DEFAULT_REGION: $AWS_DEFAULT_REGION"
echo "CLOUDFRONT_DOMAIN: $CLOUDFRONT_DOMAIN"
echo "CLOUDFRONT_KEY_PAIR_ID: $CLOUDFRONT_KEY_PAIR_ID"
echo "CLOUDFRONT_SECRET_NAME: $CLOUDFRONT_SECRET_NAME"
echo "BUCKET_NAME: $BUCKET_NAME"
echo "AOSS_COLLECTION_ENDPOINT: $AOSS_COLLECTION_ENDPOINT"
echo "=================="

echo "Starting API server in development mode with Docker..."



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
