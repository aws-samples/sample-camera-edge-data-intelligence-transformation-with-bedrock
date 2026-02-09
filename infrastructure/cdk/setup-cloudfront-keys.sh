#!/bin/bash

# CloudFront Signed URL Key Setup Script
# CloudFront署名付きURL用のキーペアを生成し、Secrets Managerに保存

set -e

# 色付きログ用の関数
log_info() {
    echo -e "\033[32m[INFO]\033[0m $1"
}

log_warn() {
    echo -e "\033[33m[WARN]\033[0m $1"
}

log_error() {
    echo -e "\033[31m[ERROR]\033[0m $1"
}

# Secrets Manager の存在チェック関数
check_secrets_manager() {
    local secret_name="$1"
    local region="$2"
    
    if aws secretsmanager describe-secret \
        --secret-id "$secret_name" \
        --region "$region" \
        --output text \
        --query 'Name' >/dev/null 2>&1; then
        return 0  # 存在する
    else
        return 1  # 存在しない
    fi
}

# CDK設定を読み込み
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/load-config.sh" ]]; then
    source "$SCRIPT_DIR/load-config.sh"
else
    log_error "ERROR: $SCRIPT_DIR/load-config.sh not found"
    exit 1
fi

# スタック名とリージョンの確認
if [[ -z "$STACK_PREFIX" ]]; then
    log_error "ERROR: STACK_PREFIX could not be loaded from cdk.config.json"
    exit 1
fi

if [[ -z "$AWS_REGION" ]]; then
    log_error "ERROR: AWS_REGION could not be loaded from cdk.config.json"
    exit 1
fi

STACK_NAME="$STACK_PREFIX"
REGION="$AWS_REGION"

log_info "cdk.config.json からスタック名を取得しました: ${STACK_NAME}"
log_info "cdk.config.json からリージョンを取得しました: ${REGION}"

# キーファイルのディレクトリとパス
KEYS_DIR="keys"
PRIVATE_KEY_FILE="$KEYS_DIR/cloudfront-private-key.pem"
PUBLIC_KEY_FILE="$KEYS_DIR/cloudfront-public-key.pem"
SECRET_NAME="/$STACK_NAME/cloudfront/keypair"

log_info "Setting up CloudFront signed URL keys..."

# keysディレクトリを作成
if [ ! -d "$KEYS_DIR" ]; then
    log_info "Creating keys directory: $KEYS_DIR"
    mkdir -p "$KEYS_DIR"
fi

# 現在の状態を確認
KEY_FILES_EXIST=false
SECRETS_MANAGER_EXISTS=false

if [ -f "$PRIVATE_KEY_FILE" ] && [ -f "$PUBLIC_KEY_FILE" ]; then
    KEY_FILES_EXIST=true
    log_info "Existing key files found:"
    log_info "  - $PRIVATE_KEY_FILE"
    log_info "  - $PUBLIC_KEY_FILE"
fi

log_info "Checking Secrets Manager for existing secret..."
if check_secrets_manager "$SECRET_NAME" "$REGION"; then
    SECRETS_MANAGER_EXISTS=true
    log_info "Secret found in Secrets Manager: $SECRET_NAME"
else
    log_warn "Secret not found in Secrets Manager: $SECRET_NAME"
fi

# 状況別の処理分岐
if [ "$KEY_FILES_EXIST" = true ] && [ "$SECRETS_MANAGER_EXISTS" = true ]; then
    log_info "✅ Both key files and Secrets Manager secret exist. Setup is complete!"
    exit 0
elif [ "$KEY_FILES_EXIST" = true ] && [ "$SECRETS_MANAGER_EXISTS" = false ]; then
    log_warn "Key files exist but Secrets Manager secret is missing."
    log_info "Registering existing keys to Secrets Manager..."
    
    # 既存のキーファイルを読み取り
    PRIVATE_KEY_CONTENT=$(cat "$PRIVATE_KEY_FILE")
    PUBLIC_KEY_CONTENT=$(cat "$PUBLIC_KEY_FILE")
    
