#!/usr/bin/env python3
"""
既存のdetect-logデータに collector_id_detector_id 属性を追加するマイグレーションスクリプト

使用方法:
    python add_collector_id_detector_id.py [--dry-run]

オプション:
    --dry-run: 実際には更新せず、対象件数のみ表示
"""
import boto3
import argparse
import sys
from boto3.dynamodb.conditions import Attr

# テーブル名
TABLE_NAME = 'cedix-detect-log'
REGION = 'ap-northeast-1'


def migrate_detect_logs(dry_run=False):
    """既存データに collector_id_detector_id 属性を追加"""
    
    dynamodb = boto3.resource('dynamodb', region_name=REGION)
    table = dynamodb.Table(TABLE_NAME)
    
    print(f"テーブル: {TABLE_NAME}")
    print(f"リージョン: {REGION}")
    print(f"Dry run: {dry_run}")
    print("-" * 50)
    
    # collector_id_detector_id が存在しないアイテムのみスキャン
    print("対象アイテムをスキャン中...")
    
    response = table.scan(
        FilterExpression=Attr('collector_id_detector_id').not_exists(),
        ProjectionExpression='detect_log_id, collector_id, detector_id'
    )
    
    items = response.get('Items', [])
    
    # ページネーション対応
    page_count = 1
    while 'LastEvaluatedKey' in response:
        page_count += 1
        print(f"  ページ {page_count} を読み込み中... (現在 {len(items)} 件)")
        response = table.scan(
            FilterExpression=Attr('collector_id_detector_id').not_exists(),
            ProjectionExpression='detect_log_id, collector_id, detector_id',
            ExclusiveStartKey=response['LastEvaluatedKey']
        )
        items.extend(response.get('Items', []))
    
    print(f"対象アイテム数: {len(items)}")
    print("-" * 50)
    
    if len(items) == 0:
        print("マイグレーション対象のアイテムはありません。")
        return
    
    if dry_run:
        print("[Dry run] 実際の更新は行いません。")
        # サンプルを表示
        print("\nサンプル（最初の5件）:")
        for item in items[:5]:
            collector_id = item.get('collector_id', 'N/A')
            detector_id = item.get('detector_id', 'N/A')
            if collector_id != 'N/A' and detector_id != 'N/A':
                new_key = f"{collector_id}|{detector_id}"
            else:
                new_key = 'N/A (missing fields)'
            print(f"  {item['detect_log_id']}: collector_id_detector_id = {new_key}")
        return
    
    # 更新処理
    print("更新を開始します...")
    migrated = 0
    skipped = 0
    errors = 0
    
    for i, item in enumerate(items):
        collector_id = item.get('collector_id')
        detector_id = item.get('detector_id')
        
        if collector_id and detector_id:
            collector_id_detector_id = f"{collector_id}|{detector_id}"
            
            try:
                table.update_item(
                    Key={'detect_log_id': item['detect_log_id']},
                    UpdateExpression='SET collector_id_detector_id = :val',
                    ExpressionAttributeValues={':val': collector_id_detector_id},
                    ConditionExpression=Attr('collector_id_detector_id').not_exists()
                )
                migrated += 1
            except dynamodb.meta.client.exceptions.ConditionalCheckFailedException:
                # 既に存在する場合はスキップ
                skipped += 1
            except Exception as e:
                print(f"Error: Failed to update {item['detect_log_id']}: {e}")
                errors += 1
        else:
            print(f"Warning: Missing collector_id or detector_id for {item['detect_log_id']}")
            skipped += 1
        
        # 進捗表示
        if (i + 1) % 1000 == 0:
            print(f"  進捗: {i + 1}/{len(items)} (migrated: {migrated}, skipped: {skipped}, errors: {errors})")
    
    print("-" * 50)
    print(f"マイグレーション完了!")
    print(f"  成功: {migrated}")
    print(f"  スキップ: {skipped}")
    print(f"  エラー: {errors}")


def main():
    parser = argparse.ArgumentParser(
        description='既存のdetect-logデータに collector_id_detector_id 属性を追加'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='実際には更新せず、対象件数のみ表示'
    )
    parser.add_argument(
        '--force',
        action='store_true',
        help='確認プロンプトをスキップ'
    )
    
    args = parser.parse_args()
    
    # 確認プロンプト
    if not args.dry_run and not args.force:
        print("=" * 50)
        print("WARNING: このスクリプトはDynamoDBのデータを更新します。")
        print("=" * 50)
        response = input("続行しますか？ (yes/no): ")
        if response.lower() != 'yes':
            print("キャンセルしました。")
            sys.exit(0)
    
    migrate_detect_logs(dry_run=args.dry_run)


if __name__ == '__main__':
    main()
