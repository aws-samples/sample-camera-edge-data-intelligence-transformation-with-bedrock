#!/usr/bin/env python3
"""
RTMP Server CloudFormationデプロイスクリプト（Camera Management用）

共有NLB方式: rtmp_nlb_managerを使用してNLBの自動管理とポート割当を行う

引数: camera_id, stream_name, [retention_period]
"""

import boto3
import argparse
import sys
import os
from pathlib import Path

# shared モジュールのパスを追加
# backend/camera_management/deployment/rtmp_server/ → backend/
sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from shared.common import REGION
from rtmp_nlb_manager import RtmpNlbManager


def deploy_rtmp_server(
    camera_id: str,
    stream_name: str,
    retention_period: str = "24",
) -> dict:
    """
    RTMPサーバーをデプロイ（共有NLB方式）
    
    Args:
        camera_id: カメラID
        stream_name: KVS Stream名
        retention_period: KVS保持期間（時間）
        
    Returns:
        dict: {
            'success': bool,
            'stack_name': str,
            'nlb_id': str,
            'port': int,
            'stream_key': str,
            'rtmp_endpoint': str,
            'error': str (エラー時のみ)
        }
    """
    try:
        print("==================================================")
        print("  Camera RTMP Server デプロイ開始（共有NLB方式）  ")
        print("==================================================")
        print()
        
        print(f"リージョン: {REGION}")
        print(f"カメラID: {camera_id}")
        print(f"ストリーム名: {stream_name}")
        print(f"保持期間: {retention_period}時間")
        print()
        
        # RtmpNlbManagerを使用してデプロイ
        manager = RtmpNlbManager(region=REGION)
        result = manager.deploy_rtmp_server(
            camera_id=camera_id,
            stream_name=stream_name,
            retention_period=retention_period
        )
        
        if result['success']:
            print()
            print("✅ RTMPサーバーのデプロイを開始しました")
            print(f"   スタック名: {result['stack_name']}")
            print(f"   NLB ID: {result['nlb_id']}")
            print(f"   ポート: {result['port']}")
            print(f"   ストリームキー: {result['stream_key']}")
            print(f"   RTMP URL: {result['rtmp_endpoint']}")
            print()
            print("⚠️  デプロイ完了を待たずに返却します。")
            print("   ステータスはAPI経由で確認してください。")
        
        return result
        
    except Exception as e:
        print(f"Error: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            'success': False,
            'error': f'予期しないエラーが発生しました: {str(e)}'
        }


def undeploy_rtmp_server(camera_id: str) -> dict:
    """
    RTMPサーバーをアンデプロイ
    
    Args:
        camera_id: カメラID
        
    Returns:
        dict: {
            'success': bool,
            'deleted_stack': str,
            'error': str (エラー時のみ)
        }
    """
    try:
        print("==================================================")
        print("  Camera RTMP Server アンデプロイ開始           ")
        print("==================================================")
        print()
        
        print(f"リージョン: {REGION}")
        print(f"カメラID: {camera_id}")
        print()
        
        # RtmpNlbManagerを使用してアンデプロイ
        manager = RtmpNlbManager(region=REGION)
        result = manager.undeploy_rtmp_server(camera_id=camera_id)
        
        if result['success']:
            print()
            print("✅ RTMPサーバーのアンデプロイが完了しました")
            print(f"   削除したスタック: {result.get('deleted_stack', 'N/A')}")
        
        return result
        
    except Exception as e:
        print(f"Error: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            'success': False,
            'error': f'予期しないエラーが発生しました: {str(e)}'
        }


def get_rtmp_status(camera_id: str) -> dict:
    """
    RTMPサーバーのステータスを取得
    
    Args:
        camera_id: カメラID
        
    Returns:
        dict: ステータス情報
    """
    manager = RtmpNlbManager(region=REGION)
    return manager.get_rtmp_status(camera_id=camera_id)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='RTMP Server デプロイスクリプト（共有NLB方式）')
    subparsers = parser.add_subparsers(dest='command', help='コマンド')
    
    # deploy コマンド
    deploy_parser = subparsers.add_parser('deploy', help='RTMPサーバーをデプロイ')
    deploy_parser.add_argument('camera_id', help='カメラID (例: cam-001)')
    deploy_parser.add_argument('stream_name', help='Kinesis Video Stream名 (例: MyStream)')
    deploy_parser.add_argument('--retention-period', default="24", help='KVSストリーム保持期間（時間）（デフォルト: 24）')
    
    # undeploy コマンド
    undeploy_parser = subparsers.add_parser('undeploy', help='RTMPサーバーをアンデプロイ')
    undeploy_parser.add_argument('camera_id', help='カメラID (例: cam-001)')
    
    # status コマンド
    status_parser = subparsers.add_parser('status', help='RTMPサーバーのステータスを確認')
    status_parser.add_argument('camera_id', help='カメラID (例: cam-001)')
    
    # list-nlbs コマンド
    subparsers.add_parser('list-nlbs', help='全NLBの一覧を表示')
    
    # create-nlb コマンド
    subparsers.add_parser('create-nlb', help='新しいNLBを作成')
    
    args = parser.parse_args()
    
    if args.command == 'deploy':
        result = deploy_rtmp_server(
            args.camera_id,
            args.stream_name,
            args.retention_period
        )
        
        if not result['success']:
            print(f"❌ デプロイに失敗しました: {result.get('error', 'Unknown error')}")
            sys.exit(1)
        
        print()
        print("🎉 デプロイを開始しました！")
        print()
        print("📝 デプロイステータスは以下のコマンドで確認できます:")
        print(f"   python deploy_rtmp_server.py status {args.camera_id}")
        print()
        print("📡 RTMP配信URL:")
        print(f"   {result['rtmp_endpoint']}")
        sys.exit(0)
        
    elif args.command == 'undeploy':
        result = undeploy_rtmp_server(args.camera_id)
        
        if not result['success']:
            print(f"❌ アンデプロイに失敗しました: {result.get('error', 'Unknown error')}")
            sys.exit(1)
        
        print()
        print("🎉 アンデプロイが完了しました！")
        sys.exit(0)
        
    elif args.command == 'status':
        result = get_rtmp_status(args.camera_id)
        print(f"ステータス: {result}")
        sys.exit(0)
        
    elif args.command == 'list-nlbs':
        manager = RtmpNlbManager(region=REGION)
        response = manager.nlb_table.scan()
        print("NLB一覧:")
        print("-" * 60)
        for item in response.get('Items', []):
            print(f"  {item['nlb_id']}: {item.get('used_ports', 0)}/50 ports used")
            print(f"    DNS: {item.get('nlb_dns_name', 'N/A')}")
            print(f"    ポート範囲: {item.get('port_range_start', 'N/A')}-{item.get('port_range_end', 'N/A')}")
            print()
        sys.exit(0)
        
    elif args.command == 'create-nlb':
        manager = RtmpNlbManager(region=REGION)
        result = manager.create_nlb()
        if result:
            print("🎉 NLBを作成しました！")
            print(f"  NLB ID: {result['nlb_id']}")
            print(f"  DNS: {result['nlb_dns_name']}")
            print(f"  ポート範囲: {result['port_range_start']}-{result['port_range_end']}")
        else:
            print("❌ NLBの作成に失敗しました")
            sys.exit(1)
        sys.exit(0)
        
    else:
        parser.print_help()
        sys.exit(1)
