"""
URL Generator Utility
DEPLOY_MODEに基づいてS3またはCloudFrontの署名付きURLを生成
CloudFront署名機能も統合
"""

import os
import json
from datetime import datetime, timedelta
from typing import Optional
import base64
import logging
from botocore.signers import CloudFrontSigner

logger = logging.getLogger(__name__)
from botocore.exceptions import ClientError
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from .common import create_boto3_session


# 環境変数から設定を取得
BUCKET_NAME = os.environ.get("BUCKET_NAME", "")
if not BUCKET_NAME:
    raise ValueError("BUCKET_NAME environment variable is required")
DEPLOY_MODE = os.environ.get("DEPLOY_MODE", "development")
CLOUDFRONT_DOMAIN = os.environ.get("CLOUDFRONT_DOMAIN", "")
CLOUDFRONT_KEY_PAIR_ID = os.environ.get("CLOUDFRONT_KEY_PAIR_ID", "")
CLOUDFRONT_SECRET_NAME = os.environ.get("CLOUDFRONT_SECRET_NAME", "")

class URLGenerator:
    """統一されたURL生成インターフェース（CloudFront署名機能統合）"""
    
    def __init__(self):
        self.deploy_mode = DEPLOY_MODE
        session = create_boto3_session()
        self.s3_client = session.client('s3')
        self.secrets_client = session.client('secretsmanager')
        
        # CloudFront設定
        self.cloudfront_domain = CLOUDFRONT_DOMAIN
        self.key_pair_id = CLOUDFRONT_KEY_PAIR_ID
        self.secret_name = CLOUDFRONT_SECRET_NAME
        self._private_key = None
        self._parsed_private_key = None  # パース済み秘密鍵のキャッシュ

        print("URLGenerator --------------------")   
        print(f"DEPLOY_MODE: {self.deploy_mode}")
        print(f"BUCKET_NAME: '{BUCKET_NAME}'")
        print(f"CLOUDFRONT_DOMAIN: {self.cloudfront_domain}")
        print(f"CLOUDFRONT_KEY_PAIR_ID: {self.key_pair_id}")
        print(f"CLOUDFRONT_SECRET_NAME: {self.secret_name}")    
        
        # CloudFront署名機能の初期化チェック
        if self.deploy_mode == 'production':
            try:
                self._validate_cloudfront_config()
            except Exception as e:
                print(f"Error: CloudFront configuration failed: {e}")
                raise Exception(f"Production mode requires complete CloudFront configuration. Missing or invalid: {e}")
    
    def _validate_cloudfront_config(self):
        """CloudFront設定の検証"""
        if not all([self.cloudfront_domain, self.key_pair_id, self.secret_name]):
            raise Exception("CloudFront configuration is incomplete")
    
    def _get_private_key(self) -> str:
        """Secrets Managerから秘密鍵を取得"""
        if self._private_key is None:
            try:
                response = self.secrets_client.get_secret_value(SecretId=self.secret_name)
                secret_data = json.loads(response['SecretString'])
                self._private_key = secret_data['private_key']
            except Exception as e:
                raise Exception(f"Failed to retrieve private key from Secrets Manager: {str(e)}")
        return self._private_key
    
    def _create_cloudfront_policy(self, resource: str, expiration: datetime) -> str:
        """CloudFront署名用のポリシーを作成"""
        policy = {
            "Statement": [
                {
                    "Resource": resource,
                    "Condition": {
                        "DateLessThan": {
                            "AWS:EpochTime": int(expiration.timestamp())
                        }
                    }
                }
            ]
        }
        return json.dumps(policy, separators=(',', ':'))
    
    def _get_parsed_private_key(self):
        """パース済みのRSA秘密鍵を取得（キャッシュ付き）"""
        if self._parsed_private_key is None:
            from rsa import PrivateKey
            private_key_pem = self._get_private_key()
            self._parsed_private_key = PrivateKey.load_pkcs1(private_key_pem.encode('utf-8'))
        return self._parsed_private_key
    
    def _sign_string(self, message: str) -> str:
        """文字列をRSA秘密鍵で署名"""
        try:
            from rsa import sign
            
            private_key = self._get_parsed_private_key()  # キャッシュから取得
            
            signature = sign(message.encode('utf-8'), private_key, 'SHA-1')
            return base64.b64encode(signature).decode('utf-8')
        except Exception as e:
            raise Exception(f"Failed to sign string: {str(e)}")
    
    def _safe_base64_encode(self, data: str) -> str:
        """CloudFront用の安全なBase64エンコード"""
        encoded = base64.b64encode(data.encode('utf-8')).decode('utf-8')
        # CloudFrontで使用するため、URLセーフな文字に置換
        return encoded.replace('+', '-').replace('=', '_').replace('/', '~')
    
    def _generate_cloudfront_signed_url(self, s3_path: str, expiration_hours: int = 1) -> Optional[str]:
        """CloudFront署名付きURLを生成"""
        try:
            self._validate_cloudfront_config()
            
            # S3パスをCloudFrontパスに変換
            cloudfront_path = s3_path.replace(f"s3://{BUCKET_NAME}/", "")
            if cloudfront_path.startswith(f"{BUCKET_NAME}/"):
                cloudfront_path = cloudfront_path.replace(f"{BUCKET_NAME}/", "")
            
            # 新しいCloudFrontパス構造に対応: collect/以下のパスは/collect/パスパターンを使用
            if not cloudfront_path.startswith("collect/"):
                # WebAppバケットのコンテンツ（ルートパス）
                resource = f"https://{self.cloudfront_domain}/{cloudfront_path}"
            else:
                # カメラバケットのコンテンツ（/collect/パス）
                resource = f"https://{self.cloudfront_domain}/{cloudfront_path}"
            
            # 有効期限を設定
            from .timezone_utils import now_utc
            expiration = now_utc() + timedelta(hours=expiration_hours)
            
            # ポリシーを作成
            policy = self._create_cloudfront_policy(resource, expiration)
            
            # ポリシーを署名
            signature = self._sign_string(policy)
            
            # URLパラメータを作成
            policy_b64 = self._safe_base64_encode(policy)
            signature_b64 = signature.replace('+', '-').replace('=', '_').replace('/', '~')
            
            # 署名付きURLを構築
            signed_url = f"{resource}?Policy={policy_b64}&Signature={signature_b64}&Key-Pair-Id={self.key_pair_id}"
            
            return signed_url
            
        except Exception as e:
            print(f"Error generating CloudFront signed URL: {str(e)}")
            return None
    
    def generate_presigned_url(self, s3_path: str, expiration: int = 3600) -> Optional[str]:
        """
        環境に応じて署名付きURLを生成
        
        Args:
            s3_path: S3オブジェクトのパス（例: "s3://bucket/key" または "bucket/key"）
            expiration: 有効期限（秒）
        
        Returns:
            署名付きURL、失敗時はNone
        """
        try:
            print(f"GGGGGGG DEPLOY_MODE {self.deploy_mode}")
            if self.deploy_mode == 'production':
                print("CloudFront 署名付きURL generate--------------------")   
                # CloudFront署名付きURL
                expiration_hours = expiration // 3600 if expiration >= 3600 else 1
                cloudfront_url = self._generate_cloudfront_signed_url(s3_path, expiration_hours)
                if cloudfront_url:
                    return cloudfront_url
                else:
                    print("CloudFront URL generation failed, falling back to S3")
            
            print("s3 署名付きURL generate--------------------")   
            # S3署名付きURL（フォールバック含む）
            return self._generate_s3_presigned_url(s3_path, expiration)
                
        except Exception as e:
            print(f"Error generating presigned URL: {e}")
            # フォールバック: S3署名付きURL
            return self._generate_s3_presigned_url(s3_path, expiration)
    
    def _generate_s3_presigned_url(self, s3_path: str, expiration: int) -> Optional[str]:
        """S3署名付きURLを生成"""
        try:
            logger.debug(f" _generate_s3_presigned_url called with s3_path: {s3_path}")
            
            # S3パスを解析
            if s3_path.startswith('s3://'):
                # s3://bucket/key 形式
                path_parts = s3_path[5:].split('/', 1)
                bucket = path_parts[0]
                key = path_parts[1] if len(path_parts) > 1 else ''
                logger.debug(f" S3 URL format - bucket: {bucket}, key: {key}")
            else:
                # bucket/key 形式（デフォルトバケット使用）
                bucket = BUCKET_NAME
                key = s3_path
                logger.debug(f" Simple format - bucket: {bucket}, key: {key}")
                
            # 空のキーまたはバケット名をチェック
            if not bucket or not key:
                logger.debug(f" Invalid S3 path components - bucket: '{bucket}', key: '{key}'")
                return None
            
            logger.debug(f" Final params - bucket: {bucket}, key: {key}, expiration: {expiration}")
            
            # S3署名付きURL生成
            url = self.s3_client.generate_presigned_url(
                'get_object',
                Params={'Bucket': bucket, 'Key': key},
                ExpiresIn=expiration
            )
            logger.debug(f" Generated S3 presigned URL: {url}")
            return url
            
        except Exception as e:
            print(f"Error generating S3 presigned URL: {e}")
            import traceback
            logger.debug(f" Traceback: {traceback.format_exc()}")
            return None

# グローバルインスタンス
_url_generator_instance = None

def get_url_generator() -> URLGenerator:
    """URLGeneratorのシングルトンインスタンスを取得"""
    global _url_generator_instance
    if _url_generator_instance is None:
        _url_generator_instance = URLGenerator()
    return _url_generator_instance

def generate_presigned_url(s3_path: str, expiration: int = 3600) -> Optional[str]:
    """
    便利関数: 署名付きURLを生成
    
    Args:
        s3_path: S3オブジェクトのパス
        expiration: 有効期限（秒）
    
    Returns:
        署名付きURL
    """
    generator = get_url_generator()
    return generator.generate_presigned_url(s3_path, expiration)

def get_deploy_mode() -> str:
    """現在のデプロイモードを取得"""
    return DEPLOY_MODE

def is_production_mode() -> bool:
    """プロダクションモードかどうかを判定"""
    return get_deploy_mode().lower() == 'production'

def is_development_mode() -> bool:
    """開発モードかどうかを判定"""
    return get_deploy_mode().lower() == 'development'

