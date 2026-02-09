#!/usr/bin/env python3
"""
S3Yolo CloudFormationデプロイスクリプト

引数: camera_id, collector_id, source_s3_bucket
"""

import boto3
import argparse
import sys
import os
import time
from pathlib import Path

from shared.common import *


def deploy_cloudformation_stack(camera_id, collector_id, source_s3_bucket):
    """CloudFormationスタックをデプロイ"""
    print("==================================================")
    print("  Cedix CloudFormation S3Yolo デプロイ       ")
    print("==================================================")
    print()
    
    print(f"リージョン: {REGION}")
    
    # コレクター用のスタック名を取得（collector_idを含む）
    stack_name = get_collector_stack_name(camera_id, "s3Yolo", collector_id)
    if not stack_name:
        print("Error: スタック名の取得に失敗しました")
        return None
    
    # 設定値（現在のスクリプトと同じディレクトリのテンプレートファイル）
    template_file = os.path.join(os.path.dirname(__file__), "template.yaml")
    
    # Parameter Storeから必要なパラメータを一括取得
    parameter_mapping = {
        'CameraBucketName': '/Cedix/Main/CameraBucketName',
        'S3YoloRepositoryUri': '/Cedix/Ecr/S3YoloRepositoryUri',
        'LambdaCollectorRoleArn': '/Cedix/Main/LambdaCollectorRoleArn',
        'LogsKmsKeyArn': '/Cedix/Main/LogsKmsKeyArn',
    }
    
    # Parameter Storeから値を一括取得
    parameter_values, missing_parameters = get_multiple_parameters(parameter_mapping)
    
    # 必要な値が取得できているかチェック  
    if missing_parameters:
        print(f"Error: 必要なパラメータが取得できませんでした。スタックがデプロイされているか確認してください。")
        for param in missing_parameters:
            print(f"{param}: 取得失敗")
        return None
    
    # ECRリポジトリから最新イメージURIを取得
    ecr_repository_uri = parameter_values['S3YoloRepositoryUri']
    repository_uri_with_tag = get_latest_ecr_image_uri(ecr_repository_uri)
    if not repository_uri_with_tag:
        print("Error: ECRリポジトリから最新イメージURIが取得できませんでした。")
        return None
    
    print("取得したパラメータ:")
    for param_name, value in parameter_values.items():
        if param_name != 'S3YoloRepositoryUri':  # ECRリポジトリURIは別途表示
            print(f"  {param_name}: {value}")
    print(f"  使用するイメージ: {repository_uri_with_tag}")
    print(f"  監視対象S3バケット: {source_s3_bucket}")
    print(f"  監視対象パス: endpoint/{camera_id}/")
    
    # CloudFormationスタックをデプロイ
    print("CloudFormationスタックをデプロイしています...")
    
    # CloudFormationパラメータを構築
    cf_parameters = [
        {'ParameterKey': 'CameraId', 'ParameterValue': camera_id},
        {'ParameterKey': 'CollectorId', 'ParameterValue': collector_id},
        {'ParameterKey': 'SourceS3BucketName', 'ParameterValue': source_s3_bucket},
        {'ParameterKey': 'S3YoloRepositoryUri', 'ParameterValue': repository_uri_with_tag},
        {'ParameterKey': 'BucketName', 'ParameterValue': parameter_values['CameraBucketName']},
        {'ParameterKey': 'LambdaRoleArn', 'ParameterValue': parameter_values['LambdaCollectorRoleArn']},
        {'ParameterKey': 'LogsKmsKeyArn', 'ParameterValue': parameter_values['LogsKmsKeyArn']},
    ]
    
    # 共通関数でCloudFormationデプロイを実行
    deployed_stack_name = deploy_cloudformation_template(stack_name, template_file, cf_parameters, resource_type='collection')
    
    if not deployed_stack_name:
        return None
    
    print(f"スタック名: {stack_name}")
    print(f"カメラID: {camera_id}")
    print(f"監視対象S3バケット: {source_s3_bucket}")
    
    # ソースS3バケットにフォルダ（プレースホルダー）を作成
    try:
        s3_client = boto3.client('s3', region_name=REGION)
        folder_key = f"endpoint/{camera_id}/.keep"
        s3_client.put_object(
            Bucket=source_s3_bucket,
            Key=folder_key,
            Body=b'',
            ContentType='application/octet-stream'
        )
        print(f"✓ ソースバケットにフォルダを作成しました: s3://{source_s3_bucket}/endpoint/{camera_id}/")
    except Exception as e:
        print(f"⚠️ フォルダの作成に失敗しました（処理は継続）: {e}")
    
    return deployed_stack_name


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='S3Yolo CloudFormationデプロイスクリプト')
    parser.add_argument('camera_id', help='カメラID (例: cam-001)')
    parser.add_argument('collector_id', help='コレクターID (例: 98919645-f91c-4674-8d9c-2a18ad38ac73)')
    parser.add_argument('source_s3_bucket', help='監視対象のS3バケット名')
    
    args = parser.parse_args()
    
    # CloudFormationスタックをデプロイ
    stack_name = deploy_cloudformation_stack(args.camera_id, args.collector_id, args.source_s3_bucket)
    
    if not stack_name:
        print("❌ スタックのデプロイに失敗しました。")
        sys.exit(1)
    
    # スタックの完了を待機
    print()
    print(f"スタック '{stack_name}' の完了を待機しています...")
    
    while True:
        status, message = check_stack_completion(stack_name)
        
        print(f"現在のステータス: {message}")
        
        if status == 'SUCCESS':
            print()
            print("🎉 S3Yolo Lambda関数のデプロイが正常に完了しました！")
            print(f"スタック名: {stack_name}")
            print(f"カメラID: {args.camera_id}")
            print(f"コレクターID: {args.collector_id}")
            print(f"監視対象S3バケット: {args.source_s3_bucket}")
            print(f"監視対象パス: endpoint/{args.camera_id}/")
            
            # 保存先バケット名を表示
            print(f"保存先S3バケット: （Parameter Storeから取得済み）")
            
            # スタックの出力を表示
            show_stack_outputs(stack_name)
            
            print()
            print("✅ デプロイ完了")
            break
            
        elif status == 'FAILED':
            print()
            print(f"❌ デプロイに失敗しました: {message}")
            print("CloudFormationコンソールでエラーの詳細を確認してください。")
            sys.exit(1)
            
        elif status in ['NOT_FOUND', 'ERROR']:
            print()
            print(f"❌ エラーが発生しました: {message}")
            sys.exit(1)
            
        elif status in ['IN_PROGRESS', 'UNKNOWN']:
            # 10秒待機してから再チェック
            time.sleep(10)  # nosemgrep: arbitrary-sleep - 意図的な待機（デプロイステータス確認間隔）
            continue
        
        else:
            print(f"⚠️  予期しないステータス: {status} - {message}")
            time.sleep(10)  # nosemgrep: arbitrary-sleep - 意図的な待機（デプロイステータス確認間隔）
            continue
