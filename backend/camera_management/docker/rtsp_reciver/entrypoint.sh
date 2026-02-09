#!/bin/bash

### 
# このプログラムと同じフォルダに、.envファイルを作成してください



# AWS SDKの標準認証チェーンを有効化（ECS Fargate対応）
export AWS_SDK_LOAD_CONFIG=1

# ECS Fargate, EC2, ローカル環境の判定と設定
if [ -n "$AWS_CONTAINER_CREDENTIALS_RELATIVE_URI" ]; then
    echo "Running on ECS Fargate, using task role"
    echo "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: ${AWS_CONTAINER_CREDENTIALS_RELATIVE_URI}"
elif curl -s http://169.254.169.254/latest/meta-data/ -m 1 > /dev/null; then
    echo "Running on EC2, using instance role"
else
    echo "Running locally, using credentials file"
fi

# デバッグ出力
echo "Authentication method:"
if [ -n "$AWS_ACCESS_KEY_ID" ]; then
    echo "Using static credentials:"
    echo "AWS_ACCESS_KEY_ID: ${AWS_ACCESS_KEY_ID:0:5}..."
    echo "AWS_SECRET_ACCESS_KEY: ${AWS_SECRET_ACCESS_KEY:0:5}..."
    if [ ! -z "$AWS_SESSION_TOKEN" ]; then
        echo "AWS_SESSION_TOKEN: ${AWS_SESSION_TOKEN:0:5}..."
    fi
else
    echo "Using instance role or ECS task role credentials"
fi

# KVS Producer SDK用に環境変数を明示的に設定
if [ -n "$AWS_CONTAINER_CREDENTIALS_RELATIVE_URI" ]; then
    # ECS Fargate環境: Container Credentialsエンドポイントを使用
    export AWS_DEFAULT_REGION="$AWS_REGION"
    echo "ECS Container Credentials endpoint configured for KVS SDK"
    
    # === デバッグ: 認証情報が取得できているか検証 ===
    echo "=== AWS Credentials Debug ==="
    echo "Attempting to retrieve credentials from ECS Container Credentials endpoint..."
    
    # curlでContainer Credentialsエンドポイントから認証情報を取得
    CREDENTIALS_ENDPOINT="http://169.254.170.2${AWS_CONTAINER_CREDENTIALS_RELATIVE_URI}"
    echo "Credentials endpoint: ${CREDENTIALS_ENDPOINT}"
    
    CREDENTIALS_JSON=$(curl -s "${CREDENTIALS_ENDPOINT}")
    
    if [ $? -eq 0 ] && [ -n "$CREDENTIALS_JSON" ]; then
        echo "✅ Successfully retrieved credentials from ECS endpoint"
        
        # JSONから認証情報を抽出（jqがない場合はgrepとsedで対応）
        if command -v jq &> /dev/null; then
            export AWS_ACCESS_KEY_ID=$(echo "$CREDENTIALS_JSON" | jq -r '.AccessKeyId')
            export AWS_SECRET_ACCESS_KEY=$(echo "$CREDENTIALS_JSON" | jq -r '.SecretAccessKey')
            export AWS_SESSION_TOKEN=$(echo "$CREDENTIALS_JSON" | jq -r '.Token')
        else
            # jqがない場合の代替処理（簡易的なパース）
            export AWS_ACCESS_KEY_ID=$(echo "$CREDENTIALS_JSON" | grep -o '"AccessKeyId":"[^"]*"' | cut -d'"' -f4)
            export AWS_SECRET_ACCESS_KEY=$(echo "$CREDENTIALS_JSON" | grep -o '"SecretAccessKey":"[^"]*"' | cut -d'"' -f4)
            export AWS_SESSION_TOKEN=$(echo "$CREDENTIALS_JSON" | grep -o '"Token":"[^"]*"' | cut -d'"' -f4)
        fi
        
        # 認証情報が正しく取得できたか確認
        if [ -n "$AWS_ACCESS_KEY_ID" ] && [ -n "$AWS_SECRET_ACCESS_KEY" ] && [ -n "$AWS_SESSION_TOKEN" ]; then
            echo "✅ Credentials successfully parsed and exported as environment variables"
            echo "   AWS_ACCESS_KEY_ID: ${AWS_ACCESS_KEY_ID:0:10}..."
            echo "   AWS_SECRET_ACCESS_KEY: ${AWS_SECRET_ACCESS_KEY:0:10}..."
            echo "   AWS_SESSION_TOKEN: ${AWS_SESSION_TOKEN:0:20}..."
            
            # AWS CLIで認証情報が有効か確認
            if command -v aws &> /dev/null; then
                echo "Testing credentials with AWS CLI..."
                if aws sts get-caller-identity --region "$AWS_REGION" > /dev/null 2>&1; then
                    echo "✅ AWS CLI authentication successful"
                    aws sts get-caller-identity --region "$AWS_REGION"
                else
                    echo "❌ AWS CLI authentication failed"
                fi
            else
                echo "⚠️ AWS CLI not available, skipping authentication test"
            fi
        else
            echo "❌ Failed to parse credentials from JSON response"
            echo "Response: ${CREDENTIALS_JSON:0:200}..."
        fi
    else
        echo "❌ Failed to retrieve credentials from ECS endpoint"
        echo "Error code: $?"
    fi
    echo "=== End AWS Credentials Debug ==="
    echo ""
