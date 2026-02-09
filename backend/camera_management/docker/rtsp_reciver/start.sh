#!/bin/bash
set -e

cd "$(dirname "$0")"


# ========================================
# 0. 環境変数の設定
# ========================================
export STREAM_NAME="place-00001-entrance-stream"
# export RTSP_URL="rtsp://host.docker.internal:8554/camera"
export RTSP_URL="rtsps://host.docker.internal:8322/stream"
export BUILDER_TAG
export GSTREAMER_LOG_MODE="stdout"  # GStreamerログを標準出力に出力  stdout or null


echo "=========================================="
echo "RTSP Receiver 起動スクリプト (開発環境)"
echo "=========================================="
echo "注: 開発環境用の Dockerfile.dev を使用します"
echo ""

# ========================================
# 1. プラットフォーム自動検出
# ========================================
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ] || [ "$ARCH" = "aarch64" ]; then
    PLATFORM="linux/arm64"
    PLATFORM_TAG="arm64"
    echo "🍎 Apple Silicon (ARM64) を検出しました"
elif [ "$ARCH" = "x86_64" ]; then
    PLATFORM="linux/amd64"
    PLATFORM_TAG="amd64"
    echo "💻 Intel/AMD (x86_64) を検出しました"
else
    echo "❌ サポートされていないアーキテクチャ: $ARCH"
    exit 1
fi

BUILDER_TAG="cedix-rtsp-receiver-builder:v1.0.0"
echo "ビルダータグ: ${BUILDER_TAG}"
echo ""

# ========================================
# 2. ビルダーイメージのチェックとビルド
# ========================================
if ! docker image inspect ${BUILDER_TAG} > /dev/null 2>&1; then
    echo "⚠️  ビルダーイメージが見つかりません"
    echo "   初回ビルドを開始します（15-30分かかります）..."
    echo ""
    
    echo "=========================================="
    echo "KVS Producer SDK をビルド中..."
    echo "=========================================="
    docker build --platform ${PLATFORM} -f Dockerfile.builder -t ${BUILDER_TAG} ../../.. 2>&1 | tee /tmp/docker_build_builder.log
    
    echo ""
    echo "✅ ビルダーイメージのビルド完了"
    echo ""
else
    echo "✅ ビルダーイメージが既に存在します: ${BUILDER_TAG}"
    echo "   キャッシュを使用して高速ビルドします"
    echo ""
fi


# ========================================
# 3. 環境変数表示
# ========================================
echo "環境変数の設定:"
echo "  - STREAM_NAME: ${STREAM_NAME}"
echo "  - RTSP_URL: ${RTSP_URL}"
echo "  - BUILDER_TAG: ${BUILDER_TAG}"
echo "  - GSTREAMER_LOG_MODE: ${GSTREAMER_LOG_MODE}"
echo ""

# ========================================
# 4. CDK設定を読み込み
# ========================================
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

# ========================================
# 5. Docker Composeで起動
# ========================================
echo "=========================================="
echo "Docker Compose で起動中..."
echo "=========================================="
# --buildオプションが指定された場合の処理
# if [[ "$1" == "--build" ]]; then
#     echo "Building with clean restart..."
#     docker compose down --remove-orphans
#     docker compose up --build
# else
#     echo "Starting with existing containers..."
#     docker compose up
# fi

# --buildオプションが指定された場合の処理
if [[ "$1" == "--build" ]]; then
    echo "Building with clean restart..."
    docker compose down --remove-orphans
    docker compose up --build
else
    echo "Starting with existing containers..."
    docker compose up
fi

echo ""
echo "=========================================="
echo "✅ RTSP Receiver 起動完了！"
echo "=========================================="
