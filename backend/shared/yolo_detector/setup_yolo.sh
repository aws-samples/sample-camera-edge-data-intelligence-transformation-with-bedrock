#!/bin/bash
# =============================================================================
# YOLOv9 MIT 設定ファイルセットアップスクリプト
# =============================================================================
#
# このスクリプトは YOLOv9 MIT リポジトリから設定ファイルをダウンロードし、
# backend/shared/yolo_detector/yolo/config/ に配置します。
#
# 使用方法:
#   cd backend/shared/yolo_detector
#   ./setup_yolo.sh
#
# 前提条件:
#   - git がインストールされていること
#
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
YOLO_CONFIG_DIR="${SCRIPT_DIR}/yolo/config"
TEMP_DIR=$(mktemp -d)
YOLO_REPO="https://github.com/WongKinYiu/YOLO.git"

echo "=== YOLOv9 MIT 設定ファイルセットアップ ==="
echo ""

# クリーンアップ関数
cleanup() {
    if [ -d "${TEMP_DIR}" ]; then
        echo "一時ファイルをクリーンアップしています..."
        rm -rf "${TEMP_DIR}"
    fi
}
trap cleanup EXIT

# git コマンドの確認
if ! command -v git &> /dev/null; then
    echo "エラー: git がインストールされていません。"
    echo "git をインストールしてから再実行してください。"
    exit 1
fi

# 1. YOLOv9 MITリポジトリをクローン
echo "[1/3] YOLOv9 MITリポジトリをクローンしています..."
echo "      リポジトリ: ${YOLO_REPO}"
git clone --depth 1 --quiet "${YOLO_REPO}" "${TEMP_DIR}/yolo"
echo "      完了"

# 2. 設定ディレクトリを作成
echo "[2/3] 設定ディレクトリを準備しています..."
mkdir -p "${YOLO_CONFIG_DIR}/model"
mkdir -p "${YOLO_CONFIG_DIR}/dataset"
echo "      完了"

# 3. 設定ファイルをコピー
echo "[3/3] 設定ファイルをコピーしています..."

# モデル設定ファイル
if [ -d "${TEMP_DIR}/yolo/yolo/config/model" ]; then
    cp -r "${TEMP_DIR}/yolo/yolo/config/model/"*.yaml "${YOLO_CONFIG_DIR}/model/" 2>/dev/null || true
    echo "      - モデル設定ファイルをコピーしました"
else
    echo "      警告: モデル設定ディレクトリが見つかりません"
fi

# データセット設定ファイル
if [ -d "${TEMP_DIR}/yolo/yolo/config/dataset" ]; then
    cp -r "${TEMP_DIR}/yolo/yolo/config/dataset/"*.yaml "${YOLO_CONFIG_DIR}/dataset/" 2>/dev/null || true
    echo "      - データセット設定ファイルをコピーしました"
else
    echo "      警告: データセット設定ディレクトリが見つかりません"
fi

echo ""
echo "=== セットアップ完了 ==="
echo ""
echo "設定ファイルは以下に配置されました:"
echo "  ${YOLO_CONFIG_DIR}/model/"
echo "  ${YOLO_CONFIG_DIR}/dataset/"
echo ""
echo "コピーされたファイル:"
echo ""
echo "[モデル設定]"
ls -1 "${YOLO_CONFIG_DIR}/model/" 2>/dev/null || echo "  (ファイルなし)"
echo ""
echo "[データセット設定]"
ls -1 "${YOLO_CONFIG_DIR}/dataset/" 2>/dev/null || echo "  (ファイルなし)"
echo ""
echo "セットアップが正常に完了しました。"
