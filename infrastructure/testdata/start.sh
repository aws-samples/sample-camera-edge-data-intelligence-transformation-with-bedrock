#!/bin/bash

# DynamoDBサンプルデータ作成スクリプト
# Docker経由でsample_data_create_tagonly.pyを実行

set -e  # エラー時に即座に終了

# 現在のディレクトリを取得
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# デフォルト言語
export LANG="ja"

# 引数の解析
while [[ $# -gt 0 ]]; do
    case $1 in
        --lang)
            export LANG="$2"
            shift 2
            ;;
        --build)
            BUILD_FLAG="--build"
            shift
            ;;
        --build-no-cache)
            BUILD_NO_CACHE_FLAG="true"
            shift
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--lang ja|en] [--build] [--build-no-cache]"
            exit 1
            ;;
    esac
done

# 言語の検証
if [[ "$LANG" != "ja" && "$LANG" != "en" ]]; then
    echo "ERROR: Invalid language '$LANG'. Use 'ja' or 'en'."
    exit 1
fi

echo "=== DynamoDB Sample Data Creation ==="
echo "Language: $LANG"

# cdk.config.jsonから設定を読み込み
CDK_DIR="../cdk"
if [[ -f "$CDK_DIR/load-config.sh" ]]; then
    source "$CDK_DIR/load-config.sh"
else
    echo "ERROR: $CDK_DIR/load-config.sh not found"
    exit 1
fi

echo "取得したAWSリージョン: $AWS_REGION"
echo "スタックプレフィックス: $STACK_PREFIX"

# AWS認証情報を環境変数にエクスポート（一時的な認証情報がある場合）
export AWS_REGION
export STACK_PREFIX

# オプションに応じた処理
if [[ "$BUILD_NO_CACHE_FLAG" == "true" ]]; then
    echo "Building with no-cache..."
    docker compose build --no-cache
    docker compose run --rm testdata
elif [[ -n "$BUILD_FLAG" ]]; then
    echo "Building..."
    docker compose up --build
else
    echo "Running with existing image..."
    docker compose run --rm testdata
fi
