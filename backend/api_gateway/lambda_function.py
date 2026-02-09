import os
import sys
import logging

# Lambda環境でのログ設定を最初に行う
# 既存のルートロガー設定をクリア
root_logger = logging.getLogger()
if root_logger.handlers:
    for handler in root_logger.handlers:
        root_logger.removeHandler(handler)

# 新しいハンドラーを追加（標準出力に出力）
console_handler = logging.StreamHandler(sys.stdout)
console_handler.setFormatter(
    logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
)
root_logger.addHandler(console_handler)
root_logger.setLevel(logging.INFO)

# 環境変数からログレベルを取得（デバッグ用）
log_level = os.getenv('LOG_LEVEL', 'INFO').upper()
if log_level == 'DEBUG':
    root_logger.setLevel(logging.DEBUG)

# uvicornのロガーも設定
uvicorn_logger = logging.getLogger("uvicorn")
uvicorn_logger.setLevel(logging.INFO)
uvicorn_access_logger = logging.getLogger("uvicorn.access")
uvicorn_access_logger.setLevel(logging.INFO)

# FastAPIのロガーも設定
fastapi_logger = logging.getLogger("fastapi")
fastapi_logger.setLevel(logging.INFO)

logging.info("Lambda function initialized with logging configuration")

# Add the api directory to the Python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Import the FastAPI app and Mangum handler
import importlib.util
import os

# Load the main module dynamically to handle hyphenated directory name
spec = importlib.util.spec_from_file_location(
    "main", 
    os.path.join(os.path.dirname(__file__), "api", "main.py")
)
main_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(main_module)

app = main_module.app
handler = main_module.handler

# Lambda handler function
def lambda_handler(event, context):
    """
    AWS Lambda handler function
    """
    # リクエスト情報をログ出力
    logging.info(f"Lambda invoked - Request ID: {context.aws_request_id}")
    logging.info(f"HTTP Method: {event.get('requestContext', {}).get('http', {}).get('method', 'UNKNOWN')}")
    logging.info(f"Path: {event.get('requestContext', {}).get('http', {}).get('path', 'UNKNOWN')}")
    
    try:
        result = handler(event, context)
        logging.info(f"Lambda completed - Status: {result.get('statusCode', 'UNKNOWN')}")
        return result
    except Exception as e:
        logging.error(f"Lambda error: {str(e)}", exc_info=True)
        raise 