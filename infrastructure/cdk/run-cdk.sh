#!/bin/bash
# CDK実行用のラッパースクリプト
# 使い方: ./run-cdk.sh list
#        ./run-cdk.sh diff
#        ./run-cdk.sh deploy --all --require-approval never

set -e  # エラー時に停止

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

# deploy --all の場合、kvs-base-ecr を先にデプロイする必要があるかチェック
if [[ "$1" == "deploy" ]] && [[ "$*" == *"--all"* ]]; then
    # kvs-base-ecr が存在するか確認
    if ! aws ssm get-parameter --name /Cedix/Ecr/KvsBaseImageUri --region "$AWS_REGION" --query Parameter.Value --output text 2>/dev/null | grep -q "ecr"; then
        echo "⚠️  KVS Base イメージが見つかりません"
        echo "   → 先に kvs-base-ecr をデプロイします（初回は30-60分かかります）"
        echo ""
        ./node_modules/.bin/cdk deploy "${STACK_PREFIX}-kvs-base-ecr" "${@:2}"
        echo ""
        echo "✅ kvs-base-ecr のデプロイが完了しました"
        echo ""
    fi
fi

# CDKコマンドを実行（直接バイナリを使用）
./node_modules/.bin/cdk "$@"

