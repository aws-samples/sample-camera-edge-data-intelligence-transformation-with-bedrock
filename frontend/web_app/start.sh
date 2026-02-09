#!/bin/bash

# Docker版React開発サーバー起動スクリプト
echo "🐳 Dockerコンテナでの開発モードを開始します..."

# frontendディレクトリに移動
cd "$(dirname "$0")"

# --prod オプションの確認
PROD_MODE=false
for arg in "$@"; do
    if [[ "$arg" == "--prod" ]]; then
        PROD_MODE=true
        break
    fi
done

# cdk.config.json から設定を読み込み
# CDK の情報ロード
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
echo "AWS_REGION: $AWS_REGION"

# CloudFormationから各種設定を取得（Foundation Stackから取得）
API_URL=$(aws cloudformation describe-stacks \
    --stack-name $APPLICATION_STACK \
    --region $AWS_REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' \
    --output text 2>/dev/null)


USER_POOL_ID=$(aws cloudformation describe-stacks \
    --stack-name $FOUNDATION_STACK \
    --region $AWS_REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue' \
    --output text 2>/dev/null)

USER_POOL_CLIENT_ID=$(aws cloudformation describe-stacks \
    --stack-name $FOUNDATION_STACK \
    --region $AWS_REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`UserPoolClientId`].OutputValue' \
    --output text 2>/dev/null)

IDENTITY_POOL_ID=$(aws cloudformation describe-stacks \
    --stack-name $FOUNDATION_STACK \
    --region $AWS_REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`IdentityPoolId`].OutputValue' \
    --output text 2>/dev/null)

# --prod オプションに応じてAPI_URLを選択
if [[ "$PROD_MODE" == "true" ]]; then
    echo "=== Production Mode: Using CloudFormation API URL ==="
    VITE_API_URL=${API_URL}
    VITE_DEPLOY_MODE=production
else
    echo "=== Development Mode: Using localhost ==="
    VITE_API_URL="http://localhost:8000"
    VITE_DEPLOY_MODE=development
fi

echo "API_URL: ${VITE_API_URL}"
echo "DEPLOY_MODE: ${VITE_DEPLOY_MODE}"

# .env.development を生成（Vite用）
cat > .env.development << EOF
VITE_API_URL=${VITE_API_URL}
VITE_USER_POOL_ID=${USER_POOL_ID}
VITE_USER_POOL_CLIENT_ID=${USER_POOL_CLIENT_ID}
VITE_IDENTITY_POOL_ID=${IDENTITY_POOL_ID}
VITE_REGION=${AWS_REGION}
VITE_DEPLOY_MODE=${VITE_DEPLOY_MODE}
EOF

echo "=== 生成された .env.development ==="
cat .env.development
echo "=================================="


echo "Starting API server in development mode with Docker..."

# オプションに応じた処理
# --prodオプションを除外してdocker composeに渡す
BUILD_ARGS=""
for arg in "$@"; do
    case "$arg" in
        --prod)
            # --prodは内部処理用なのでスキップ
            ;;
        --build-no-cache)
            BUILD_ARGS="build-no-cache"
            ;;
        --build)
            BUILD_ARGS="build"
            ;;
    esac
done

if [[ "$BUILD_ARGS" == "build-no-cache" ]]; then
    echo "Building with no-cache and clean restart..."
    docker compose down --remove-orphans
    docker compose build --no-cache
    docker compose up
elif [[ "$BUILD_ARGS" == "build" ]]; then
    echo "Building with clean restart..."
    docker compose down --remove-orphans
    docker compose up --build
else
    echo "Starting with existing containers..."
    docker compose up
fi
