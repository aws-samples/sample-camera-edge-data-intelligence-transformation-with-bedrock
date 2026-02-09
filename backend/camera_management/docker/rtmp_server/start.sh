#!/bin/bash

# RTMP/RTMPS Server with KVS Forwarding - Startup Script

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Check for .env file
if [ ! -f ".env" ]; then
    echo "⚠️  .env file not found."
    echo "Creating from .env.example..."
    cp .env.example .env
    echo "Please edit .env with your AWS credentials and stream name."
    exit 1
fi

# Check for TLS certificates
if [ ! -f "certs/server.crt" ] || [ ! -f "certs/server.key" ]; then
    echo "⚠️  TLS certificates not found in certs/"
    read -p "Generate self-signed certificates? (y/n): " generate_certs
    if [ "$generate_certs" = "y" ]; then
        ./generate-certs.sh
    else
        echo "RTMPS will be disabled. Only RTMP will be available."
    fi
fi

# Parse arguments
BUILD_FLAG=""
if [ "$1" = "--build" ]; then
    BUILD_FLAG="--build"
elif [ "$1" = "--build-no-cache" ]; then
    BUILD_FLAG="--build --no-cache"
fi

# Start containers
echo "🚀 Starting RTMP/RTMPS Server with KVS Forwarding..."
docker compose up $BUILD_FLAG