fi

# set -e
# エラー発生してもループさせたい

# # AWS認証情報を環境変数として設定
# export AWS_SDK_LOAD_CONFIG=1
# export AWS_KVS_LOG_LEVEL=2

# AWS認証情報を指定したプロファイルから直接環境変数として設定
# export AWS_ACCESS_KEY_ID=$(grep -A3 "\[${AWS_PROFILE}\]" /root/.aws/credentials | grep aws_access_key_id | awk -F= '{print $2}' | tr -d ' ')
# export AWS_SECRET_ACCESS_KEY=$(grep -A3 "\[${AWS_PROFILE}\]" /root/.aws/credentials | grep aws_secret_access_key | awk -F= '{print $2}' | tr -d ' ')
# セッショントークンがある場合
# export AWS_SESSION_TOKEN=$(grep -A3 "\[${AWS_PROFILE}\]" /root/.aws/credentials | grep aws_session_token | awk -F= '{print $2}' | tr -d ' ')

# デバッグ出力（認証情報の最初の数文字のみ表示）
# echo "Credentials from profile [${AWS_PROFILE}]:"
# echo "AWS_ACCESS_KEY_ID: ${AWS_ACCESS_KEY_ID:0:5}..."
# echo "AWS_SECRET_ACCESS_KEY: ${AWS_SECRET_ACCESS_KEY:0:5}..."
# if [ ! -z "$AWS_SESSION_TOKEN" ]; then
#     echo "AWS_SESSION_TOKEN: ${AWS_SESSION_TOKEN:0:5}..."
# fi



if [ -z "$STREAM_NAME" ]; then
    echo "Warning: STREAM_NAME not set, using default 'MacCamera'"
    exit 1
fi

# AWS_REGIONをsamconfig.tomlから取得
if [ -z "$AWS_REGION" ]; then
    SAMCONFIG_FILE="samconfig.toml"
    
    # samconfig.tomlファイルを探す（複数の場所を確認）
    if [ -f "$SAMCONFIG_FILE" ]; then
        SAMCONFIG_PATH="$SAMCONFIG_FILE"
    elif [ -f "../../deployment/$SAMCONFIG_FILE" ]; then
        SAMCONFIG_PATH="../../deployment/$SAMCONFIG_FILE"
    else
        echo "ERROR: samconfig.tomlが見つかりません。AWS_REGIONを環境変数で設定してください。"
        exit 1
    fi
    
    # samconfig.tomlからリージョンを取得
    AWS_REGION=$(grep "^region" "$SAMCONFIG_PATH" | sed 's/region = "\(.*\)"/\1/')
    if [ -z "$AWS_REGION" ]; then
        echo "ERROR: samconfig.tomlからリージョンが取得できませんでした。AWS_REGIONを環境変数で設定してください。"
        exit 1
    fi
    
    export AWS_REGION
    echo "samconfig.tomlからリージョンを取得しました: ${AWS_REGION}"
fi

