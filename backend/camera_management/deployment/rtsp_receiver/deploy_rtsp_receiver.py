#!/usr/bin/env python3
"""
RTSP Receiver CloudFormationデプロイスクリプト（Camera Management用）

完了を待たないバージョン：CloudFormationスタックの作成を開始して即座に返却
statusはAPI側でCloudFormationから動的に取得する

引数: camera_id, stream_name, rtsp_url, [retention_period], [fragment_duration], [storage_size]
"""

import boto3
import argparse
import sys
import os
from pathlib import Path

# shared モジュールのパスを追加
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'shared'))

from shared.common import *


def deploy_rtsp_receiver_cloudformation_stack(
    camera_id, 
    stream_name, 
    rtsp_url, 
    retention_period="24", 
    fragment_duration="500", 
    storage_size="512"
):
    """
    CloudFormationスタックをデプロイ（完了を待たない）
    
    Args:
        camera_id: カメラID
        stream_name: KVS Stream名
        rtsp_url: RTSP URL
        retention_period: KVS保持期間（時間）
        fragment_duration: フラグメント期間（ミリ秒）
        storage_size: ストレージサイズ（MB）
        
    Returns:
        dict: {
            'success': bool,
            'stack_name': str,
            'error': str (エラー時のみ)
        }
    """
    try:
        print("==================================================")
        print("  Camera RTSP Receiver CloudFormationデプロイ開始  ")
        print("==================================================")
        print()
        
        print(f"リージョン: {REGION}")
        
        # サービス用のスタック名を取得
        stack_name = get_service_stack_name(camera_id, "rtsp-receiver")
        if not stack_name:
            return {
                'success': False,
                'error': 'スタック名の取得に失敗しました'
            }
        
        # テンプレートファイルのパス
        template_file = os.path.join(os.path.dirname(__file__), "template-rtsp-receiver.yaml")
        
        # Parameter Storeから必要なパラメータを一括取得
        parameter_mapping = {
            'EcsTaskRoleArn': '/Cedix/Main/EcsTaskRoleArn',
            'EcsTaskExecutionRoleArn': '/Cedix/Main/EcsTaskExecutionRoleArn',
            'CollectorSecurityGroupId': '/Cedix/Main/CollectorSecurityGroupId',
            'CameraClusterName': '/Cedix/Main/CameraClusterName',
            'PrivateSubnet1Id': '/Cedix/Main/PrivateSubnet1Id',
            'PrivateSubnet2Id': '/Cedix/Main/PrivateSubnet2Id',
            'RtspReceiverRepositoryUri': '/Cedix/Ecr/RtspReceiverRepositoryUri',
            'GstreamerLogMode': '/Cedix/Main/GstreamerLogMode',
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
        ecr_repository_uri = parameter_values['RtspReceiverRepositoryUri']
        repository_uri_with_tag = get_latest_ecr_image_uri(ecr_repository_uri)
        if not repository_uri_with_tag:
            return {
                'success': False,
                'error': 'ECRリポジトリから最新イメージURIが取得できませんでした'
            }
        
        print("取得したパラメータ:")
        for param_name, value in parameter_values.items():
            if param_name != 'RtspReceiverRepositoryUri':
                print(f"  {param_name}: {value}")
        print(f"  使用するイメージ: {repository_uri_with_tag}")
        print(f"  ストリーム名: {stream_name}")
        print(f"  RTSP URL: {rtsp_url}")
        print(f"  保持期間: {retention_period}時間")
        print(f"  フラグメント期間: {fragment_duration}ms")
        print(f"  ストレージサイズ: {storage_size}MB")
        
        # CloudFormationパラメータを構築
        cf_parameters = [
            {'ParameterKey': 'CameraId', 'ParameterValue': camera_id},
            {'ParameterKey': 'RtspReceiverRepositoryUri', 'ParameterValue': repository_uri_with_tag},
            {'ParameterKey': 'EcsTaskRoleArn', 'ParameterValue': parameter_values['EcsTaskRoleArn']},
            {'ParameterKey': 'EcsTaskExecutionRoleArn', 'ParameterValue': parameter_values['EcsTaskExecutionRoleArn']},
            {'ParameterKey': 'CollectorSecurityGroupId', 'ParameterValue': parameter_values['CollectorSecurityGroupId']},
            {'ParameterKey': 'CameraClusterName', 'ParameterValue': parameter_values['CameraClusterName']},
            {'ParameterKey': 'PrivateSubnet1Id', 'ParameterValue': parameter_values['PrivateSubnet1Id']},
            {'ParameterKey': 'PrivateSubnet2Id', 'ParameterValue': parameter_values['PrivateSubnet2Id']},
            {'ParameterKey': 'StreamName', 'ParameterValue': stream_name},
            {'ParameterKey': 'RtspUrl', 'ParameterValue': rtsp_url},
            {'ParameterKey': 'RetentionPeriod', 'ParameterValue': retention_period},
            {'ParameterKey': 'FragmentDuration', 'ParameterValue': fragment_duration},
            {'ParameterKey': 'StorageSize', 'ParameterValue': storage_size},
            {'ParameterKey': 'GstreamerLogMode', 'ParameterValue': parameter_values['GstreamerLogMode']},
            {'ParameterKey': 'LogsKmsKeyArn', 'ParameterValue': parameter_values['LogsKmsKeyArn']}
        ]
        
        print("CloudFormationスタックをデプロイしています...")
        
        # CloudFormationデプロイを実行（完了を待たない）
        deployed_stack_name = deploy_cloudformation_template(
            stack_name, 
            template_file, 
            cf_parameters, 
            resource_type='camera'
        )
        
        if not deployed_stack_name:
            return {
                'success': False,
                'error': 'CloudFormationスタックのデプロイ開始に失敗しました'
            }
        
        print(f"✅ CloudFormationデプロイを開始しました")
        print(f"スタック名: {deployed_stack_name}")
        print(f"カメラID: {camera_id}")
        print(f"ストリーム名: {stream_name}")
        print()
        print("⚠️  デプロイ完了を待たずに返却します。")
        print("   ステータスはAPI経由で確認してください。")
        
        return {
            'success': True,
            'stack_name': deployed_stack_name
        }
        
    except Exception as e:
        print(f"Error: {str(e)}")
        return {
            'success': False,
            'error': f'予期しないエラーが発生しました: {str(e)}'
        }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='RTSP Receiver CloudFormationデプロイスクリプト（Camera Management用）')
    parser.add_argument('camera_id', help='カメラID (例: cam-001)')
    parser.add_argument('stream_name', help='Kinesis Video Stream名 (例: MyStream)')
    parser.add_argument('rtsp_url', help='RTSP入力URL (例: rtsp://192.168.1.100:554/stream)')
    parser.add_argument('--retention-period', default="24", help='KVSストリーム保持期間（時間）（デフォルト: 24）')
    parser.add_argument('--fragment-duration', default="500", help='フラグメント持続時間（ミリ秒）（デフォルト: 500）')
    parser.add_argument('--storage-size', default="512", help='ローカルストレージサイズ（MB）（デフォルト: 512）')
    
    args = parser.parse_args()
    
    # CloudFormationスタックをデプロイ
    result = deploy_rtsp_receiver_cloudformation_stack(
        args.camera_id,
        args.stream_name,
        args.rtsp_url,
        args.retention_period,
        args.fragment_duration,
        args.storage_size
    )
    
    if not result['success']:
        print(f"❌ デプロイに失敗しました: {result['error']}")
        sys.exit(1)
    
    print()
    print("🎉 デプロイを開始しました！")
    print(f"スタック名: {result['stack_name']}")
    print()
    print("📝 デプロイステータスは以下のコマンドで確認できます:")
    print(f"   GET /api/camera/{args.camera_id}/deploy-status")
    sys.exit(0)

