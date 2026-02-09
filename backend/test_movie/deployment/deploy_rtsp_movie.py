#!/usr/bin/env python3
"""
RTSP Movie CloudFormationデプロイスクリプト（Test Movie用）

完了を待たないバージョン：CloudFormationスタックの作成を開始して即座に返却
statusはAPI側でCloudFormationから動的に取得する

引数: test_movie_id, test_movie_s3_path
"""

import boto3
import argparse
import sys
import os
from pathlib import Path

from shared.common import *


def deploy_rtsp_movie_cloudformation_stack(test_movie_id, test_movie_s3_path):
    """
    CloudFormationスタックをデプロイ（完了を待たない）
    
    Args:
        test_movie_id: テスト動画ID
        test_movie_s3_path: テスト動画のS3パス
        
    Returns:
        dict: {
            'success': bool,
            'stack_name': str,
            'rtsp_url': str,
            'error': str (エラー時のみ)
        }
    """
    try:
        print("==================================================")
        print("  Test Movie RTSP CloudFormationデプロイ開始  ")
        print("==================================================")
        print()
        
        print(f"リージョン: {REGION}")
        
        # サービス用のスタック名を取得
        stack_name = get_service_stack_name(test_movie_id, "rtsp-movie")
        if not stack_name:
            return {
                'success': False,
                'error': 'スタック名の取得に失敗しました'
            }
        
        # テンプレートファイルのパス
        template_file = os.path.join(os.path.dirname(__file__), "template-rtsp-movie.yaml")
        
        # Parameter Storeから必要なパラメータを一括取得
        parameter_mapping = {
            'EcsTaskRoleArn': '/Cedix/Main/EcsTaskRoleArn',
            'EcsTaskExecutionRoleArn': '/Cedix/Main/EcsTaskExecutionRoleArn',
            'CollectorSecurityGroupId': '/Cedix/Main/CollectorSecurityGroupId',
            'CameraClusterName': '/Cedix/Main/CameraClusterName',
            'PrivateSubnet1Id': '/Cedix/Main/PrivateSubnet1Id',
            'PrivateSubnet2Id': '/Cedix/Main/PrivateSubnet2Id',
            'RtspMovieRepositoryUri': '/Cedix/Ecr/RtspMovieRepositoryUri',
            'CameraBucket': '/Cedix/Main/CameraBucketName',
            'LogsKmsKeyArn': '/Cedix/Main/LogsKmsKeyArn'
        }
        
        # Parameter Storeから値を一括取得
        parameter_values, missing_parameters = get_multiple_parameters(parameter_mapping)
        
        # 必要な値が取得できているかチェック
        if missing_parameters:
            error_msg = f"必要なパラメータが取得できませんでした: {', '.join(missing_parameters)}"
            print(f"Error: {error_msg}")
            return {
                'success': False,
                'error': error_msg
            }
        
        # ECRリポジトリから最新イメージURIを取得
        ecr_repository_uri = parameter_values['RtspMovieRepositoryUri']
        repository_uri_with_tag = get_latest_ecr_image_uri(ecr_repository_uri)
        if not repository_uri_with_tag:
            return {
                'success': False,
                'error': 'ECRリポジトリから最新イメージURIが取得できませんでした'
            }
        
        print("取得したパラメータ:")
        for param_name, value in parameter_values.items():
            if param_name != 'RtspMovieRepositoryUri':
                print(f"  {param_name}: {value}")
        print(f"  使用するイメージ: {repository_uri_with_tag}")
        print(f"  テスト動画S3パス: {test_movie_s3_path}")
        
        # CloudFormationパラメータを構築
        # 注意: CameraId パラメータを TestMovieId に変更
        cf_parameters = [
            {'ParameterKey': 'CameraId', 'ParameterValue': test_movie_id},
            {'ParameterKey': 'RtspMovieRepositoryUri', 'ParameterValue': repository_uri_with_tag},
            {'ParameterKey': 'EcsTaskRoleArn', 'ParameterValue': parameter_values['EcsTaskRoleArn']},
            {'ParameterKey': 'EcsTaskExecutionRoleArn', 'ParameterValue': parameter_values['EcsTaskExecutionRoleArn']},
            {'ParameterKey': 'CollectorSecurityGroupId', 'ParameterValue': parameter_values['CollectorSecurityGroupId']},
            {'ParameterKey': 'CameraClusterName', 'ParameterValue': parameter_values['CameraClusterName']},
            {'ParameterKey': 'PrivateSubnet1Id', 'ParameterValue': parameter_values['PrivateSubnet1Id']},
            {'ParameterKey': 'PrivateSubnet2Id', 'ParameterValue': parameter_values['PrivateSubnet2Id']},
            {'ParameterKey': 'MovieS3Path', 'ParameterValue': test_movie_s3_path},
            {'ParameterKey': 'CameraBucket', 'ParameterValue': parameter_values['CameraBucket']},
            {'ParameterKey': 'LogsKmsKeyArn', 'ParameterValue': parameter_values['LogsKmsKeyArn']}
        ]
        
        print("CloudFormationスタックをデプロイしています...")
        
        # CloudFormationデプロイを実行（完了を待たない）
        deployed_stack_name = deploy_cloudformation_template(
            stack_name, 
            template_file, 
            cf_parameters, 
            resource_type='test-movie'
        )
        
        if not deployed_stack_name:
            return {
                'success': False,
                'error': 'CloudFormationスタックのデプロイ開始に失敗しました'
            }
        
        # RTSP URLを生成
        rtsp_url = f"rtsp://{test_movie_id}-rtsp-movie:8554/camera"
        
        print(f"✅ CloudFormationデプロイを開始しました")
        print(f"スタック名: {deployed_stack_name}")
        print(f"RTSP URL: {rtsp_url}")
        print(f"テスト動画ID: {test_movie_id}")
        print()
        print("⚠️  デプロイ完了を待たずに返却します。")
        print("   ステータスはAPI経由で確認してください。")
        
        return {
            'success': True,
            'stack_name': deployed_stack_name,
            'rtsp_url': rtsp_url
        }
        
    except Exception as e:
        print(f"Error: {str(e)}")
        return {
            'success': False,
            'error': f'予期しないエラーが発生しました: {str(e)}'
        }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='RTSP Movie CloudFormationデプロイスクリプト（Test Movie用）')
    parser.add_argument('test_movie_id', help='テスト動画ID (例: test-movie-001)')
    parser.add_argument('test_movie_s3_path', help='テスト動画のS3パス (例: s3://bucket/path/to/movie.mp4)')
    
    args = parser.parse_args()
    
    # CloudFormationスタックをデプロイ
    result = deploy_rtsp_movie_cloudformation_stack(
        args.test_movie_id,
        args.test_movie_s3_path
    )
    
    if not result['success']:
        print(f"❌ デプロイに失敗しました: {result['error']}")
        sys.exit(1)
    
    print()
    print("🎉 デプロイを開始しました！")
    print(f"スタック名: {result['stack_name']}")
    print(f"RTSP URL: {result['rtsp_url']}")
    print()
    print("📝 デプロイステータスは以下のコマンドで確認できます:")
    print(f"   GET /api/test-movie/{args.test_movie_id}/status")
    sys.exit(0)

