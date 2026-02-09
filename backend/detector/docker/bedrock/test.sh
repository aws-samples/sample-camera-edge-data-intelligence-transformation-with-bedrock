#!/bin/bash

# 使い方:
#   ./test.sh save_image         # SaveImageEvent形式でテスト (Claude Sonnet)
#   ./test.sh save_video         # SaveVideoEvent形式でテスト (Nova Pro)
#   ./test.sh class_detect       # ClassDetectEvent形式でテスト (Claude Sonnet)
#   ./test.sh area_detect_track  # AreaDetectEvent形式 track_ids_change モードでテスト
#   ./test.sh area_detect_count  # AreaDetectEvent形式 class_count_change モードでテスト（デフォルト）
#   ./test.sh area_detect        # area_detect_count のエイリアス
#
# オプション:
#   --register-file              # cedix-file テーブルにもレコードを登録（画面確認用）
#
# 例:
#   ./test.sh area_detect_count --register-file
#
# モデル設定:
#   save_video: apac.amazon.nova-pro-v1:0 (動画対応)
#   その他:     apac.anthropic.claude-sonnet-4-20250514-v1:0 (画像)

# 引数解析
export EVENT_MODE=""
export REGISTER_FILE=false

for arg in "$@"; do
    case "$arg" in
        --register-file)
            REGISTER_FILE=true
            ;;
        *)
            if [[ -z "$EVENT_MODE" ]]; then
                EVENT_MODE="$arg"
            fi
            ;;
    esac
done

# デフォルト値
if [[ -z "$EVENT_MODE" ]]; then
    EVENT_MODE="area_detect_count"
fi

# sample_data_create_simple.py のデータに合わせた設定
export CAMERA_ID="d70c4dd7-5a20-4e4b-bedc-1f7a113307fc"
export COLLECTOR_ID="0529caa6-8917-4f13-8dad-3ed30dd34019"
export DETECTOR_ID="bfb2176d-8cdf-40fe-85a3-eb8a0a5bd79b"
export COLLECTOR="hlsYolo"


# 共通設定の取得
source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$source_dir"

# CDK の情報ロード
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

# CloudFormationからBUCKET_NAMEを取得
export BUCKET_NAME=$(aws cloudformation describe-stacks \
    --stack-name $FOUNDATION_STACK \
    --region $AWS_REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`CameraBucketName`].OutputValue' \
    --output text 2>/dev/null)

if [[ -z "$BUCKET_NAME" ]]; then
    echo "Warning: BUCKET_NAMEが取得できませんでした。デフォルト値を使用します。"
    exit 1
fi


### 画像テスト

### 動画テスト
# global.anthropic.claude-sonnet-4-20250514-v1:0 
# global.anthropic.claude-sonnet-4-5-20250929-v1:0
# global.anthropic.claude-haiku-4-5-20251001-v1:0
# apac.anthropic.claude-3-5-sonnet-20241022-v2:0
# apac.anthropic.claude-3-7-sonnet-20250219-v1:0
# apac.anthropic.claude-sonnet-4-20250514-v1:0
# jp.anthropic.claude-haiku-4-5-20251001-v1:0
# jp.anthropic.claude-sonnet-4-5-20250929-v1:0
# us.meta.llama3-2-11b-instruct-v1:0
# us.meta.llama3-2-90b-instruct-v1:0
# us.mistral.pixtral-large-2502-v1:0
# global.amazon.nova-2-lite-v1:0
# apac.amazon.nova-pro-v1:0




