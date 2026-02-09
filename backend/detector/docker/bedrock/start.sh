#!/bin/bash

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

echo ""
echo "テストするには以下のコマンドを実行してください："
echo "  ./start.sh"
echo ""
echo "または手動でcurlを実行："
echo '  curl -XPOST "http://localhost:9000/2015-03-31/functions/function/invocations" \'
echo '    -H "Content-Type: application/json" \'
echo '    -d '"'"'{"test": "event"}'"'"''
echo ""
echo "ログを確認するには："
echo "  docker compose logs -f"
echo ""
echo "停止するには："
echo "  docker compose down" 

echo "--------------------------------"
echo "テスト開始"
echo "--------------------------------"

# sleep 10



# docker compose down 


