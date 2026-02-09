# ============================================
# RTMP/RTMPS to KVS Server (gortmplib + GStreamer)
# ============================================
# Uses pre-built kvs-base image for fast builds (~2-3 min instead of 30-60 min)

# Build argument for base image (set by CDK)
ARG KVS_BASE_IMAGE

# Stage 1: Build Go application
FROM golang:1.24-bookworm AS go-builder

# Use direct for faster downloads
ENV GOPROXY=direct

WORKDIR /app

# Copy go.mod and go.sum first for caching
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build the application
RUN CGO_ENABLED=0 GOOS=linux go build -o rtmp-kvs .

# Stage 2: Runtime (from kvs-base)
# checkov:skip=CKV_DOCKER_7:KVS_BASE_IMAGE is set by CDK with hash-based tag, never :latest
FROM ${KVS_BASE_IMAGE}

# Switch to root temporarily for file operations
# (kvs-base now sets USER appuser by default)
USER root

WORKDIR /app

# Copy Go binary
COPY --from=go-builder /app/rtmp-kvs /app/rtmp-kvs

# Copy entrypoint script
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh && \
    chown -R appuser:appuser /app

# Environment is already set in kvs-base:
# ENV GST_PLUGIN_PATH=/app/producer/build
# ENV LD_LIBRARY_PATH=/app/producer/lib:/app/producer/build

# Switch to non-root user
USER appuser

# Expose ports
EXPOSE 1935 1936

# Health check for container orchestration
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD nc -z localhost 1935 || exit 1

# Run the server via entrypoint
ENTRYPOINT ["/app/entrypoint.sh"]
