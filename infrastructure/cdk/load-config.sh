#!/bin/bash
# CDK設定を読み込むヘルパースクリプト
# 使い方: source /path/to/load-config.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/cdk.config.json"

if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "ERROR: $CONFIG_FILE not found"
    echo "Please copy from template: cp cdk.config.json.template cdk.config.json"
    exit 1
fi

# jqが利用可能かチェック
if ! command -v jq &> /dev/null; then
    echo "ERROR: jq is not installed. Please install jq to parse JSON config."
    echo "  macOS: brew install jq"
    echo "  Ubuntu: sudo apt-get install jq"
    exit 1
fi

# JSONから値を取得
export STACK_PREFIX=$(cat "$CONFIG_FILE" | jq -r '.stackPrefix')
export AWS_REGION=$(cat "$CONFIG_FILE" | jq -r '.region')
export AWS_DEFAULT_REGION="$AWS_REGION"
export CDK_DEFAULT_REGION="$AWS_REGION"
export COGNITO_REGION="$AWS_REGION"

# CDKスタック名を定義
FOUNDATION_STACK="${STACK_PREFIX}-foundation"
APPLICATION_STACK="${STACK_PREFIX}-application"
FRONTEND_STACK="${STACK_PREFIX}-frontend"
KEY_STACK="${STACK_PREFIX}-keys"

export AWS_STACK_NAME=$STACK_PREFIX

# デバッグ出力（オプション）
if [[ "${CDK_CONFIG_DEBUG}" == "true" ]]; then
    echo "=== CDK Config Loaded ==="
    echo "STACK_PREFIX: $STACK_PREFIX"
    echo "AWS_REGION: $AWS_REGION"
    echo "========================="
fi

