# CDK用Dockerfile（Multi-stage build + キャッシュ最適化）
# Builder stageは初回のみビルド、2回目以降はキャッシュを使用

# ========================================
# Builder Stage - KVS Producer SDKビルド
# ========================================
FROM debian:12-slim AS builder

WORKDIR /app

# ビルドに必要なパッケージをインストール
# レイヤーキャッシュを最大化するため、apt-get installを分離
RUN apt-get update && \
    apt-get install -y \
    build-essential \
    cmake \
    git \
    gstreamer1.0-plugins-base-apps \
    libgstreamer1.0-dev \
    libgstreamer-plugins-base1.0-dev \
    m4 \
    curl && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# KVS Producer SDK C++ v3.3.0をクローン
# バージョンが固定なので、このレイヤーはほぼ永続的にキャッシュされる
RUN git clone --recursive https://github.com/awslabs/amazon-kinesis-video-streams-producer-sdk-cpp.git -b v3.3.0 /app/producer

# ビルド
# このレイヤーも、前のレイヤーが変わらない限りキャッシュされる
RUN mkdir -p /app/producer/build
WORKDIR /app/producer/build
RUN cmake -DBUILD_GSTREAMER_PLUGIN=ON ..
RUN make -j$(nproc)

RUN echo "✅ KVS Producer SDK C++ v3.3.0 ビルド完了"

# ========================================
# Runtime Stage - 実行環境
# ========================================
FROM debian:12-slim

WORKDIR /app

# ランタイムに必要なパッケージのみインストール
RUN apt-get update && \
    apt-get install -y \
    gstreamer1.0-libav \
    gstreamer1.0-plugins-bad \
    gstreamer1.0-plugins-good \
    gstreamer1.0-plugins-ugly \
    gstreamer1.0-tools \
    libgstreamer-plugins-base1.0-dev \
    curl \
    procps && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# ビルド済みのKVS Producer SDKをコピー
COPY --from=builder /app/producer /app/producer

# entrypointをコピー（このファイルが変更されても、Builder stageは再利用される）
COPY camera_management/docker/rtsp_reciver/entrypoint.sh /app/producer/build/entrypoint.sh
RUN chmod +x /app/producer/build/entrypoint.sh

# セキュリティ対策: 非 root ユーザーの作成と使用
RUN groupadd -r kvs && useradd --no-log-init -r -g kvs kvs \
    && chown -R kvs:kvs /app/producer

WORKDIR /app/producer/build
ENV LD_LIBRARY_PATH=/app/producer/open-source/local/lib
ENV GST_PLUGIN_PATH=/app/producer/build

USER kvs

# ヘルスチェック: entrypoint.shプロセスが動作していることを確認
# GStreamerパイプラインの再起動待ち中でもentrypoint.sh自体は生きているため、ヘルスチェックは成功する
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD ps aux | grep -v grep | grep "entrypoint.sh" || exit 1

ENTRYPOINT ["/app/producer/build/entrypoint.sh"]

