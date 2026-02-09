#!/bin/bash

# Generate self-signed TLS certificates for RTMPS

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERTS_DIR="$SCRIPT_DIR/certs"

mkdir -p "$CERTS_DIR"

echo "🔐 Generating self-signed TLS certificate..."

openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout "$CERTS_DIR/server.key" \
    -out "$CERTS_DIR/server.crt" \
    -subj "/CN=rtmps-server/O=CEDIX/C=JP" \
    -addext "subjectAltName=DNS:localhost,DNS:rtmps-server,IP:127.0.0.1"

echo "✅ Certificate generated:"
echo "   - $CERTS_DIR/server.crt"
echo "   - $CERTS_DIR/server.key"
echo ""
echo "⚠️  This is a self-signed certificate for development only."
echo "   For production, use a certificate from a trusted CA."
