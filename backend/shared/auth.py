from fastapi import Depends, HTTPException, status, Request, Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
import json
import os
import time
import requests
from typing import Dict, List, Optional
import logging

# ロガー設定
logger = logging.getLogger('api_gateway.auth')

# Security scheme for JWT Bearer token
security = HTTPBearer()

# 環境変数で認証モードを制御
AUTH_MODE = os.getenv("AUTH_MODE", "middleware")  # cognito_authorizer, middleware

# JWKsキャッシュ設定
_jwks_cache: Optional[Dict] = None
_jwks_cache_time: float = 0
JWKS_CACHE_TTL = 3600  # 1時間


def _fetch_jwks_from_cognito() -> Optional[Dict]:
    """
    CognitoからJWKsを取得（内部関数）
    """
    region = os.getenv("AWS_REGION") or os.getenv("COGNITO_REGION")
    user_pool_id = os.getenv("COGNITO_USER_POOL_ID")

    if not region or not user_pool_id:
        logger.warning("Cognito configuration missing, skipping signature verification")
        return None

    jwks_url = f"https://cognito-idp.{region}.amazonaws.com/{user_pool_id}/.well-known/jwks.json"

    try:
        response = requests.get(jwks_url, timeout=5)
        response.raise_for_status()
        logger.info(f"JWKs fetched from {jwks_url}")
        return response.json()
    except Exception as e:
        logger.error(f"Failed to fetch JWKs: {e}")
        return None


def get_cognito_jwks() -> Optional[Dict]:
    """
    Cognito JWKsを取得（キャッシュ付き）
    - 初回または1時間経過後に再取得
    - それ以外はキャッシュを返す
    """
    global _jwks_cache, _jwks_cache_time

    now = time.time()
    if _jwks_cache and (now - _jwks_cache_time) < JWKS_CACHE_TTL:
        return _jwks_cache

    jwks = _fetch_jwks_from_cognito()
    if jwks:
        _jwks_cache = jwks
        _jwks_cache_time = now
    return _jwks_cache  # 取得失敗時は古いキャッシュを返す（あれば）


def _refresh_jwks_cache() -> Optional[Dict]:
    """
    JWKsキャッシュを強制リフレッシュ（キーローテーション対応）
    """
    global _jwks_cache, _jwks_cache_time

    logger.info("Force refreshing JWKs cache")
    jwks = _fetch_jwks_from_cognito()
    if jwks:
        _jwks_cache = jwks
        _jwks_cache_time = time.time()
    return _jwks_cache


def _find_key_by_kid(jwks: Dict, kid: str) -> Optional[Dict]:
    """
    JWKsからkidに一致するキーを検索
    """
    for key in jwks.get("keys", []):
        if key.get("kid") == kid:
            return key
    return None


async def cognito_auth_middleware(request: Request, call_next):
    """
    環境に応じた認証処理を行うミドルウェア
    """
    logger.info(f"Auth middleware: Processing request to {request.url.path}")
    logger.debug(f"Auth mode: {AUTH_MODE}")
    logger.debug(f"Headers: {dict(request.headers)}")
    
    user_info = None
    
    # ミドルウェアでJWT検証を行う
    user_info = await verify_jwt_token(request)
    logger.debug(f"JWT verification user info: {user_info}")
    
    # ユーザー情報をリクエストステートに設定
    if user_info:
        request.state.user = user_info
        logger.info(f"User authenticated: {user_info.get('sub', 'unknown')}")
    else:
        # 認証が必要なエンドポイントでは401エラーを返す
        # ただし、ヘルスチェックなどの公開エンドポイントは除外
        if not is_public_endpoint(request.url.path):
            request.state.user = None
            logger.warning(f"No authentication for protected endpoint: {request.url.path}")
        else:
            logger.debug(f"Public endpoint, no auth required: {request.url.path}")
    
    response = await call_next(request)
    return response


