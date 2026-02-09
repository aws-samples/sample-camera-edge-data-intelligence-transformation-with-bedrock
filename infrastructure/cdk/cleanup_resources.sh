#!/bin/bash
# =============================================================================
# CEDIX リソースクリーンアップスクリプト
# =============================================================================
# 
# 概要:
#   CDKでデプロイしたリソース、および動的にデプロイされたCloudFormationスタック、
#   EventBridgeルール、S3オブジェクトなどを全て削除します。
#
# 使用方法:
#   ./cleanup_resources.sh [--dry-run] [--force] [--config=<config_file>]
#
# オプション:
#   --dry-run           : 実際には削除せず、削除対象を表示のみ
#   --force             : 確認プロンプトをスキップ
#   --config=<file>     : 設定ファイルを指定（デフォルト: cdk.config.json）
#
# 前提条件:
#   - AWS CLI がインストールされていること
#   - default プロファイルで対象アカウントに接続できること
#   - jq がインストールされていること
#
# =============================================================================

set -e

# カラー定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# スクリプトのディレクトリを取得
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/cdk.config.json"

# オプション解析
DRY_RUN=false
FORCE=false
CUSTOM_CONFIG=""

for arg in "$@"; do
  case $arg in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --force)
      FORCE=true
      shift
      ;;
    --config=*)
      CUSTOM_CONFIG="${arg#*=}"
      shift
      ;;
    *)
      ;;
  esac
done

# ログ関数
log_info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

log_dry_run() {
  echo -e "${YELLOW}[DRY-RUN]${NC} Would execute: $1"
}

