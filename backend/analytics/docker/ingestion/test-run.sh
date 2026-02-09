#!/bin/bash

# Lambda関数のローカルテスト実行スクリプト

cd "$(dirname "$0")"

echo "=================================================="
echo "  Lambda Function Test (Sample Event)"
echo "=================================================="
echo ""

# サンプルイベントファイルの確認
if [ ! -f "test/sample_stream_event.json" ]; then
    echo "✗ ERROR: test/sample_stream_event.json not found"
    exit 1
fi

echo "Running Lambda function with sample DynamoDB Stream event..."
echo ""

docker-compose exec ingestion python3 -c "
import json
import sys
import lambda_function

# サンプルイベントの読み込み
try:
    with open('/test/sample_stream_event.json', 'r') as f:
        event = json.load(f)
except Exception as e:
    print(f'✗ Error loading sample event: {e}')
    sys.exit(1)

# Lambda実行
print('=' * 50)
print('Executing Lambda handler...')
print('=' * 50)
print()

try:
    # コンテキストのモック
    class Context:
        aws_request_id = 'test-request-id-12345'
        function_name = 'test-ingestion-function'
    
    context = Context()
    result = lambda_function.handler(event, context)
    
    print()
    print('=' * 50)
    print('Lambda execution completed successfully')
    print('=' * 50)
    print()
    print('Result:')
    print(json.dumps(result, indent=2, ensure_ascii=False))
    print()
    
except Exception as e:
    print()
    print('=' * 50)
    print('✗ Lambda execution failed')
    print('=' * 50)
    print()
    print(f'Error: {e}')
    print()
    import traceback
    traceback.print_exc()
    sys.exit(1)
"

if [ $? -eq 0 ]; then
    echo ""
    echo "✓ Test completed successfully"
else
    echo ""
    echo "✗ Test failed"
    exit 1
fi

