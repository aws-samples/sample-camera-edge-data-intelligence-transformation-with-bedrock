#!/usr/bin/env python3
"""
HlsYolo CloudFormationデプロイスクリプト
HLS+YOLOトラッキング機能付き画像収集サービスのデプロイ

引数: camera_id, collector_id
"""

import boto3
import argparse
import sys
import os
import time
from pathlib import Path

from shared.common import *


def deploy_cloudformation_stack(camera_id, collector_id, enable_periodic_save=False):
    """CloudFormationスタックをデプロイ"""
    print("=================================================="
          "  Cedix CloudFormationデプロイ  "
          "==================================================")
    print()
    
    print(f"リージョン: {REGION}")
    
    # コレクター用のスタック名を取得（collector_idを含む）
    stack_name = get_collector_stack_name(camera_id, "hlsyolo", collector_id)
    if not stack_name:
        print("Error: スタック名の取得に失敗しました")
        return None
    
    # 設定値（現在のスクリプトと同じディレクトリのテンプレートファイル）
    template_file = os.path.join(os.path.dirname(__file__), "template.yaml")
    
    # Parameter Storeから必要なパラメータを一括取得
    parameter_mapping = {
        'EcsTaskRoleArn': '/Cedix/Main/EcsTaskRoleArn',
        'EcsTaskExecutionRoleArn': '/Cedix/Main/EcsTaskExecutionRoleArn',
        'CollectorSecurityGroupId': '/Cedix/Main/CollectorSecurityGroupId',
        'CameraClusterName': '/Cedix/Main/CameraClusterName',
        'PrivateSubnet1Id': '/Cedix/Main/PrivateSubnet1Id',
        'PrivateSubnet2Id': '/Cedix/Main/PrivateSubnet2Id',
        'CameraBucketName': '/Cedix/Main/CameraBucketName',
        'HlsYoloRepositoryUri': '/Cedix/Ecr/HlsYoloRepositoryUri',
        'LogsKmsKeyArn': '/Cedix/Main/LogsKmsKeyArn'
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
    ecr_repository_uri = parameter_values['HlsYoloRepositoryUri']
    repository_uri_with_tag = get_latest_ecr_image_uri(ecr_repository_uri)
    if not repository_uri_with_tag:
        print("Error: ECRリポジトリから最新イメージURIが取得できませんでした。")
        return None
    
    print("取得したパラメータ:")
    for param_name, value in parameter_values.items():
        if param_name != 'HlsYoloRepositoryUri':  # ECRリポジトリURIは別途表示
            print(f"  {param_name}: {value}")
    print(f"  使用するイメージ: {repository_uri_with_tag}")
    
    # CloudFormationスタックをデプロイ
    print("CloudFormationスタックをデプロイしています...")
    
    # CloudFormationパラメータを構築
    cf_parameters = [
        {'ParameterKey': 'CameraId', 'ParameterValue': camera_id},
        {'ParameterKey': 'CollectorId', 'ParameterValue': collector_id},
        {'ParameterKey': 'HlsYoloRepositoryUri', 'ParameterValue': repository_uri_with_tag},
        {'ParameterKey': 'EcsTaskRoleArn', 'ParameterValue': parameter_values['EcsTaskRoleArn']},
        {'ParameterKey': 'EcsTaskExecutionRoleArn', 'ParameterValue': parameter_values['EcsTaskExecutionRoleArn']},
        {'ParameterKey': 'CollectorSecurityGroupId', 'ParameterValue': parameter_values['CollectorSecurityGroupId']},
        {'ParameterKey': 'CameraClusterName', 'ParameterValue': parameter_values['CameraClusterName']},
        {'ParameterKey': 'PrivateSubnet1Id', 'ParameterValue': parameter_values['PrivateSubnet1Id']},
        {'ParameterKey': 'PrivateSubnet2Id', 'ParameterValue': parameter_values['PrivateSubnet2Id']},
        {'ParameterKey': 'BucketName', 'ParameterValue': parameter_values['CameraBucketName']},
        {'ParameterKey': 'LogsKmsKeyArn', 'ParameterValue': parameter_values['LogsKmsKeyArn']},
        {'ParameterKey': 'EnablePeriodicSave', 'ParameterValue': 'true' if enable_periodic_save else 'false'}
    ]
    
    # 共通関数でCloudFormationデプロイを実行
    deployed_stack_name = deploy_cloudformation_template(stack_name, template_file, cf_parameters, resource_type='collection')
    
    if not deployed_stack_name:
        return None
    
    print(f"スタック名: {stack_name}")
    print(f"カメラID: {camera_id}")
    
    return deployed_stack_name



if __name__ == "__main__":

    parser = argparse.ArgumentParser(description='HlsYolo CloudFormationデプロイスクリプト')
    parser.add_argument('camera_id', help='カメラID (例: cam-001)')
    parser.add_argument('collector_id', help='コレクターID (例: 98919645-f91c-4674-8d9c-2a18ad38ac73)')
    parser.add_argument('--enable-periodic-save', action='store_true', default=False,
                        help='定期画像保存を有効にする（デフォルト: 無効）')
    
    args = parser.parse_args()
    
    # CloudFormationスタックをデプロイ
    stack_name = deploy_cloudformation_stack(args.camera_id, args.collector_id, args.enable_periodic_save)
    
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
            print("🎉 HlsYolo ECSサービスのデプロイが正常に完了しました！")
            print(f"スタック名: {stack_name}")
            print(f"カメラID: {args.camera_id}")
            print(f"コレクターID: {args.collector_id}")
            
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