# イベントタイプに応じてFILE_TYPE、MODEL、TEST_FILEを設定
case "$EVENT_MODE" in
    save_video)
        export FILE_TYPE="video"
        export TEST_FILE="test/video.mp4"
        export FILE_EXTENSION="mp4"
        export MODEL="apac.amazon.nova-pro-v1:0"
        ;;
    save_image)
        export FILE_TYPE="image"
        export TEST_FILE="test/test.jpeg"
        export FILE_EXTENSION="jpeg"
        export MODEL="jp.anthropic.claude-sonnet-4-5-20250929-v1:0"
        ;;
    class_detect)
        export FILE_TYPE="image"
        export TEST_FILE="test/test.jpeg"
        export FILE_EXTENSION="jpeg"
        export MODEL="apac.anthropic.claude-sonnet-4-20250514-v1:0"
        export AREA_DETECT_METHOD=""
        ;;
    area_detect_track)
        export FILE_TYPE="image"
        export TEST_FILE="test/test.jpeg"
        export FILE_EXTENSION="jpeg"
        export MODEL="global.amazon.nova-2-lite-v1:0"
        export AREA_DETECT_METHOD="track_ids_change"
        ;;
    area_detect_count|area_detect)
        export FILE_TYPE="image"
        export TEST_FILE="test/test.jpeg"
        export FILE_EXTENSION="jpeg"
        export MODEL="global.amazon.nova-2-lite-v1:0"
        export AREA_DETECT_METHOD="class_count_change"
        ;;
    *)
        export FILE_TYPE="image"
        export TEST_FILE="test/test.jpeg"
        export FILE_EXTENSION="jpeg"
        export MODEL="apac.anthropic.claude-sonnet-4-20250514-v1:0"
        ;;
esac

# S3キーを生成
TIMESTAMP=$(date +%Y%m%d/%H%M)
export S3_KEY="collect/${CAMERA_ID}/${COLLECTOR_ID}/${FILE_TYPE}/${TIMESTAMP}/test_file.${FILE_EXTENSION}"
export FILE_ID="test-file-$(date +%s)"

# 現在時刻を生成（UTC）
# CURRENT_TIME_NO_MS: ミリ秒なし（cedix-file, detect-log 用）
# CURRENT_TIME: ミリ秒付き（イベント用）
export CURRENT_TIME_NO_MS=$(date -u +%Y-%m-%dT%H:%M:%S)

# macOS対応: ミリ秒を生成（BSD dateコマンドでは%Nが使えないため）
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOSの場合: ミリ秒を別途生成
    TIMESTAMP_MS=$(( $(date +%s) % 1000 ))
    export CURRENT_TIME="${CURRENT_TIME_NO_MS}.$(printf '%03d' ${TIMESTAMP_MS})Z"
else
    # Linuxの場合: %Nをサポート
    export CURRENT_TIME=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)
fi

echo "================================"
echo "テスト設定"
echo "================================"
echo "EVENT_MODE: $EVENT_MODE"
echo "MODEL: $MODEL"
echo "CAMERA_ID: $CAMERA_ID"
echo "COLLECTOR_ID: $COLLECTOR_ID"
echo "DETECTOR_ID: $DETECTOR_ID"
echo "FILE_TYPE: $FILE_TYPE"
echo "BUCKET_NAME: $BUCKET_NAME"
echo "S3_KEY: $S3_KEY"
echo "AWS_REGION: $AWS_REGION"
echo "STACK_NAME: $STACK_NAME"
if [[ -n "$AREA_DETECT_METHOD" ]]; then
    echo "AREA_DETECT_METHOD: $AREA_DETECT_METHOD"
fi
echo "REGISTER_FILE: $REGISTER_FILE"
echo ""

# テストファイルをS3にアップロード
if [[ -f "${TEST_FILE}" ]]; then
    echo "${TEST_FILE}をS3にアップロード中..."
    aws s3 cp "${TEST_FILE}" "s3://${BUCKET_NAME}/${S3_KEY}" --region ${AWS_REGION}
    if [[ $? -eq 0 ]]; then
        echo "✓ S3アップロード成功: s3://${BUCKET_NAME}/${S3_KEY}"
    else
        echo "✗ S3アップロード失敗"
        exit 1
    fi
else
    echo "Error: ${TEST_FILE} が見つかりません"
    if [[ "$FILE_TYPE" == "video" ]]; then
        echo "ヒント: test/test.mp4 を配置してください"
    else
        echo "ヒント: test/test.jpeg を配置してください"
    fi
    exit 1
fi

