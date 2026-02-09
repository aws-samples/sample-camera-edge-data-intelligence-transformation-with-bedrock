#!/bin/bash

# Cedix Ingestion 統合テストスクリプト

cd "$(dirname "$0")"

echo "=================================================="
echo "  Cedix Ingestion Integration Test"
echo "=================================================="
echo ""

# 環境変数チェック
if [ -z "$OPENSEARCH_ENDPOINT" ]; then
    echo "✗ ERROR: OPENSEARCH_ENDPOINT environment variable is not set."
    echo ""
    echo "Please set it before running tests:"
    echo "  export OPENSEARCH_ENDPOINT=<your-opensearch-endpoint>"
    echo ""
    echo "Example:"
    echo "  export OPENSEARCH_ENDPOINT=xxxxx.ap-northeast-1.aoss.amazonaws.com"
    exit 1
fi

echo "Configuration:"
echo "  OpenSearch Endpoint: $OPENSEARCH_ENDPOINT"
echo "  Index Name: cedix-detect-log"
echo "  DLQ Bucket: ${DLQ_BUCKET:-test-bucket}"
echo ""

# コンテナが起動しているか確認
if ! docker-compose ps | grep -q "cedix-ingestion-test"; then
    echo "Starting container..."
    ./start.sh
    echo ""
fi

# Test 1: OpenSearch接続テスト
echo "=================================================="
echo "Test 1: OpenSearch Connection Test"
echo "=================================================="
echo ""

docker-compose exec ingestion python3 -c "
import sys
from opensearch_client import OpenSearchClient
import os

try:
    endpoint = os.environ['OPENSEARCH_ENDPOINT']
    index_name = os.environ['INDEX_NAME']
    
    print(f'Connecting to OpenSearch: {endpoint}')
    client = OpenSearchClient(endpoint, index_name)
    print('✓ OpenSearch connection successful')
    print()
    
    # インデックスの存在確認
    exists = client.index_exists()
    if exists:
        print(f'✓ Index \"{index_name}\" exists')
    else:
        print(f'ℹ Index \"{index_name}\" does not exist (will be created on first insert)')
    print()
    
except Exception as e:
    print(f'✗ OpenSearch connection failed: {e}')
    import traceback
    traceback.print_exc()
    sys.exit(1)
"

if [ $? -ne 0 ]; then
    echo ""
    echo "✗ OpenSearch connection test failed"
    exit 1
fi

# Test 2: DynamoDB変換テスト
echo "=================================================="
echo "Test 2: DynamoDB Converter Test"
echo "=================================================="
echo ""

docker-compose exec ingestion python3 -c "
import sys
from dynamodb_converter import convert_dynamodb_to_dict

test_cases = [
    {
        'name': 'String type',
        'input': {'name': {'S': 'テスト'}},
        'expected': {'name': 'テスト'}
    },
    {
        'name': 'Number type (int)',
        'input': {'count': {'N': '123'}},
        'expected': {'count': 123}
    },
    {
        'name': 'Number type (float)',
        'input': {'price': {'N': '123.45'}},
        'expected': {'price': 123.45}
    },
    {
        'name': 'Boolean type',
        'input': {'enabled': {'BOOL': True}},
        'expected': {'enabled': True}
    },
    {
        'name': 'Null type',
        'input': {'data': {'NULL': True}},
        'expected': {'data': None}
    }
]

failed = 0
for test in test_cases:
    result = convert_dynamodb_to_dict(test['input'])
    if result == test['expected']:
        print(f'✓ {test[\"name\"]}: PASS')
    else:
        print(f'✗ {test[\"name\"]}: FAIL')
        print(f'  Expected: {test[\"expected\"]}')
        print(f'  Got: {result}')
        failed += 1

print()
if failed == 0:
    print(f'✓ All {len(test_cases)} converter tests passed')
else:
    print(f'✗ {failed} out of {len(test_cases)} tests failed')
    sys.exit(1)
"

if [ $? -ne 0 ]; then
    echo ""
    echo "✗ DynamoDB converter test failed"
    exit 1
fi

echo ""

# Test 3: Lambda関数テスト（サンプルイベント）
echo "=================================================="
echo "Test 3: Lambda Function Test (Sample Event)"
echo "=================================================="
echo ""

./test-run.sh

if [ $? -ne 0 ]; then
    echo ""
    echo "✗ Lambda function test failed"
    exit 1
fi

# テスト完了
echo ""
echo "=================================================="
echo "  ✓ All Integration Tests Passed"
echo "=================================================="
echo ""
echo "Summary:"
echo "  • OpenSearch connection: OK"
echo "  • DynamoDB converter: OK"
echo "  • Lambda function: OK"
echo ""

