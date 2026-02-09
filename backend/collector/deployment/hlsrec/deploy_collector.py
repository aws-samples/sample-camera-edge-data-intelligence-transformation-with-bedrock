#!/usr/bin/env python3
"""
HlsRec CloudFormationデプロイスクリプト
deploy_hlsrec.shの147行目以降をPython化したもの

引数: camera_id, collector_id
"""

import boto3
import argparse
import sys
import os
import time
import sys
from pathlib import Path

from shared.common import *
from shared.database import get_collector_by_id


def deploy_cloudformation_stack(camera_id, collector_id):
    """CloudFormationスタックをデプロイ"""
    print("=================================================="
          "  Cedix CloudFormationデプロイ  "
          "==================================================")
    print()
    
    print(f"リージョン: {REGION}")
    
    # コレクター用のスタック名を取得（collector_idを含む）
    stack_name = get_collector_stack_name(camera_id, "hlsrec", collector_id)
    if not stack_name:
        print("Error: スタック名の取得に失敗しました")
        return None
    
    # コレクター情報を取得してcollector_modeに応じたメモリ・CPU設定を決定
    collector_info = get_collector_by_id(collector_id)
    if not collector_info:
        print(f"Error: コレクター情報が取得できませんでした（collector_id: {collector_id}）")
        return None
    
    collector_mode = collector_info.get('collector_mode', 'image')
    
    # collector_modeに応じてメモリとCPUを決定
    if collector_mode in ['video', 'image_and_video']:
        task_memory = 7168  # 7GB（動画バッファリングに必要）
        task_cpu = 1024     # 1 vCPU（7GBメモリの最小CPU要件）
        print(f"📹 collector_mode={collector_mode} のため、高メモリ構成を使用: {task_memory}MB / {task_cpu} CPU")
    else:  # 'image' or その他
        task_memory = 512   # 512MB（画像のみの場合）
        task_cpu = 256      # 0.25 vCPU
        print(f"📷 collector_mode={collector_mode} のため、標準構成を使用: {task_memory}MB / {task_cpu} CPU")
    
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
        'HlsRecRepositoryUri': '/Cedix/Ecr/HlsRecRepositoryUri',
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
    ecr_repository_uri = parameter_values['HlsRecRepositoryUri']
    repository_uri_with_tag = get_latest_ecr_image_uri(ecr_repository_uri)
    if not repository_uri_with_tag:
        print("Error: ECRリポジトリから最新イメージURIが取得できませんでした。")
        return None
    
    print("取得したパラメータ:")
    for param_name, value in parameter_values.items():
        if param_name != 'HlsRecRepositoryUri':  # ECRリポジトリURIは別途表示
            print(f"  {param_name}: {value}")
    print(f"  使用するイメージ: {repository_uri_with_tag}")
    
    # CloudFormationスタックをデプロイ
    print("CloudFormationスタックをデプロイしています...")
    
    # CloudFormationパラメータを構築
    cf_parameters = [
        {'ParameterKey': 'CameraId', 'ParameterValue': camera_id},
        {'ParameterKey': 'CollectorId', 'ParameterValue': collector_id},
        {'ParameterKey': 'HlsRecRepositoryUri', 'ParameterValue': repository_uri_with_tag},
        {'ParameterKey': 'EcsTaskRoleArn', 'ParameterValue': parameter_values['EcsTaskRoleArn']},
        {'ParameterKey': 'EcsTaskExecutionRoleArn', 'ParameterValue': parameter_values['EcsTaskExecutionRoleArn']},
        {'ParameterKey': 'CollectorSecurityGroupId', 'ParameterValue': parameter_values['CollectorSecurityGroupId']},
        {'ParameterKey': 'CameraClusterName', 'ParameterValue': parameter_values['CameraClusterName']},
        {'ParameterKey': 'PrivateSubnet1Id', 'ParameterValue': parameter_values['PrivateSubnet1Id']},
        {'ParameterKey': 'PrivateSubnet2Id', 'ParameterValue': parameter_values['PrivateSubnet2Id']},
        {'ParameterKey': 'BucketName', 'ParameterValue': parameter_values['CameraBucketName']},
        {'ParameterKey': 'TaskMemory', 'ParameterValue': str(task_memory)},
        {'ParameterKey': 'TaskCpu', 'ParameterValue': str(task_cpu)},
        {'ParameterKey': 'LogsKmsKeyArn', 'ParameterValue': parameter_values['LogsKmsKeyArn']}
    ]
    
    # 共通関数でCloudFormationデプロイを実行
    deployed_stack_name = deploy_cloudformation_template(stack_name, template_file, cf_parameters, resource_type='collection')
    
    if not deployed_stack_name:
        return None
    
    print(f"スタック名: {stack_name}")
    print(f"カメラID: {camera_id}")
    
    return deployed_stack_name



if __name__ == "__main__":

    parser = argparse.ArgumentParser(description='HlsRec CloudFormationデプロイスクリプト')
    parser.add_argument('camera_id', help='カメラID (例: cam-001)')
    parser.add_argument('collector_id', help='コレクターID (例: 98919645-f91c-4674-8d9c-2a18ad38ac73)')
    
    args = parser.parse_args()
    
    # CloudFormationスタックをデプロイ
    stack_name = deploy_cloudformation_stack(args.camera_id, args.collector_id)
    
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
            print("🎉 HlsRec ECSサービスのデプロイが正常に完了しました！")
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