# --register-file オプションが指定されている場合、cedix-file にレコードを登録
if [[ "$REGISTER_FILE" == "true" ]]; then
    echo ""
    echo "cedix-file テーブルにレコードを登録中..."
    
    # collector_id_file_type を生成
    COLLECTOR_ID_FILE_TYPE="${COLLECTOR_ID}|${FILE_TYPE}"
    
    # DynamoDB に cedix-file レコードを登録
    # start_time / end_time は CURRENT_TIME_NO_MS を使用（イベントと統一）
    aws dynamodb put-item \
        --table-name cedix-file \
        --region ${AWS_REGION} \
        --item "{
            \"file_id\": {\"S\": \"${FILE_ID}\"},
            \"camera_id\": {\"S\": \"${CAMERA_ID}\"},
            \"collector_id\": {\"S\": \"${COLLECTOR_ID}\"},
            \"file_type\": {\"S\": \"${FILE_TYPE}\"},
            \"collector_id_file_type\": {\"S\": \"${COLLECTOR_ID_FILE_TYPE}\"},
            \"start_time\": {\"S\": \"${CURRENT_TIME_NO_MS}\"},
            \"end_time\": {\"S\": \"${CURRENT_TIME_NO_MS}\"},
            \"s3path\": {\"S\": \"s3://${BUCKET_NAME}/${S3_KEY}\"},
            \"s3path_detect\": {\"S\": \"s3://${BUCKET_NAME}/${S3_KEY}\"}
        }"
    
    if [[ $? -eq 0 ]]; then
        echo "✓ cedix-file 登録成功: file_id=${FILE_ID}, start_time=${CURRENT_TIME_NO_MS}"
    else
        echo "✗ cedix-file 登録失敗"
    fi
fi

echo ""

# Detector設定（sample_data_create_simple.pyと同じ）
DETECTOR_DATA="{
  \"detector_id\": \"${DETECTOR_ID}\",
  \"camera_id\": \"${CAMERA_ID}\",
  \"collector_id\": \"${COLLECTOR_ID}\",
  \"file_type\": \"${FILE_TYPE}\",
  \"trigger_event\": \"AreaDetectEvent\",
  \"detector\": \"bedrock\",
  \"detect_interval\": 5000,
  \"model\": \"${MODEL}\",
  \"system_prompt\": \"あなたは建設現場の安全監視AIです。画像を分析して安全上の問題を検出してください。\",
  \"detect_prompt\": \"画像を詳細に分析して以下を検出してください：1）作業員のヘルメット着用状況（頭部に安全ヘルメットが着用されているか）、2）人の存在。\",
  \"tag_list\": \"人|ヘルメット未着用\",
  \"tag_prompt_list\": {
    \"0\": {
      \"tag_id\": \"tag-test-001\",
      \"tag_name\": \"人\",
      \"tag_prompt\": \"画像内に人が写っている場合\",
      \"notify_flg\": false,
      \"compare_file_flg\": false
    },
    \"1\": {
      \"tag_id\": \"tag-test-002\",
      \"tag_name\": \"ヘルメット未着用\",
      \"tag_prompt\": \"ヘルメットを着用していない作業員が画像内に写っている場合\",
      \"notify_flg\": true,
      \"compare_file_flg\": false
    }
  },
  \"lambda_endpoint_arn\": \"arn:aws:lambda:${AWS_REGION}:$(aws sts get-caller-identity --query Account --output text):function:${STACK_PREFIX}-BedrockFunction\",
  \"compare_file_flg\": false,
  \"max_tokens\": 2048,
  \"temperature\": 0.7,
  \"top_p\": 0.9,
  \"event_notify\": true
}"

# イベントモードに応じてテストを実行
if [[ "$EVENT_MODE" == "save_image" ]]; then
    echo "Lambda関数にSaveImageEventを送信中..."
    curl -XPOST "http://localhost:9000/2015-03-31/functions/function/invocations" \
      -H "Content-Type: application/json" \
      -d "{
        \"source\": \"cedix.collector.hlsyolo\",
        \"detail-type\": \"SaveImageEvent\",
        \"detail\": {
          \"eventType\": \"save_image\",
          \"camera_id\": \"${CAMERA_ID}\",
          \"collector_id\": \"${COLLECTOR_ID}\",
          \"collector_type\": \"hlsYolo\",
          \"detector_id\": \"${DETECTOR_ID}\",
          \"detector_data\": ${DETECTOR_DATA},
          \"file_id\": \"${FILE_ID}\",
          \"s3path\": \"s3://${BUCKET_NAME}/${S3_KEY}\",
          \"s3path_detect\": \"s3://${BUCKET_NAME}/${S3_KEY}\",
          \"start_time\": \"${CURRENT_TIME}\",
          \"end_time\": \"${CURRENT_TIME}\",
          \"timestamp\": \"${CURRENT_TIME}\",
          \"image_info\": {
            \"width\": 1280,
            \"height\": 720,
            \"format\": \"jpeg\"
          }
        }
      }"

