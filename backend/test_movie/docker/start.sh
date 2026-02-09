#!/bin/bash

set -e

cd "$(dirname "$0")"

echo "🎬 MP4ファイル → KVSストリーム送信ツール"
echo "============================================"

# デフォルト値
MOVIE_PATH="video.mp4"

# ========================================
# CDK設定を読み込み
# ========================================
CONFIG_LOADER="../../../infrastructure/cdk/load-config.sh"
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

# ファイル存在確認
if [ ! -f "videos/$MOVIE_PATH" ]; then
    echo "❌ エラー: videos/$MOVIE_PATH が見つかりません"
    echo ""
    echo "📁 利用可能なファイル:"
    if [ -d "videos" ] && [ "$(ls -A videos 2>/dev/null)" ]; then
        ls -la videos/
    else
        echo "   videos/ フォルダが空です"
        echo ""
        echo "💡 サンプル動画を生成しますか？"
        read -p "ffmpegでテスト動画を作成 [y/N]: " CREATE_SAMPLE
        if [ "$CREATE_SAMPLE" = "y" ] || [ "$CREATE_SAMPLE" = "Y" ]; then
            mkdir -p videos
            echo "🔄 テスト動画を生成中..."
            ffmpeg -f lavfi -i testsrc=duration=10:size=640x480:rate=25 \
                -c:v libx264 -preset fast -crf 23 \
                videos/sample.mp4 -y > /dev/null 2>&1
            echo "✅ videos/sample.mp4 を生成しました"
            MOVIE_PATH="sample.mp4"
        else
            exit 1
        fi
    fi
fi

# .envファイル確認
if [ ! -f ".env" ]; then
    echo "❌ エラー: .env ファイルが見つかりません"
    echo ""
    echo "📝 .env ファイルの作成例:"
    echo "AWS_ACCESS_KEY_ID=your_access_key_here"
    echo "AWS_SECRET_ACCESS_KEY=your_secret_access_key_here"
    exit 1
fi

# 設定表示
echo ""
echo "📋 実行設定:"
echo "   MP4 File: videos/$MOVIE_PATH"
echo "   Size: $(du -h videos/$MOVIE_PATH | cut -f1)"
echo ""

# 環境変数設定
export MOVIE_PATH="/app/videos/$MOVIE_PATH"

echo "🔧 環境変数設定:"
echo "   MOVIE_PATH=$MOVIE_PATH"

export MOVIE_PATH=$MOVIE_PATH

# --buildオプションが指定された場合の処理
if [[ "$1" == "--build" ]]; then
    echo "Building with clean restart..."
    docker compose down --remove-orphans
    docker compose up --build
else
    echo "Starting with existing containers..."
    docker compose up
fi
