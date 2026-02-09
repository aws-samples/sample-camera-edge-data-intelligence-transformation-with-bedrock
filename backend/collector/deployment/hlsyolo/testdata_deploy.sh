#!/bin/bash

# HlsYolo CloudFormationデプロイツール（テストデータ用）
# HLS+YOLOトラッキング機能付き画像収集サービスのデプロイスクリプト

set -e


CAMERA_ID="01c80439-b667-415c-b9f6-039def6b293f"
COLLECTOR_ID="98919645-f91c-4674-8d9c-2a18ad38ac73"
export AWS_REGION=ap-northeast-1

# プロジェクトルートを設定
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# PYTHONPATHにbackend/を追加
export PYTHONPATH="$BACKEND_ROOT:$PYTHONPATH"

echo "=================================================="
echo "     HlsYolo CloudFormationデプロイツール      "
echo "=================================================="
echo "カメラID: $CAMERA_ID"
echo "コレクターID: $COLLECTOR_ID"
echo "リージョン: $AWS_REGION"
echo "プロジェクトルート: $BACKEND_ROOT"
echo ""
echo "【機能】"
echo "  - HLSストリームからの画像取得"
echo "  - YOLOv11によるリアルタイム物体検出"
echo "  - エリア侵入/退出検知"
echo "  - 定期画像保存機能"
echo "=================================================="
echo

# プロジェクトルートからモジュール実行
cd "$BACKEND_ROOT"
python -m collector.deployment.hlsyolo.deploy_collector "$CAMERA_ID" "$COLLECTOR_ID"

