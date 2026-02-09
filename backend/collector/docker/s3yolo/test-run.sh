#!/bin/bash

source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$source_dir"

echo "=== S3Yolo ローカルテスト一連実行 ==="
echo ""

# ビルドオプションを引き継ぐ
BUILD_OPT="$1"

echo "1. コンテナ起動..."
./start.sh $BUILD_OPT

echo ""
echo "2. コンテナが起動するまで待機..."
sleep 10

echo ""
echo "3. テスト実行..."
./test.sh

echo ""
echo "4. コンテナ停止..."
./stop.sh

echo ""
echo "=== 一連のテスト完了 ==="