# Display configuration
echo "Configuration:"
echo "  - Stream Name: $STREAM_NAME"
echo "  - AWS Region: $AWS_REGION"
echo "  - AWS_PROFILE: $AWS_PROFILE"
echo "  - RTSP_URL: $RTSP_URL"
echo "  - RETENTION_PERIOD: $RETENTION_PERIOD"
echo "  - FRAGMENT_DURATION: $FRAGMENT_DURATION"
echo "  - STORAGE_SIZE: $STORAGE_SIZE"
# RTSP パラメータ
#short-header=TRUE: RTSPヘッダーを最適化
#latency=0: レイテンシーを最小化
#buffer-mode=auto: バッファリングを自動最適化
#max-size-buffers=0 max-size-time=0 max-size-bytes=0: キューの制限を解除
# ストリームフォーマットの明示:
# video/x-h264,stream-format=avc,alignment=au: ストリームフォーマットを明示的に指定


# sink のパラメータ
# https://docs.aws.amazon.com/ja_jp/kinesisvideostreams/latest/dg/examples-gstreamer-plugin-parameters.html
# 既存ストリームに送信する場合は、KVS側の設定が優先されるため、プロデューサー側からのパラメータ指定が効かない場合

# retention-period
# KVSストリームの保持期間（時間単位）
# 単位 時間
# デフォルト 2
# ストリーム保持期間を指定します。これは、Kinesis Video Streamsにアップロードされたデータがクラウド上でどれだけ保存されるかを決める値ですが、kvssinkからパラメータとして指定することで、ストリーム作成時にその値が反映されます
RETENTION_PERIOD=${RETENTION_PERIOD:-"24"}

# fragment-duration
# フラグメントの有効期間。	
# 単位 ミリ秒	
# デフォルト 2000
# 低遅延のために500msに短縮
FRAGMENT_DURATION=${FRAGMENT_DURATION:-"500"}

# storage-size
# メビバイト (MiB) 単位のデバイスストレージサイズ。デバイスストレージの構成の詳細については、「StorageInfo」を参照してください。
# 単位 メビバイト (MiB)
# デフォルト 128
# 送信前に一時的にデータを保存するためのローカルバッファ容量を指定します。たとえば、ネットワーク障害時に一時保存できるデータ量を制御
STORAGE_SIZE=${STORAGE_SIZE:-"512"}

# GSTREAMER_LOG_MODE
# GStreamerパイプラインのログ出力先を制御
# - "stdout": 標準出力に出力（デフォルト）- CloudWatch Logsでkvssinkエラーを確認可能
# - "null": ログを破棄
# 注意: kvssinkの認証エラー等を確認するため、デフォルトはstdoutに設定
GSTREAMER_LOG_MODE=${GSTREAMER_LOG_MODE:-"stdout"}

