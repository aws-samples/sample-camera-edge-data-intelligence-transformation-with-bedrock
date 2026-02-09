#!/bin/bash
# S3Yolo テストデプロイスクリプト

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# テスト用パラメータ
CAMERA_ID="${1:-test-camera}"
COLLECTOR_ID="${2:-$(uuidgen | tr '[:upper:]' '[:lower:]')}"
SOURCE_BUCKET="${3:-test-source-bucket}"

echo "=== S3Yolo テストデプロイ ==="
echo "カメラID: $CAMERA_ID"
echo "コレクターID: $COLLECTOR_ID"
echo "ソースバケット: $SOURCE_BUCKET"
echo ""

# PYTHONPATHを設定してデプロイスクリプトを実行
export PYTHONPATH="${SCRIPT_DIR}/../../../:${PYTHONPATH}"
python3 "${SCRIPT_DIR}/deploy_collector.py" "$CAMERA_ID" "$COLLECTOR_ID" "$SOURCE_BUCKET"
