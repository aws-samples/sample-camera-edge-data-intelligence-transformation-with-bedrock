from fastapi import APIRouter, Depends, HTTPException, Request
import os
import json
import hashlib
import hmac
import base64
from botocore.exceptions import ClientError
from shared.models.models import UserInfo
from shared.auth import get_current_user
from shared.common import *

router = APIRouter()

def get_secret_hash(username: str, client_id: str, client_secret: str) -> str:
    """Generate secret hash for Cognito authentication"""
    message = bytes(username + client_id, 'utf-8')
    key = bytes(client_secret, 'utf-8')
    secret_hash = base64.b64encode(hmac.new(key, message, digestmod=hashlib.sha256).digest()).decode()
    return secret_hash

@router.get("/", response_model=UserInfo)
async def read_user_info(user: dict = Depends(get_current_user)):
    """
    Get information about the current authenticated user
    """
    # Extract user information from the Cognito claims
    username = user.get("cognito:username") or user.get("username") or user.get("sub", "unknown")
    email = user.get("email", None)
    
    # Get groups from cognito:groups claim
    groups_str = user.get("cognito:groups", "")
    if isinstance(groups_str, str):
        groups = [g.strip() for g in groups_str.split(",") if g.strip()]
    elif isinstance(groups_str, list):
        groups = groups_str
    else:
        groups = []
    
    # Return all attributes for debugging/development
    attributes = {k: v for k, v in user.items()}
    
    return {
        "username": username,
        "email": email,
        "groups": groups,
        "attributes": attributes
    }

@router.get("/cognito-details")
async def get_cognito_user_details(user: dict = Depends(get_current_user)):
    """
    Cognitoユーザープールから詳細なユーザー情報を取得
    """
    try:
        # 環境変数からCognito設定を取得
        user_pool_id = os.getenv("COGNITO_USER_POOL_ID")
        if not user_pool_id:
            return {"error": "COGNITO_USER_POOL_ID not configured"}
        
        # Cognitoクライアントを作成
        session = create_boto3_session()
        cognito_client = session.client('cognito-idp')
        
        # ユーザー名を取得（複数のフィールドから試行）
        username = user.get("cognito:username") or user.get("username") or user.get("sub")
        if not username:
            return {"error": "Username not found in claims"}
        
        # Cognitoからユーザー詳細を取得
        response = cognito_client.admin_get_user(
            UserPoolId=user_pool_id,
            Username=username
        )
        
        # レスポンスを整理
        user_attributes = {}
        for attr in response.get('UserAttributes', []):
            user_attributes[attr['Name']] = attr['Value']
        
        return {
            "username": response.get('Username'),
            "user_status": response.get('UserStatus'),
            "enabled": response.get('Enabled'),
            "user_create_date": response.get('UserCreateDate').isoformat() if response.get('UserCreateDate') else None,
            "user_last_modified_date": response.get('UserLastModifiedDate').isoformat() if response.get('UserLastModifiedDate') else None,
            "attributes": user_attributes,
            "groups": await get_user_groups_from_cognito(cognito_client, user_pool_id, username)
        }
        
    except ClientError as e:
        error_code = e.response['Error']['Code']
        if error_code == 'UserNotFoundException':
            return {"error": "User not found in Cognito"}
        else:
            return {"error": f"Cognito error: {error_code}"}
    except Exception as e:
        return {"error": f"Unexpected error: {str(e)}"}

async def get_user_groups_from_cognito(cognito_client, user_pool_id: str, username: str):
    """
    Cognitoからユーザーのグループ情報を取得
    """
    try:
        response = cognito_client.admin_list_groups_for_user(
            UserPoolId=user_pool_id,
            Username=username
        )
        
        groups = []
        for group in response.get('Groups', []):
            groups.append({
                "group_name": group.get('GroupName'),
                "description": group.get('Description'),
                "role_arn": group.get('RoleArn'),
                "precedence": group.get('Precedence')
            })
        
        return groups
        
    except ClientError:
        return []