# 設定ファイル読み込み
if [ -n "$CUSTOM_CONFIG" ]; then
  CONFIG_FILE="$CUSTOM_CONFIG"
  if [[ ! "$CONFIG_FILE" = /* ]]; then
    CONFIG_FILE="${SCRIPT_DIR}/${CONFIG_FILE}"
  fi
fi

if [ ! -f "$CONFIG_FILE" ]; then
  log_error "設定ファイルが見つかりません: $CONFIG_FILE"
  exit 1
fi

STACK_PREFIX=$(jq -r '.stackPrefix' "$CONFIG_FILE")
REGION=$(jq -r '.region' "$CONFIG_FILE")
S3_ADDITIONAL_PREFIX=$(jq -r '.s3AdditionalPrefix // empty' "$CONFIG_FILE")

if [ -z "$STACK_PREFIX" ] || [ "$STACK_PREFIX" == "null" ]; then
  log_error "stackPrefix が設定されていません"
  exit 1
fi

if [ -z "$REGION" ] || [ "$REGION" == "null" ]; then
  REGION="ap-northeast-1"
fi

log_info "=========================================="
log_info "CEDIX リソースクリーンアップ"
log_info "=========================================="
log_info "Stack Prefix: ${STACK_PREFIX}"
log_info "Region: ${REGION}"
log_info "S3 Additional Prefix: ${S3_ADDITIONAL_PREFIX:-'(none)'}"
log_info "Dry Run: ${DRY_RUN}"
log_info "=========================================="

# 確認プロンプト
if [ "$FORCE" != "true" ] && [ "$DRY_RUN" != "true" ]; then
  echo ""
  log_warn "⚠️  警告: この操作は取り消せません！"
  log_warn "以下のリソースが全て削除されます:"
  echo "  - CloudFormation スタック (${STACK_PREFIX}-* および動的スタック)"
  echo "  - S3 バケット内のオブジェクト"
  echo "  - EventBridge ルール (cedix-detector-*)"
  echo "  - ECR リポジトリ内のイメージ"
  echo "  - Kinesis Video Streams"
  echo ""
  read -p "本当に続行しますか？ (yes/no): " confirm
  if [ "$confirm" != "yes" ]; then
    log_info "キャンセルしました"
    exit 0
  fi
fi

# =============================================================================
# 1. 動的にデプロイされたCloudFormationスタックの削除
# =============================================================================
delete_dynamic_stacks() {
  log_info "=========================================="
  log_info "1. 動的CloudFormationスタックの削除"
  log_info "=========================================="
  
  # stackPrefix配下の動的スタックを検索
  # パターン: {stackPrefix}-rtsp-receiver-*, {stackPrefix}-rtmp-server-*, 
  #          {stackPrefix}-gethlsyolo-*, {stackPrefix}-gethls-*, {stackPrefix}-getmedia-*,
  #          {stackPrefix}-rtsp-movie-*, {stackPrefix}-s3yolo-*, {stackPrefix}-s3rec-*,
  #          {stackPrefix}-hlsyolo-*, {stackPrefix}-hlsrec-*
  log_info "動的スタックを検索中..."
  
  # stackPrefixで始まるスタックのうち、CDKメインスタック以外を取得
  DYNAMIC_STACKS=$(aws cloudformation list-stacks \
    --region "$REGION" \
    --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE ROLLBACK_COMPLETE UPDATE_ROLLBACK_COMPLETE \
    --query "StackSummaries[?starts_with(StackName, '${STACK_PREFIX}-')].StackName" \
    --output text 2>/dev/null || echo "")
  
  # CDKメインスタックを除外するためのリスト
  CDK_MAIN_STACKS=(
    "${STACK_PREFIX}-keys"
    "${STACK_PREFIX}-api-ecr"
    "${STACK_PREFIX}-ingestion-ecr"
    "${STACK_PREFIX}-foundation"
    "${STACK_PREFIX}-application"
    "${STACK_PREFIX}-frontend"
    "${STACK_PREFIX}-bedrock"
    "${STACK_PREFIX}-hlsyolo-ecr"
    "${STACK_PREFIX}-hlsrec-ecr"
    "${STACK_PREFIX}-s3rec-ecr"
    "${STACK_PREFIX}-s3yolo-ecr"
    "${STACK_PREFIX}-rtsp-receiver-ecr"
    "${STACK_PREFIX}-rtsp-movie-ecr"
    "${STACK_PREFIX}-kvs-base-ecr"
    "${STACK_PREFIX}-rtmp-server-ecr"
    "${STACK_PREFIX}-webapp"
    "${STACK_PREFIX}-gethls-ecr"
    "${STACK_PREFIX}-gets3-ecr"
    "${STACK_PREFIX}-getmedia-ecr"
    "${STACK_PREFIX}-deployment-camera-ecr"
    "${STACK_PREFIX}-gethlsyolo-ecr"
  )
  
  # 動的スタックのみをフィルタリング
  FILTERED_DYNAMIC_STACKS=""
  for stack in $DYNAMIC_STACKS; do
    is_cdk_main=false
    for cdk_stack in "${CDK_MAIN_STACKS[@]}"; do
      if [ "$stack" == "$cdk_stack" ]; then
        is_cdk_main=true
        break
      fi
    done
    if [ "$is_cdk_main" == "false" ]; then
      FILTERED_DYNAMIC_STACKS="$FILTERED_DYNAMIC_STACKS $stack"
    fi
  done
  DYNAMIC_STACKS="$FILTERED_DYNAMIC_STACKS"
  
  if [ -z "$DYNAMIC_STACKS" ]; then
    log_info "動的スタックは見つかりませんでした"
  else
    for stack in $DYNAMIC_STACKS; do
      log_info "削除対象スタック: $stack"
      if [ "$DRY_RUN" == "true" ]; then
        log_dry_run "aws cloudformation delete-stack --stack-name $stack --region $REGION"
      else
        log_info "スタック削除中: $stack"
        aws cloudformation delete-stack --stack-name "$stack" --region "$REGION" || log_warn "スタック削除失敗: $stack"
      fi
    done
    
    # 削除完了を待機
    if [ "$DRY_RUN" != "true" ]; then
      for stack in $DYNAMIC_STACKS; do
        log_info "スタック削除待機中: $stack"
        aws cloudformation wait stack-delete-complete --stack-name "$stack" --region "$REGION" 2>/dev/null || log_warn "スタック削除待機タイムアウト: $stack"
      done
    fi
  fi
}

# =============================================================================
# 2. EventBridgeルールの削除
# =============================================================================
delete_eventbridge_rules() {
  log_info "=========================================="
  log_info "2. EventBridgeルールの削除"
  log_info "=========================================="
  
  # cedix-detector-* パターンのルールを検索
  RULES=$(aws events list-rules \
    --region "$REGION" \
    --name-prefix "cedix-detector-" \
    --query "Rules[].Name" \
    --output text 2>/dev/null || echo "")
  
  if [ -z "$RULES" ]; then
    log_info "EventBridgeルールは見つかりませんでした"
  else
    for rule in $RULES; do
      log_info "削除対象ルール: $rule"
      
      if [ "$DRY_RUN" == "true" ]; then
        log_dry_run "aws events remove-targets --rule $rule --ids ..."
        log_dry_run "aws events delete-rule --name $rule --region $REGION"
      else
        # ターゲットを取得して削除
        TARGETS=$(aws events list-targets-by-rule \
          --rule "$rule" \
          --region "$REGION" \
          --query "Targets[].Id" \
          --output text 2>/dev/null || echo "")
        
        if [ -n "$TARGETS" ]; then
          log_info "ターゲット削除中: $rule"
          aws events remove-targets --rule "$rule" --ids $TARGETS --region "$REGION" || log_warn "ターゲット削除失敗: $rule"
        fi
        
        log_info "ルール削除中: $rule"
        aws events delete-rule --name "$rule" --region "$REGION" || log_warn "ルール削除失敗: $rule"
      fi
    done
  fi
}

# =============================================================================
# 3. S3バケットの中身を削除
# =============================================================================
delete_s3_objects() {
  log_info "=========================================="
  log_info "3. S3バケットオブジェクトの削除"
  log_info "=========================================="
  
  # バケット名パターンを構築（複数バケット対応）
  BUCKET_PATTERNS=()
  if [ -n "$S3_ADDITIONAL_PREFIX" ]; then
    BUCKET_PATTERNS=(
      "${STACK_PREFIX}-${S3_ADDITIONAL_PREFIX}-bucket"
      "${STACK_PREFIX}-${S3_ADDITIONAL_PREFIX}-webapp"
    )
  else
    BUCKET_PATTERNS=(
      "${STACK_PREFIX}-bucket"
      "${STACK_PREFIX}-webapp"
    )
  fi
  
  for BUCKET_NAME in "${BUCKET_PATTERNS[@]}"; do
    log_info "対象バケット: $BUCKET_NAME"
    
    # バケットの存在確認
    if ! aws s3api head-bucket --bucket "$BUCKET_NAME" --region "$REGION" 2>/dev/null; then
      log_info "バケットが存在しません: $BUCKET_NAME"
      continue
    fi
    
    if [ "$DRY_RUN" == "true" ]; then
      log_dry_run "S3バケット ${BUCKET_NAME} を削除"
      continue
    fi
    
    # オブジェクト数を確認
    OBJECT_COUNT=$(aws s3api list-objects-v2 --bucket "$BUCKET_NAME" --region "$REGION" --max-keys 1 --query 'KeyCount' --output text 2>/dev/null || echo "0")
    
    if [ "$OBJECT_COUNT" == "0" ] || [ -z "$OBJECT_COUNT" ]; then
      log_info "バケットは空です。バケット削除を試行..."
      aws s3 rb "s3://$BUCKET_NAME" --region "$REGION" 2>/dev/null && log_success "バケット削除完了: $BUCKET_NAME" || log_warn "バケット削除失敗: $BUCKET_NAME"
      continue
    fi
    
    log_info "オブジェクトが存在します。削除中..."
    
    # タイムアウト付きで削除（5分）
    timeout 300 aws s3 rm "s3://$BUCKET_NAME" --recursive --only-show-errors --region "$REGION" || log_warn "オブジェクト削除タイムアウト: $BUCKET_NAME"
    
    # バケット削除
    log_info "バケット削除中: $BUCKET_NAME"
    aws s3 rb "s3://$BUCKET_NAME" --force --region "$REGION" 2>/dev/null || log_warn "バケット削除失敗（バージョン付きオブジェクトが残っている可能性）: $BUCKET_NAME"
    
    log_success "S3処理完了: $BUCKET_NAME"
  done
}

# =============================================================================
# 4. ECRリポジトリのイメージ削除
# =============================================================================
delete_ecr_images() {
  log_info "=========================================="
  log_info "4. ECRリポジトリイメージの削除"
  log_info "=========================================="
  
  # CEDIX関連のECRリポジトリを検索
  # リポジトリ名パターン: cedix-*, cdk-*-container-assets-*
  ECR_REPOS=$(aws ecr describe-repositories \
    --region "$REGION" \
    --query "repositories[?contains(repositoryName, 'cedix') || contains(repositoryName, 'cdk-')].repositoryName" \
    --output text 2>/dev/null || echo "")
  
  if [ -z "$ECR_REPOS" ]; then
    log_info "ECRリポジトリは見つかりませんでした"
  else
    for repo in $ECR_REPOS; do
      log_info "対象リポジトリ: $repo"
      
      if [ "$DRY_RUN" == "true" ]; then
        log_dry_run "aws ecr batch-delete-image --repository-name $repo --image-ids ..."
      else
        # イメージIDを取得
        IMAGE_IDS=$(aws ecr list-images \
          --repository-name "$repo" \
          --region "$REGION" \
          --query 'imageIds[*]' \
          --output json 2>/dev/null || echo "[]")
        
        if [ "$IMAGE_IDS" != "[]" ] && [ -n "$IMAGE_IDS" ]; then
          log_info "イメージ削除中: $repo"
          echo "$IMAGE_IDS" | aws ecr batch-delete-image \
            --repository-name "$repo" \
            --image-ids file:///dev/stdin \
            --region "$REGION" 2>/dev/null || log_warn "イメージ削除失敗: $repo"
        fi
      fi
    done
  fi
}

# =============================================================================
# 5. Kinesis Video Streamsの削除
# =============================================================================
delete_kvs_streams() {
  log_info "=========================================="
  log_info "5. Kinesis Video Streamsの削除"
  log_info "=========================================="

  # CEDIX関連のKVSストリームを検索
  KVS_STREAMS=$(aws kinesisvideo list-streams \
    --region "$REGION" \
    --query "StreamInfoList[?contains(StreamName, 'cam-') || contains(StreamName, 'camera-')].StreamName" \
    --output text 2>/dev/null || echo "")

  if [ -z "$KVS_STREAMS" ]; then
    log_info "Kinesis Video Streamsは見つかりませんでした"
  else
    for stream in $KVS_STREAMS; do
      log_info "削除対象ストリーム: $stream"

      if [ "$DRY_RUN" == "true" ]; then
        log_dry_run "aws kinesisvideo delete-stream --stream-name $stream --region $REGION"
        continue
      fi

      # ストリーム状態を確認
      STREAM_STATUS=$(aws kinesisvideo describe-stream \
        --stream-name "$stream" \
        --region "$REGION" \
        --query "StreamInfo.Status" \
        --output text 2>/dev/null || echo "NOT_FOUND")

      if [ "$STREAM_STATUS" == "NOT_FOUND" ]; then
        log_info "ストリームが見つかりません（既に削除済み）: $stream"
        continue
      fi

      log_info "ストリーム状態: $STREAM_STATUS"

      # DELETING状態の場合は待機
      if [ "$STREAM_STATUS" == "DELETING" ]; then
        log_info "既に削除中です。待機します..."
        sleep 5
        continue
      fi

      # 削除実行（エラー詳細を取得）
      log_info "ストリーム削除中: $stream"
      DELETE_OUTPUT=$(aws kinesisvideo delete-stream \
        --stream-name "$stream" \
        --region "$REGION" 2>&1)
      DELETE_STATUS=$?

      if [ $DELETE_STATUS -eq 0 ]; then
        log_success "ストリーム削除成功: $stream"
      else
        log_warn "ストリーム削除失敗: $stream"
        log_warn "エラー詳細: $DELETE_OUTPUT"

        # リトライ（ResourceInUseExceptionの場合）
        if echo "$DELETE_OUTPUT" | grep -q "ResourceInUseException"; then
          log_info "リソース使用中。10秒後にリトライします..."
          sleep 10

          aws kinesisvideo delete-stream \
            --stream-name "$stream" \
            --region "$REGION" 2>&1 && \
            log_success "リトライ成功: $stream" || \
            log_error "リトライ失敗: $stream"
        fi
      fi
    done
  fi
}

# =============================================================================
# 6. CDKスタックの削除（逆順）
# =============================================================================
delete_cdk_stacks() {
  log_info "=========================================="
  log_info "6. CDKスタックの削除"
  log_info "=========================================="
  
  # 削除順序（依存関係の逆順）
  # 注: webappは別途cdk-webapp.tsでデプロイされるため含める
  CDK_STACKS=(
    "${STACK_PREFIX}-webapp"
    "${STACK_PREFIX}-bedrock"
    "${STACK_PREFIX}-frontend"
    "${STACK_PREFIX}-application"
    "${STACK_PREFIX}-foundation"
    "${STACK_PREFIX}-rtmp-server-ecr"
    "${STACK_PREFIX}-kvs-base-ecr"
    "${STACK_PREFIX}-rtsp-movie-ecr"
    "${STACK_PREFIX}-rtsp-receiver-ecr"
    "${STACK_PREFIX}-s3yolo-ecr"
    "${STACK_PREFIX}-s3rec-ecr"
    "${STACK_PREFIX}-hlsrec-ecr"
    "${STACK_PREFIX}-hlsyolo-ecr"
    "${STACK_PREFIX}-gethlsyolo-ecr"
    "${STACK_PREFIX}-gethls-ecr"
    "${STACK_PREFIX}-gets3-ecr"
    "${STACK_PREFIX}-getmedia-ecr"
    "${STACK_PREFIX}-deployment-camera-ecr"
    "${STACK_PREFIX}-ingestion-ecr"
    "${STACK_PREFIX}-api-ecr"
    "${STACK_PREFIX}-keys"
  )
  
  for stack in "${CDK_STACKS[@]}"; do
    # スタックの存在確認
    STACK_STATUS=$(aws cloudformation describe-stacks \
      --stack-name "$stack" \
      --region "$REGION" \
      --query "Stacks[0].StackStatus" \
      --output text 2>/dev/null || echo "NOT_FOUND")
    
    if [ "$STACK_STATUS" == "NOT_FOUND" ]; then
      log_info "スタックは存在しません: $stack"
      continue
    fi
    
    log_info "削除対象スタック: $stack (Status: $STACK_STATUS)"
    
    if [ "$DRY_RUN" == "true" ]; then
      log_dry_run "aws cloudformation delete-stack --stack-name $stack --region $REGION"
      continue
    fi
    
    log_info "スタック削除中: $stack"
    DELETE_OUTPUT=$(aws cloudformation delete-stack --stack-name "$stack" --region "$REGION" 2>&1)
    DELETE_STATUS=$?
    
    if [ $DELETE_STATUS -ne 0 ]; then
      log_warn "スタック削除コマンド失敗: $stack"
      log_warn "エラー詳細: $DELETE_OUTPUT"
      continue
    fi
    
    log_info "スタック削除待機中: $stack"
    
    # foundationスタックは特別なエラーハンドリング（依存関係エラーが発生しやすい）
    if [[ "$stack" == *"foundation"* ]]; then
      WAIT_OUTPUT=$(aws cloudformation wait stack-delete-complete --stack-name "$stack" --region "$REGION" 2>&1)
      WAIT_STATUS=$?
      
      if [ $WAIT_STATUS -ne 0 ]; then
        log_warn "Foundationスタック削除待機失敗: $stack"
        
        # 削除失敗の詳細を取得
        FAILURE_REASON=$(aws cloudformation describe-stack-events \
          --stack-name "$stack" \
          --region "$REGION" \
          --query "StackEvents[?ResourceStatus=='DELETE_FAILED'][0].ResourceStatusReason" \
          --output text 2>/dev/null || echo "不明")
        
        log_warn "失敗理由: $FAILURE_REASON"
        
        # リトライ（30秒待機後）
        log_info "30秒後にリトライします..."
        sleep 30
        
        aws cloudformation delete-stack --stack-name "$stack" --region "$REGION" 2>&1 || true
        aws cloudformation wait stack-delete-complete --stack-name "$stack" --region "$REGION" 2>/dev/null || \
          log_error "Foundationスタック削除リトライ失敗: $stack（手動での確認が必要です）"
      else
        log_success "Foundationスタック削除完了: $stack"
      fi
    else
      aws cloudformation wait stack-delete-complete --stack-name "$stack" --region "$REGION" 2>/dev/null || log_warn "スタック削除待機タイムアウト: $stack"
    fi
  done
}

# =============================================================================
# 7. SSMパラメータの削除
# =============================================================================
delete_ssm_parameters() {
  log_info "=========================================="
  log_info "7. SSMパラメータの削除"
  log_info "=========================================="
  
  # CEDIX関連のSSMパラメータを検索
  SSM_PARAMS=$(aws ssm describe-parameters \
    --region "$REGION" \
    --parameter-filters "Key=Name,Option=Contains,Values=/Cedix/" \
    --query "Parameters[].Name" \
    --output text 2>/dev/null || echo "")
  
  if [ -z "$SSM_PARAMS" ]; then
    log_info "SSMパラメータは見つかりませんでした"
  else
    for param in $SSM_PARAMS; do
      log_info "削除対象パラメータ: $param"
      
      if [ "$DRY_RUN" == "true" ]; then
        log_dry_run "aws ssm delete-parameter --name $param --region $REGION"
      else
        log_info "パラメータ削除中: $param"
        aws ssm delete-parameter --name "$param" --region "$REGION" 2>/dev/null || log_warn "パラメータ削除失敗: $param"
      fi
    done
  fi
}

# =============================================================================
# メイン処理
# =============================================================================
main() {
  log_info "クリーンアップ開始..."
  
  # 1. 動的スタックの削除（ECSサービス含む）
  delete_dynamic_stacks
  
  # 2. EventBridgeルールの削除
  delete_eventbridge_rules
  
  # 3. S3オブジェクトの削除
  delete_s3_objects
  
  # 4. ECRイメージの削除
  delete_ecr_images
  
  # 5. KVSストリームの削除
  delete_kvs_streams
  
  # 6. CDKスタックの削除
  delete_cdk_stacks
  
  # 7. SSMパラメータの削除
  delete_ssm_parameters
  
  log_info "=========================================="
  if [ "$DRY_RUN" == "true" ]; then
    log_success "Dry Run 完了 - 上記のコマンドが実行されます"
  else
    log_success "クリーンアップ完了！"
  fi
  log_info "=========================================="
}

# 実行
main