elif [ "$KEY_FILES_EXIST" = false ] && [ "$SECRETS_MANAGER_EXISTS" = true ]; then
    log_warn "Secrets Manager secret exists but key files are missing."
    log_info "This is acceptable - CloudFormation will use the secret from Secrets Manager."
    log_info "✅ Setup is complete!"
    exit 0
else
    # 両方存在しない場合
    log_info "No existing keys found. Creating new key pair..."
    
    # RSAキーペアを生成（PKCS#1形式を明示的に指定）
    log_info "Generating RSA key pair in PKCS#1 format..."
    openssl genrsa -out "$PRIVATE_KEY_FILE" 2048

    # PKCS#1形式であることを確実にするため、-traditionalオプション付きで変換
    log_info "Converting to PKCS#1 format..."
    openssl rsa -in "$PRIVATE_KEY_FILE" -out "$PRIVATE_KEY_FILE" -traditional

    # 公開鍵を抽出
    log_info "Extracting public key..."
    openssl rsa -pubout -in "$PRIVATE_KEY_FILE" -out "$PUBLIC_KEY_FILE"

    # 秘密鍵のパーミッションを設定
    chmod 600 "$PRIVATE_KEY_FILE"
    chmod 644 "$PUBLIC_KEY_FILE"
    
    # キーファイルの内容を読み取り
    PRIVATE_KEY_CONTENT=$(cat "$PRIVATE_KEY_FILE")
    PUBLIC_KEY_CONTENT=$(cat "$PUBLIC_KEY_FILE")
    
    log_info "Generated new key files:"
    log_info "  - Private key: $PRIVATE_KEY_FILE"
    log_info "  - Public key: $PUBLIC_KEY_FILE"
fi

# Secrets Managerへの登録処理（既存キーまたは新規キー）
if [ "$SECRETS_MANAGER_EXISTS" = false ]; then
    log_info "Storing key pair in Secrets Manager..."
    SECRET_VALUE=$(jq -n \
      --arg private_key "$PRIVATE_KEY_CONTENT" \
      --arg public_key "$PUBLIC_KEY_CONTENT" \
      '{private_key: $private_key, public_key: $public_key}')

    if aws secretsmanager create-secret \
        --name "$SECRET_NAME" \
        --description "CloudFront key pair for signed URLs" \
        --secret-string "$SECRET_VALUE" \
        --region "$REGION" >/dev/null 2>&1; then
        log_info "✅ Successfully created secret in Secrets Manager"
    else
        log_error "❌ Failed to store key pair in Secrets Manager"
        log_error "Please check your AWS permissions for Secrets Manager"
        log_warn "You can manually create the secret with the following command:"
        log_warn "aws secretsmanager create-secret --name '$SECRET_NAME' --description 'CloudFront key pair for signed URLs' --secret-string '$SECRET_VALUE' --region '$REGION'"
        exit 1
    fi
else
    log_info "Secret already exists in Secrets Manager. Skipping creation."
fi

log_info ""
log_info "🎉 Key setup completed successfully!"
log_info ""
log_info "Current state:"
if [ "$KEY_FILES_EXIST" = true ]; then
    log_info "  ✅ Local key files: $PRIVATE_KEY_FILE, $PUBLIC_KEY_FILE"
else
    log_info "  ℹ️  Local key files: Not needed (using Secrets Manager)"
fi
log_info "  ✅ Secrets Manager: $SECRET_NAME"
log_info ""
log_warn "IMPORTANT SECURITY NOTES:"
log_warn "1. Keep any local private key files secure and never commit them to version control"
log_warn "2. The key pair is now stored securely in AWS Secrets Manager"
log_warn "3. CloudFormation will retrieve keys from Secrets Manager automatically"
log_info ""
log_info "✅ Ready for CloudFormation deployment!" 