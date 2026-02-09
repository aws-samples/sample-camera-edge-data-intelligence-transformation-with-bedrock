#!/bin/bash


set -e


CAMERA_ID="cam-001"
COLLECTOR_ID="98919645-f91c-4674-8d9c-2a18ad38ac73"
export AWS_REGION=ap-northeast-1

# プロジェクトルートを設定
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# PYTHONPATHにbackend/を追加
export PYTHONPATH="$BACKEND_ROOT:$PYTHONPATH"

echo "=================================================="
echo "       HlsRec CloudFormationデプロイツール        "
echo "=================================================="
echo "カメラID: $CAMERA_ID"
echo "コレクターID: $COLLECTOR_ID"
echo "リージョン: $AWS_REGION"
echo "プロジェクトルート: $BACKEND_ROOT"
echo "=================================================="
echo

# プロジェクトルートからモジュール実行
cd "$BACKEND_ROOT"
python -m collector.deployment.hlsrec.deploy_collector "$CAMERA_ID" "$COLLECTOR_ID"