def get_user_from_cognito_authorizer(request: Request) -> Optional[Dict]:
    """
    API Gateway Cognito Authorizerからユーザー情報を取得
    Mangum + FastAPIでのCognito Authorizerクレーム取得
    """
    try:
        # Mangum経由でのAWS Lambda eventアクセス（新しいAPI）
        if hasattr(request, 'scope') and 'aws' in request.scope:
            aws_context = request.scope['aws']
            event = aws_context['event']
            logger.debug(f"AWS event found")
            if 'requestContext' in event and 'authorizer' in event['requestContext']:
                authorizer = event['requestContext']['authorizer']
                logger.debug(f"Authorizer found")
                if 'claims' in authorizer:
                    logger.info(f"Claims found in authorizer")
                    return authorizer['claims']
        
        # 従来の方法（ヘッダー経由）もフォールバック
        if "x-apigateway-context" in request.headers:
            context = json.loads(request.headers["x-apigateway-context"])
            if "authorizer" in context and "claims" in context["authorizer"]:
                return context["authorizer"]["claims"]
                
    except Exception as e:
        logger.error(f"Error getting user from Cognito Authorizer: {e}")
    
    return None


async def verify_jwt_token(request: Request) -> Optional[Dict]:
    """
    JWTトークンを検証してユーザー情報を取得
    - JWKsが取得できる場合: 署名検証付きでデコード
    - JWKsが取得できない場合: 認証エラー
    """
    logger.debug("Verifying JWT token...")
    if "Authorization" not in request.headers:
        logger.debug("No Authorization header found")
        return None

    try:
        auth_header = request.headers["Authorization"]
        logger.debug(f"Authorization header found: {auth_header[:50]}...")

        if not auth_header.startswith("Bearer "):
            logger.warning("Authorization header does not start with 'Bearer '")
            return None

        token = auth_header.replace("Bearer ", "")
        logger.debug(f"Extracted token: {token[:50]}...")

        # JWKsを取得（キャッシュから）
        jwks = get_cognito_jwks()

        if jwks:
            # 署名検証付きでデコード
            try:
                # トークンヘッダーからkidを取得
                unverified_header = jwt.get_unverified_header(token)
                kid = unverified_header.get("kid")

                # 対応する公開鍵を検索
                key = _find_key_by_kid(jwks, kid)

                # キーが見つからない場合、キャッシュをリフレッシュして再試行
                if not key:
                    logger.warning(f"No matching key found for kid: {kid}, refreshing JWKs cache")
                    jwks = _refresh_jwks_cache()
                    if jwks:
                        key = _find_key_by_kid(jwks, kid)

                if key:
                    claims = jwt.decode(
                        token,
                        key,
                        algorithms=["RS256"],
                        options={"verify_aud": False}
                    )
                    logger.info("JWT verified with signature")
                    return claims
                else:
                    logger.error(f"Key not found even after cache refresh for kid: {kid}")
                    return None
            except JWTError as e:
                logger.error(f"JWT signature verification failed: {e}")
                return None
        else:
            # JWKsが取得できない場合は認証エラー
            logger.error("JWKs not available - COGNITO_USER_POOL_ID or AWS_REGION may be missing")
            return None

    except JWTError as e:
        logger.error(f"JWT verification error: {e}")
    except Exception as e:
        logger.error(f"Token decode error: {e}")

    return None


def is_public_endpoint(path: str) -> bool:
    """
    認証不要の公開エンドポイントかどうかを判定
    """
    public_paths = ["/", "/health", "/docs", "/openapi.json"]
    return path in public_paths


def get_current_user(request: Request) -> Dict:
    """
    Get the current authenticated user from the request
    """
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def get_user_groups(user: Dict) -> List[str]:
    """
    Get the user's Cognito groups
    """
    groups = user.get("cognito:groups", "")
    if isinstance(groups, str):
        return [g.strip() for g in groups.split(",") if g.strip()]
    elif isinstance(groups, list):
        return groups
    return []


def requires_group(group_name: str):
    """
    Dependency to check if the user is in a specific group
    """
    def check_group(user: Dict = Depends(get_current_user)) -> Dict:
        groups = get_user_groups(user)
        if group_name not in groups:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"User does not have the required group: {group_name}",
            )
        return user
    return check_group