# パイプラインを完全に終了させる関数
# SIGINT → SIGTERM → SIGKILL の順でgraceful shutdownを試みる
# SIGINTを使うことで、GStreamerがEOSを発行し、RTSPのTEARDOWN送信、
# kvssinkのAWS接続正常終了、TCPソケットの正常クローズが行われる
# 高速化版: 最大8秒（通常は0秒で完了）
cleanup_pipeline() {
    local pid=$1
    local start_time=$(date +%s.%N 2>/dev/null || date +%s)
    
    # 処理時間をログ出力するヘルパー関数
    log_elapsed() {
        local end_time=$(date +%s.%N 2>/dev/null || date +%s)
        local elapsed=$(awk "BEGIN {printf \"%.3f\", $end_time - $start_time}" 2>/dev/null || echo "N/A")
        echo "⏱️  cleanup_pipeline 処理時間: ${elapsed}秒"
    }
    
    if [ -z "$pid" ]; then
        log_elapsed
        return 0
    fi
    
    # プロセスが存在するか確認
    if ! kill -0 $pid 2>/dev/null; then
        echo "プロセスPID $pid は既に停止しています"
        log_elapsed
        return 0
    fi
    
    echo "パイプラインを終了中... (PID: $pid)"
    
    # 1. SIGINTを送信（GStreamerがEOSを発行してgraceful shutdown）
    echo "📤 SIGINTを送信してgraceful shutdownを開始..."
    kill -INT -$pid 2>/dev/null || kill -INT $pid 2>/dev/null
    
    # 2. 最大5秒待機（0.5秒間隔でチェック）
    for i in {1..10}; do
        if ! kill -0 $pid 2>/dev/null; then
            echo "✅ パイプラインが正常に終了しました（graceful shutdown成功）"
            log_elapsed
            return 0
        fi
        sleep 0.5
    done
    
    # 3. まだ生きていればSIGTERMを送信
    echo "⚠️  SIGTERMで終了を試みます..."
    kill -TERM -$pid 2>/dev/null || kill -TERM $pid 2>/dev/null
    
    # 4. 最大3秒待機（0.5秒間隔でチェック）
    for i in {1..6}; do
        if ! kill -0 $pid 2>/dev/null; then
            echo "✅ パイプラインが終了しました（SIGTERM）"
            log_elapsed
            return 0
        fi
        sleep 0.5
    done
    
    # 5. 最後の手段としてSIGKILLで強制終了（プロセスグループ全体に）
    echo "❌ 強制終了を実行中（SIGKILL）..."
    kill -KILL -$pid 2>/dev/null || kill -KILL $pid 2>/dev/null
    
    # 6. 念のため子プロセスも探してkill
    pkill -KILL -P $pid 2>/dev/null
    
    echo "⚠️  パイプラインを強制終了しました（リソースリークの可能性あり）"
    log_elapsed
    return 0
}

