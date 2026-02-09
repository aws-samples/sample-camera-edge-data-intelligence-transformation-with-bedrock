#!/usr/bin/env python3
"""
Detector個別EventBridge Rule管理モジュール

各Detectorに対して個別のEventBridge Ruleを作成・更新・削除する。
Rule名: cedix-detector-{detector_id}

疎結合設計:
- collector_id でフィルタリング（collector は detector を知らない）
- InputTransformer で detector_id を注入
"""

import json
import logging
from typing import Optional
from botocore.exceptions import ClientError
from shared.common import create_boto3_session, setup_logger

logger = setup_logger(__name__)


def _get_rule_name(detector_id: str) -> str:
    """
    Detector IDからRule名を生成
    
    Args:
        detector_id: Detector ID
    
    Returns:
        str: Rule名（例: cedix-detector-abc123）
    """
    return f'cedix-detector-{detector_id}'


def _get_target_id(detector_id: str) -> str:
    """
    Detector IDからTarget IDを生成
    
    Args:
        detector_id: Detector ID
    
    Returns:
        str: Target ID
    """
    return f'cedix-detector-{detector_id}-target'


def _get_statement_id(detector_id: str) -> str:
    """
    Detector IDからLambda Permission Statement IDを生成
    
    Args:
        detector_id: Detector ID
    
    Returns:
        str: Statement ID
    """
    return f'cedix-detector-{detector_id}-permission'


def create_detector_eventbridge_rule(
    detector_id: str,
    collector_id: str,
    trigger_event: str,
    lambda_endpoint_arn: str
) -> Optional[str]:
    """
    Detector個別のEventBridge Ruleを作成
    
    疎結合設計:
    - collector_id でフィルタリング（collector は detector を知らない）
    - InputTransformer で detector_id を Lambda に渡す
    
    Args:
        detector_id: Detector ID
        collector_id: Collector ID（フィルタリング用）
        trigger_event: トリガーイベントタイプ (SaveImageEvent/SaveVideoEvent/ClassDetectEvent/AreaDetectEvent)
        lambda_endpoint_arn: Lambda関数のARN
    
    Returns:
        str: 作成されたRule ARN（失敗時はNone）
    """
    try:
        session = create_boto3_session()
        events_client = session.client('events')
        lambda_client = session.client('lambda')
        
        rule_name = _get_rule_name(detector_id)
        target_id = _get_target_id(detector_id)
        statement_id = _get_statement_id(detector_id)
        
        # EventPatternを構築（collector_id でフィルタリング）
        event_pattern = {
            "source": [{"prefix": "cedix.collector."}],
            "detail-type": [trigger_event],
            "detail": {
                "collector_id": [collector_id]
            }
        }
        
        logger.info(f"EventBridge Rule作成開始: rule_name={rule_name}, collector_id={collector_id}")
        logger.debug(f"EventPattern: {json.dumps(event_pattern)}")
        
        # 1. Ruleを作成
        response = events_client.put_rule(
            Name=rule_name,
            EventPattern=json.dumps(event_pattern),
            State='ENABLED',
            Description=f'CEDIX Detector Rule - detector_id={detector_id}, collector_id={collector_id}, trigger_event={trigger_event}'
        )
        
        rule_arn = response['RuleArn']
        logger.info(f"EventBridge Rule作成成功: rule_name={rule_name}, rule_arn={rule_arn}")
        
        # 2. InputTransformer を構築（detector_id を注入）
        # 元のイベント detail を保持しつつ、detector_id を追加
        input_transformer = {
            'InputPathsMap': {
                'source': '$.source',
                'detailType': '$.detail-type',
                'time': '$.time',
                'detail': '$.detail'
            },
            'InputTemplate': '{"source": <source>, "detail-type": <detailType>, "time": <time>, "detail": <detail>, "detector_id": "' + detector_id + '"}'
        }
        
        # 3. Targetを追加（InputTransformer 付き）
        events_client.put_targets(
            Rule=rule_name,
            Targets=[{
                'Id': target_id,
                'Arn': lambda_endpoint_arn,
                'InputTransformer': input_transformer
            }]
        )
        logger.info(f"EventBridge Target追加成功: target_id={target_id}, lambda_arn={lambda_endpoint_arn}")
        
        # 3. Lambda権限を追加
        try:
            lambda_client.add_permission(
                FunctionName=lambda_endpoint_arn,
                StatementId=statement_id,
                Action='lambda:InvokeFunction',
                Principal='events.amazonaws.com',
                SourceArn=rule_arn
            )
            logger.info(f"Lambda権限追加成功: statement_id={statement_id}")
        except ClientError as e:
            if e.response['Error']['Code'] == 'ResourceConflictException':
                # 既に権限が存在する場合は警告のみ
                logger.warning(f"Lambda権限は既に存在します: statement_id={statement_id}")
            else:
                raise
        
        logger.info(f"EventBridge Rule作成完了: detector_id={detector_id}")
        return rule_arn
        
    except Exception as e:
        logger.error(f"EventBridge Rule作成エラー: detector_id={detector_id}, error={e}")
        return None