elif [[ "$EVENT_MODE" == "save_video" ]]; then
    echo "Lambda関数にSaveVideoEventを送信中..."
    curl -XPOST "http://localhost:9000/2015-03-31/functions/function/invocations" \
      -H "Content-Type: application/json" \
      -d "{
        \"source\": \"cedix.collector.hlsyolo\",
        \"detail-type\": \"SaveVideoEvent\",
        \"detail\": {
          \"eventType\": \"save_video\",
          \"camera_id\": \"${CAMERA_ID}\",
          \"collector_id\": \"${COLLECTOR_ID}\",
          \"collector_type\": \"hlsYolo\",
          \"detector_id\": \"${DETECTOR_ID}\",
          \"detector_data\": ${DETECTOR_DATA},
          \"file_id\": \"${FILE_ID}\",
          \"s3path\": \"s3://${BUCKET_NAME}/${S3_KEY}\",
          \"s3path_detect\": \"s3://${BUCKET_NAME}/${S3_KEY}\",
          \"start_time\": \"${CURRENT_TIME}\",
          \"end_time\": \"${CURRENT_TIME}\",
          \"timestamp\": \"${CURRENT_TIME}\",
          \"video_info\": {
            \"duration\": 60.0,
            \"width\": 1280,
            \"height\": 720,
            \"format\": \"mp4\"
          }
        }
      }"

elif [[ "$EVENT_MODE" == "class_detect" ]]; then
    echo "Lambda関数にClassDetectEventを送信中..."
    curl -XPOST "http://localhost:9000/2015-03-31/functions/function/invocations" \
      -H "Content-Type: application/json" \
      -d "{
        \"source\": \"cedix.collector.hlsyolo\",
        \"detail-type\": \"ClassDetectEvent\",
        \"detail\": {
          \"eventType\": \"class_detect\",
          \"camera_id\": \"${CAMERA_ID}\",
          \"collector_id\": \"${COLLECTOR_ID}\",
          \"collector_type\": \"hlsYolo\",
          \"detector_id\": \"${DETECTOR_ID}\",
          \"detector_data\": ${DETECTOR_DATA},
          \"file_id\": \"${FILE_ID}\",
          \"s3path\": \"s3://${BUCKET_NAME}/${S3_KEY}\",
          \"s3path_detect\": \"s3://${BUCKET_NAME}/${S3_KEY}\",
          \"track_log_id\": \"track-log-test-${FILE_ID}\",
          \"timestamp\": \"${CURRENT_TIME}\",
          \"detections\": {
            \"total_count\": 5,
            \"filtered_count\": 2,
            \"classes\": [\"person\"],
            \"tracks\": [
          {
            \"track_id\": 1,
            \"class\": \"person\",
            \"confidence\": 0.95,
                \"bbox\": [400, 200, 480, 400],
                \"center\": [440, 300]
              },
              {
                \"track_id\": 2,
                \"class\": \"person\",
                \"confidence\": 0.92,
                \"bbox\": [600, 250, 680, 450],
                \"center\": [640, 350]
              }
            ]
          },
          \"image_info\": {
            \"width\": 1280,
            \"height\": 720,
            \"format\": \"jpeg\"
          }
        }
      }"