# パイプラインを開始する関数
start_pipeline() {
    echo "GStreamerパイプラインを開始します..."
    
    # RTSPソースの接続を確認（タイムアウトを長めに設定）
    echo "RTSPソースへの接続を確認中..."
    
    # URLからホストとポートを抽出
    # rtsp://host:port/path または rtsps://host:port/path の形式を想定
    RTSP_HOST_PORT=$(echo "${RTSP_URL}" | sed -E 's|^rtsps?://([^/]+).*|\1|')
    RTSP_HOST=$(echo "${RTSP_HOST_PORT}" | cut -d: -f1)
    RTSP_PORT=$(echo "${RTSP_HOST_PORT}" | cut -d: -f2)
    
    # RTSPSの場合はopensslで接続確認、RTSPの場合はcurlで確認
    if [[ "${RTSP_URL}" == rtsps://* ]]; then
        # RTSPS: opensslでTLS接続確認
        if ! echo | timeout 10 openssl s_client -connect "${RTSP_HOST}:${RTSP_PORT}" 2>/dev/null | grep -q "CONNECTED"; then
            echo "警告: RTSPSソースに接続できません。接続を再試行します。"
            return 1
        fi
    else
        # RTSP: curlで接続確認
        if ! curl -s -m 10 "${RTSP_URL}" > /dev/null 2>&1; then
            echo "警告: RTSPソースに接続できません。接続を再試行します。"
            return 1
        fi
    fi
    echo "RTSPソースへの接続確認完了"

    # ログ出力先を設定
    if [ "$GSTREAMER_LOG_MODE" = "stdout" ]; then
        echo "GStreamerログを標準出力に出力します"
    else
        echo "GStreamerログを破棄します（/dev/null）"
    fi

    # パイプラインをバックグラウンドで実行（プロセスグループとして起動）
    echo "GStreamerパイプラインを起動中..."
    if [ "$GSTREAMER_LOG_MODE" = "stdout" ]; then
        setsid gst-launch-1.0 -v \
            rtspsrc location=${RTSP_URL} \
            tls-validation-flags=0 \
            buffer-mode=auto \
            latency=0 \
            protocols=tcp \
            retry=30 \
            timeout=15 \
            ! rtph264depay \
            ! queue max-size-buffers=1000000 max-size-bytes=1048576 max-size-time=200000000 leaky=downstream \
            ! h264parse \
            ! video/x-h264,stream-format=avc,alignment=au \
            ! kvssink stream-name="${STREAM_NAME}" \
            storage-size="$STORAGE_SIZE" \
            retention-period="$RETENTION_PERIOD" \
            fragment-duration=$FRAGMENT_DURATION \
            key-frame-fragmentation=true \
            aws-region="$AWS_REGION" \
            2>&1 &
    else
        setsid gst-launch-1.0 -v \
            rtspsrc location=${RTSP_URL} \
            tls-validation-flags=0 \
            buffer-mode=auto \
            latency=0 \
            protocols=tcp \
            retry=30 \
            timeout=15 \
            ! rtph264depay \
            ! queue max-size-buffers=1000000 max-size-bytes=1048576 max-size-time=200000000 leaky=downstream \
            ! h264parse \
            ! video/x-h264,stream-format=avc,alignment=au \
            ! kvssink stream-name="${STREAM_NAME}" \
            storage-size="$STORAGE_SIZE" \
            retention-period="$RETENTION_PERIOD" \
            fragment-duration=$FRAGMENT_DURATION \
            key-frame-fragmentation=true \
            aws-region="$AWS_REGION" \
            &> /dev/null &
    fi
        
    # 一つ前のversion パイプラインをバックグラウンドで実行
    # echo "GStreamerパイプラインを起動中..."
    # gst-launch-1.0 -v \
    #     rtspsrc location=${RTSP_URL} \
    #     buffer-mode=auto \
    #     latency=0 \
    #     protocols=tcp \
    #     retry=30 \
    #     timeout=15 \
    #     ! rtph264depay \
    #     ! queue max-size-buffers=10 leaky=downstream \
    #     ! h264parse \
    #     ! video/x-h264,stream-format=avc,alignment=au \
    #     ! kvssink stream-name="${STREAM_NAME}" \
    #     storage-size="$STORAGE_SIZE" \
    #     retention-period="$RETENTION_PERIOD" \
    #     fragment-duration=$FRAGMENT_DURATION \
    #     key-frame-fragmentation=true \
    #     aws-region="$AWS_REGION" \
    #     &> /tmp/gstreamer.log &
    
    pipeline_pid=$!
    echo $pipeline_pid > /tmp/gstreamer.pid

    # パイプラインの起動を確認
    sleep 5
    if ! kill -0 $pipeline_pid 2>/dev/null; then
        echo "エラー: パイプラインの起動に失敗しました。"
        return 1
    fi

    echo "パイプラインが正常に起動しました。PID: $pipeline_pid"
    return 0
}

# パイプラインの状態を監視する関数
monitor_pipeline() {
    local pipeline_pid=$1
    local check_interval=1  # 1秒間隔でチェック（kill -0は軽量なので負荷なし）

    while true; do
        # パイプラインが実行中かチェック
        if ! kill -0 $pipeline_pid 2>/dev/null; then
            echo "パイプラインが停止しました。クリーンアップして再起動します。"
            cleanup_pipeline $pipeline_pid
            return 1
        fi

        sleep $check_interval
    done
}

# Ctrl+Cなどのシグナルをトラップしてクリーンアップ
trap 'cleanup_pipeline $pipeline_pid; exit 0' SIGTERM SIGINT

# AWS認証情報を更新する関数
# ECS Fargateの一時認証情報は約6時間で期限切れになるため、
# パイプライン起動前に毎回更新することで長時間稼働時の認証エラーを防止
refresh_credentials() {
    if [ -n "$AWS_CONTAINER_CREDENTIALS_RELATIVE_URI" ]; then
        echo "🔄 AWS認証情報を更新中..."
        local CREDENTIALS_ENDPOINT="http://169.254.170.2${AWS_CONTAINER_CREDENTIALS_RELATIVE_URI}"
        local CREDENTIALS_JSON=$(curl -s "${CREDENTIALS_ENDPOINT}")
        
        if [ $? -eq 0 ] && [ -n "$CREDENTIALS_JSON" ]; then
            # JSONから認証情報を抽出
            if command -v jq &> /dev/null; then
                export AWS_ACCESS_KEY_ID=$(echo "$CREDENTIALS_JSON" | jq -r '.AccessKeyId')
                export AWS_SECRET_ACCESS_KEY=$(echo "$CREDENTIALS_JSON" | jq -r '.SecretAccessKey')
                export AWS_SESSION_TOKEN=$(echo "$CREDENTIALS_JSON" | jq -r '.Token')
            else
                # jqがない場合の代替処理
                export AWS_ACCESS_KEY_ID=$(echo "$CREDENTIALS_JSON" | grep -o '"AccessKeyId":"[^"]*"' | cut -d'"' -f4)
                export AWS_SECRET_ACCESS_KEY=$(echo "$CREDENTIALS_JSON" | grep -o '"SecretAccessKey":"[^"]*"' | cut -d'"' -f4)
                export AWS_SESSION_TOKEN=$(echo "$CREDENTIALS_JSON" | grep -o '"Token":"[^"]*"' | cut -d'"' -f4)
            fi
            
            # 認証情報が正しく取得できたか確認
            if [ -n "$AWS_ACCESS_KEY_ID" ] && [ -n "$AWS_SECRET_ACCESS_KEY" ] && [ -n "$AWS_SESSION_TOKEN" ]; then
                echo "✅ AWS認証情報を更新しました (AccessKeyId: ${AWS_ACCESS_KEY_ID:0:10}...)"
                return 0
            else
                echo "❌ AWS認証情報のパースに失敗しました"
                return 1
            fi
        else
            echo "❌ AWS認証情報の取得に失敗しました (endpoint: ${CREDENTIALS_ENDPOINT})"
            return 1
        fi
    else
        # ECS Fargate以外の環境（EC2、ローカル等）では何もしない
        return 0
    fi
}

# パイプライン稼働時間を計算してログ出力する関数
log_pipeline_uptime() {
    local start_time=$1
    local end_time=$(date +%s)
    local elapsed=$((end_time - start_time))
    local hours=$((elapsed / 3600))
    local minutes=$(((elapsed % 3600) / 60))
    local seconds=$((elapsed % 60))
    echo "📊 パイプライン稼働時間: ${hours}時間${minutes}分${seconds}秒 (${elapsed}秒)"
}

while true
do 
    # パイプライン起動前にAWS認証情報を更新（ECS Fargate環境のみ）
    # 一時認証情報は約6時間で期限切れになるため、毎回更新する
    refresh_credentials
    
    if start_pipeline; then
        # パイプライン開始時刻を記録
        pipeline_start_time=$(date +%s)
        echo "🚀 パイプライン開始: $(date '+%Y-%m-%d %H:%M:%S')"
        
        # パイプラインの状態を監視
        monitor_pipeline $pipeline_pid
        
        # 稼働時間をログ出力
        log_pipeline_uptime $pipeline_start_time
        
        # クリーンアップをフォアグラウンドで実行（リソースリーク防止）
        cleanup_pipeline $pipeline_pid
    else
        echo "パイプラインの起動に失敗しました。10秒後に再試行します..."
        cleanup_pipeline $pipeline_pid
        sleep 30
    fi
done

# Stream from RTSP to KVS
# gst-launch-1.0 -v \
#     rtspsrc location="$RTSP_URL" short-header=TRUE latency=0 buffer-mode=auto ! \
#     rtph264depay ! \
#     h264parse ! \
#     video/x-h264,stream-format=avc,alignment=au ! \
#     queue max-size-buffers=0 max-size-time=0 max-size-bytes=0 ! \
#     kvssink stream-name="$STREAM_NAME" \
#     storage-size="$STORAGE_SIZE" \
#     retention-period="$RETENTION_PERIOD" \
#     fragment-duration=$FRAGMENT_DURATION \
#     aws-region="$AWS_REGION"

    # gst-launch-1.0 -v \
    #     rtspsrc location=${RTSP_URL} ! rtph264depay ! tee name=t ! \
    #     queue ! h264parse ! \
    #     kvssink stream-name="${STREAM_NAME}" \
    #     storage-size="$STORAGE_SIZE" \
    #     retention-period="$RETENTION_PERIOD" \
    #     fragment-duration=$FRAGMENT_DURATION \
    #     aws-region="$AWS_REGION" \
    #     t. ! queue ! avdec_h264 ! videoconvert ! video/x-raw,width=1280,height=720 ! \
    #     videorate ! video/x-raw,framerate=5/1 ! jpegenc ! multifilesink location="/tmp/frame%06d.jpg"