@router.get("/auth-debug")
async def get_auth_debug_info(request: Request, user: dict = Depends(get_current_user)):
    """
    認証デバッグ情報を取得（開発・テスト用）
    """
    auth_mode = os.getenv("AUTH_MODE", "middleware")
    
    debug_info = {
        "auth_mode": auth_mode,
        "user_claims": user,
        "headers": dict(request.headers),
        "cognito_config": {
            "user_pool_id": os.getenv("COGNITO_USER_POOL_ID"),
            "client_id": os.getenv("COGNITO_CLIENT_ID"),
            "region": os.getenv("COGNITO_REGION") or os.getenv("AWS_REGION")
        }
    }
    
    # Mangum + FastAPIでのevent情報も追加
    if hasattr(request, 'scope') and 'aws.event' in request.scope:
        event = request.scope['aws.event']
        debug_info["aws_event"] = {
            "request_context": event.get('requestContext', {}),
            "headers": event.get('headers', {}),
            "query_string_parameters": event.get('queryStringParameters', {})
        }
    
    return debug_info

@router.post("/change-password")
async def change_password(
    old_password: str,
    new_password: str,
    current_user: dict = Depends(get_current_user)
):
    """Change user password"""
    try:
        # Get Cognito configuration
        user_pool_id = os.getenv("COGNITO_USER_POOL_ID")
        client_id = os.getenv("COGNITO_CLIENT_ID")
        client_secret = os.getenv("COGNITO_CLIENT_SECRET")
        
        if not all([user_pool_id, client_id, client_secret]):
            raise HTTPException(status_code=500, detail="Cognito configuration not found")
        
        # Extract username from current user
        username = current_user.get("cognito:username") or current_user.get("username")
        if not username:
            raise HTTPException(status_code=400, detail="Username not found in token")
        
        # Generate secret hash
        secret_hash = get_secret_hash(username, client_id, client_secret)
        
        # Create Cognito client
        session = create_boto3_session()
        cognito_client = session.client('cognito-idp')
        
        try:
            # First, authenticate with old password
            auth_response = cognito_client.admin_initiate_auth(
                UserPoolId=user_pool_id,
                ClientId=client_id,
                AuthFlow='ADMIN_NO_SRP_AUTH',
                AuthParameters={
                    'USERNAME': username,
                    'PASSWORD': old_password,
                    'SECRET_HASH': secret_hash
                }
            )
            
            # If authentication successful, change password
            cognito_client.admin_set_user_password(
                UserPoolId=user_pool_id,
                Username=username,
                Password=new_password,
                Permanent=True
            )
            
            return {"message": "Password changed successfully"}
            
        except cognito_client.exceptions.NotAuthorizedException:
            raise HTTPException(status_code=400, detail="Current password is incorrect")
        except cognito_client.exceptions.InvalidPasswordException as e:
            raise HTTPException(status_code=400, detail=f"Invalid new password: {str(e)}")
        except Exception as e:
            print(f"Cognito error: {str(e)}")
            raise HTTPException(status_code=500, detail="Failed to change password")
    
    except HTTPException:
        raise
    except Exception as e:
        print(f"Change password error: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/user-info")
async def get_user_info(current_user: dict = Depends(get_current_user)):
    """Get current user information"""
    try:
        # Extract relevant user information
        user_info = {
            "username": current_user.get("cognito:username") or current_user.get("username"),
            "email": current_user.get("email"),
            "email_verified": current_user.get("email_verified"),
            "sub": current_user.get("sub"),
            "given_name": current_user.get("given_name"),
            "family_name": current_user.get("family_name"),
            "groups": current_user.get("cognito:groups", []),
            # Add region information for completeness
            "region": REGION
        }
        
        return user_info
    
    except Exception as e:
        print(f"Get user info error: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to get user information")
