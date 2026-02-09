#!/bin/bash

# CDK Webapp デプロイスクリプト
# Webapp専用のCDKアプリを実行

cd "$(dirname "$0")"

# cdk.config.json から設定を読み込み
source ./load-config.sh

# AWS アカウントIDを取得
export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)

echo "=== CDK Webapp 環境設定 ==="
echo "Account: $CDK_DEFAULT_ACCOUNT"
echo "Region: $AWS_REGION"
echo "Stack Prefix: $STACK_PREFIX"
echo "============================"
echo ""

# SSM Parameter から値を取得
echo "🔍 SSM Parameter を取得中..."

export SSM_API_URL=$(aws ssm get-parameter --name "/Cedix/Main/ApiUrl" --query "Parameter.Value" --output text --region $AWS_REGION 2>/dev/null || echo "")
export SSM_USER_POOL_ID=$(aws ssm get-parameter --name "/Cedix/Main/UserPoolId" --query "Parameter.Value" --output text --region $AWS_REGION 2>/dev/null || echo "")
export SSM_USER_POOL_CLIENT_ID=$(aws ssm get-parameter --name "/Cedix/Main/UserPoolClientId" --query "Parameter.Value" --output text --region $AWS_REGION 2>/dev/null || echo "")
export SSM_IDENTITY_POOL_ID=$(aws ssm get-parameter --name "/Cedix/Main/IdentityPoolId" --query "Parameter.Value" --output text --region $AWS_REGION 2>/dev/null || echo "")
export SSM_WEB_APP_BUCKET_NAME=$(aws ssm get-parameter --name "/Cedix/Main/WebAppBucketName" --query "Parameter.Value" --output text --region $AWS_REGION 2>/dev/null || echo "")
export SSM_DISTRIBUTION_ID=$(aws ssm get-parameter --name "/Cedix/Main/CloudFrontDistributionId" --query "Parameter.Value" --output text --region $AWS_REGION 2>/dev/null || echo "")

# 必須パラメータのチェック
if [ -z "$SSM_API_URL" ] || [ -z "$SSM_WEB_APP_BUCKET_NAME" ] || [ -z "$SSM_DISTRIBUTION_ID" ]; then
    echo "❌ エラー: 必須の SSM Parameter が見つかりません"
    echo "   先に ./run-cdk.sh deploy --all を実行してください"
    exit 1
fi

echo "✅ SSM Parameter 取得完了"
echo "   API_URL: $SSM_API_URL"
echo "   USER_POOL_ID: $SSM_USER_POOL_ID"
echo "   WEB_APP_BUCKET_NAME: $SSM_WEB_APP_BUCKET_NAME"
echo "   DISTRIBUTION_ID: $SSM_DISTRIBUTION_ID"
echo ""

# Webapp専用のCDKアプリを実行
./node_modules/.bin/cdk -a 'npx ts-node --prefer-ts-exts bin/cdk-webapp.ts' "$@"
CDK_EXIT_CODE=$?

# デプロイ成功時にCloudFront URLを表示
if [ $CDK_EXIT_CODE -eq 0 ] && [[ "$*" == *"deploy"* ]]; then
    echo ""
    echo "🌐 CloudFront URL を取得中..."
    CLOUDFRONT_DOMAIN=$(aws cloudfront get-distribution --id "$SSM_DISTRIBUTION_ID" --query "Distribution.DomainName" --output text --region $AWS_REGION 2>/dev/null)
    
    if [ -n "$CLOUDFRONT_DOMAIN" ]; then
        echo ""
        echo "=========================================="
        echo "✅ デプロイ完了！"
        echo ""
        echo "🔗 CloudFront URL:"
        echo "   https://${CLOUDFRONT_DOMAIN}"
        echo "=========================================="
    fi
fi

exit $CDK_EXIT_CODE