elif [[ "$EVENT_MODE" == "area_detect_track" ]]; then
    echo "Lambda関数にAreaDetectEventを送信中... (track_ids_change モード)"
    curl -XPOST "http://localhost:9000/2015-03-31/functions/function/invocations" \
      -H "Content-Type: application/json" \
      -d "{
        \"source\": \"cedix.collector.hlsyolo\",
        \"detail-type\": \"AreaDetectEvent\",
        \"detail\": {
          \"eventType\": \"area_detect\",
          \"area_detect_method\": \"track_ids_change\",
          \"camera_id\": \"${CAMERA_ID}\",
          \"collector_id\": \"${COLLECTOR_ID}\",
          \"collector_type\": \"hlsYolo\",
          \"detector_id\": \"${DETECTOR_ID}\",
          \"detector_data\": ${DETECTOR_DATA},
          \"file_id\": \"${FILE_ID}\",
          \"s3path\": \"s3://${BUCKET_NAME}/${S3_KEY}\",
          \"s3path_detect\": \"s3://${BUCKET_NAME}/${S3_KEY}\",
          \"track_log_id\": \"track-log-test-${FILE_ID}\",
          \"time\": \"${CURRENT_TIME}\",
          \"timestamp\": \"${CURRENT_TIME}\",
          \"area_event\": {
            \"type\": \"intrusion\",
            \"intrusion_ids\": [1],
            \"exit_ids\": [],
            \"area_polygon\": [[400, 200], [880, 200], [880, 520], [400, 520]],
            \"area_track_count\": 1
          },
          \"track_alldata\": {
            \"1\": {\"track_id\": 1, \"class\": \"person\", \"confidence\": 0.95, \"bbox\": [400, 200, 480, 400]},
            \"2\": {\"track_id\": 2, \"class\": \"person\", \"confidence\": 0.92, \"bbox\": [600, 250, 680, 450]}
          },
          \"track_classdata\": {
            \"1\": {\"track_id\": 1, \"class\": \"person\", \"confidence\": 0.95, \"bbox\": [400, 200, 480, 400]},
            \"2\": {\"track_id\": 2, \"class\": \"person\", \"confidence\": 0.92, \"bbox\": [600, 250, 680, 450]}
          },
          \"area_in_data\": {
            \"1\": {\"track_id\": 1, \"class\": \"person\", \"confidence\": 0.95, \"bbox\": [400, 200, 480, 400]}
          },
          \"area_out_data\": {
            \"2\": {\"track_id\": 2, \"class\": \"person\", \"confidence\": 0.92, \"bbox\": [600, 250, 680, 450]}
          },
          \"area_in_count\": 1,
          \"area_out_count\": 1,
          \"image_info\": {
            \"width\": 1280,
            \"height\": 720,
            \"format\": \"jpeg\"
          }
        }
      }"

elif [[ "$EVENT_MODE" == "area_detect_count" || "$EVENT_MODE" == "area_detect" ]]; then
    echo "Lambda関数にAreaDetectEventを送信中... (class_count_change モード)"
    curl -XPOST "http://localhost:9000/2015-03-31/functions/function/invocations" \
      -H "Content-Type: application/json" \
      -d "{
        \"source\": \"cedix.collector.hlsyolo\",
        \"detail-type\": \"AreaDetectEvent\",
        \"detail\": {
          \"eventType\": \"area_detect\",
          \"area_detect_method\": \"class_count_change\",
          \"camera_id\": \"${CAMERA_ID}\",
          \"collector_id\": \"${COLLECTOR_ID}\",
          \"collector_type\": \"hlsYolo\",
          \"detector_id\": \"${DETECTOR_ID}\",
          \"detector_data\": ${DETECTOR_DATA},
          \"file_id\": \"${FILE_ID}\",
          \"s3path\": \"s3://${BUCKET_NAME}/${S3_KEY}\",
          \"s3path_detect\": \"s3://${BUCKET_NAME}/${S3_KEY}\",
          \"track_log_id\": \"track-log-test-${FILE_ID}\",
          \"time\": \"${CURRENT_TIME}\",
          \"timestamp\": \"${CURRENT_TIME}\",
          \"area_event\": {
            \"type\": \"intrusion\",
            \"intrusion_ids\": [],
            \"exit_ids\": [],
            \"area_polygon\": [[400, 200], [880, 200], [880, 520], [400, 520]],
            \"area_track_count\": 1
          },
          \"track_alldata\": {
            \"1\": {\"track_id\": 1, \"class\": \"person\", \"confidence\": 0.95, \"bbox\": [400, 200, 480, 400]}
          },
          \"track_classdata\": {
            \"1\": {\"track_id\": 1, \"class\": \"person\", \"confidence\": 0.95, \"bbox\": [400, 200, 480, 400]}
          },
          \"area_in_data\": {
            \"1\": {\"track_id\": 1, \"class\": \"person\", \"confidence\": 0.95, \"bbox\": [400, 200, 480, 400]}
          },
          \"area_out_data\": {},
          \"area_in_count\": 1,
          \"area_out_count\": 0,
          \"image_info\": {
            \"width\": 1280,
            \"height\": 720,
            \"format\": \"jpeg\"
          }
        }
      }"

else
    echo "Error: 不正なEVENT_MODE: $EVENT_MODE"
    echo "使い方: ./test.sh [save_image|save_video|class_detect|area_detect_track|area_detect_count|area_detect]"
    exit 1
fi

echo ""
echo "テスト完了"

