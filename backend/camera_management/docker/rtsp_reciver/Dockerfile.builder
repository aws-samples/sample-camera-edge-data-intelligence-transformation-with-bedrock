# KVS Producer SDK C++ ビルド専用Dockerfile
# 1回だけビルドして cedix-rtsp-receiver-builder:v1.0.0 として保存
# checkov:skip=CKV_DOCKER_2:Build-only container - produces artifacts then exits
# checkov:skip=CKV_DOCKER_3:Build-only container - runs as root for package installation
FROM debian:12-slim

WORKDIR /app

# ビルドに必要なパッケージをインストール
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
RUN git clone --recursive https://github.com/awslabs/amazon-kinesis-video-streams-producer-sdk-cpp.git -b v3.3.0 /app/producer

# ビルド
RUN mkdir -p /app/producer/build
WORKDIR /app/producer/build
RUN cmake -DBUILD_GSTREAMER_PLUGIN=ON ..
RUN make -j$(nproc)

# ビルド完了
RUN echo "KVS Producer SDK C++ v3.3.0 ビルド完了 (Debian 12 Bookworm)"