def delete_detector_eventbridge_rule(detector_id: str) -> bool:
    """
    Detector個別のEventBridge Ruleを削除
    
    Args:
        detector_id: Detector ID
    
    Returns:
        bool: 削除が成功した場合True
    """
    try:
        session = create_boto3_session()
        events_client = session.client('events')
        lambda_client = session.client('lambda')
        
        rule_name = _get_rule_name(detector_id)
        target_id = _get_target_id(detector_id)
        statement_id = _get_statement_id(detector_id)
        
        logger.info(f"EventBridge Rule削除開始: rule_name={rule_name}")
        
        try:
            # 1. Targetを取得
            targets_response = events_client.list_targets_by_rule(Rule=rule_name)
            targets = targets_response.get('Targets', [])
            
            if targets:
                # 2. Targetを削除
                target_ids = [t['Id'] for t in targets]
                events_client.remove_targets(
                    Rule=rule_name,
                    Ids=target_ids
                )
                logger.info(f"EventBridge Target削除成功: target_ids={target_ids}")
            
            # 3. Lambda権限を削除
            # Lambda ARNを取得するため、Targetから取得
            if targets:
                lambda_arn = targets[0].get('Arn')
                if lambda_arn:
                    try:
                        lambda_client.remove_permission(
                            FunctionName=lambda_arn,
                            StatementId=statement_id
                        )
                        logger.info(f"Lambda権限削除成功: statement_id={statement_id}")
                    except ClientError as e:
                        if e.response['Error']['Code'] == 'ResourceNotFoundException':
                            logger.warning(f"Lambda権限は既に削除されています: statement_id={statement_id}")
                        else:
                            logger.warning(f"Lambda権限削除エラー（続行します）: {e}")
            
            # 4. Ruleを削除
            events_client.delete_rule(Name=rule_name)
            logger.info(f"EventBridge Rule削除成功: rule_name={rule_name}")
            
        except ClientError as e:
            if e.response['Error']['Code'] == 'ResourceNotFoundException':
                # Ruleが存在しない場合は成功として扱う
                logger.info(f"EventBridge Ruleは既に削除されています: rule_name={rule_name}")
                return True
            else:
                raise
        
        logger.info(f"EventBridge Rule削除完了: detector_id={detector_id}")
        return True
        
    except Exception as e:
        logger.error(f"EventBridge Rule削除エラー: detector_id={detector_id}, error={e}")
        return False


def update_detector_eventbridge_rule(
    detector_id: str,
    collector_id: str,
    trigger_event: str,
    lambda_endpoint_arn: str
) -> bool:
    """
    Detector個別のEventBridge Ruleを更新
    （削除 → 再作成）
    
    Args:
        detector_id: Detector ID
        collector_id: Collector ID（フィルタリング用）
        trigger_event: トリガーイベントタイプ
        lambda_endpoint_arn: Lambda関数のARN
    
    Returns:
        bool: 更新が成功した場合True
    """
    try:
        logger.info(f"EventBridge Rule更新開始: detector_id={detector_id}, collector_id={collector_id}")
        
        # 1. 既存Ruleを削除
        delete_success = delete_detector_eventbridge_rule(detector_id)
        if not delete_success:
            logger.warning(f"既存Rule削除に失敗しましたが続行します: detector_id={detector_id}")
        
        # 2. 新規Ruleを作成
        rule_arn = create_detector_eventbridge_rule(
            detector_id=detector_id,
            collector_id=collector_id,
            trigger_event=trigger_event,
            lambda_endpoint_arn=lambda_endpoint_arn
        )
        
        if rule_arn:
            logger.info(f"EventBridge Rule更新成功: detector_id={detector_id}, rule_arn={rule_arn}")
            return True
        else:
            logger.error(f"EventBridge Rule更新失敗（新規作成失敗）: detector_id={detector_id}")
            return False
        
    except Exception as e:
        logger.error(f"EventBridge Rule更新エラー: detector_id={detector_id}, error={e}")
        return False


def check_rule_exists(detector_id: str) -> bool:
    """
    EventBridge Ruleの存在チェック
    
    Args:
        detector_id: Detector ID
    
    Returns:
        bool: Ruleが存在する場合True
    """
    try:
        session = create_boto3_session()
        events_client = session.client('events')
        
        rule_name = _get_rule_name(detector_id)
        events_client.describe_rule(Name=rule_name)
        return True
        
    except ClientError as e:
        if e.response['Error']['Code'] == 'ResourceNotFoundException':
            return False
        else:
            logger.error(f"Rule存在チェックエラー: detector_id={detector_id}, error={e}")
            return False


def get_rule_info(detector_id: str) -> Optional[dict]:
    """
    EventBridge Ruleの情報を取得
    
    Args:
        detector_id: Detector ID
    
    Returns:
        dict: Rule情報（取得失敗時はNone）
    """
    try:
        session = create_boto3_session()
        events_client = session.client('events')
        
        rule_name = _get_rule_name(detector_id)
        response = events_client.describe_rule(Name=rule_name)
        
        # Targetsも取得
        targets_response = events_client.list_targets_by_rule(Rule=rule_name)
        targets = targets_response.get('Targets', [])
        
        return {
            'rule_name': rule_name,
            'rule_arn': response['Arn'],
            'state': response['State'],
            'description': response.get('Description', ''),
            'event_pattern': json.loads(response['EventPattern']),
            'targets': targets
        }
        
    except ClientError as e:
        if e.response['Error']['Code'] == 'ResourceNotFoundException':
            logger.info(f"EventBridge Ruleが見つかりません: detector_id={detector_id}")
            return None
        else:
            logger.error(f"Rule情報取得エラー: detector_id={detector_id}, error={e}")
            return None

