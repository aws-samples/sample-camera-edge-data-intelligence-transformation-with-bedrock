#! /bin/bash

# 使い方:
#   ./start.sh              # デフォルト（s3_eventテスト）
#   ./start.sh s3_event     # S3イベント形式でテスト
#   ./start.sh collector_event  # Collector直接呼び出し形式でテスト

# 注意
# bedrock.pyの出力を確認するには、この実行の仕方では面倒。
# ./start-sv.sh をフォアグラウンドで実行することで、出力を確認できるようになるので、
# ./start-sv.shと ./test.shを別々に実行すること。

EVENT_MODE=${1:-s3_event}

./start-sv.sh -d

sleep 5

./test.sh $EVENT_MODE

./stop-sv.sh

