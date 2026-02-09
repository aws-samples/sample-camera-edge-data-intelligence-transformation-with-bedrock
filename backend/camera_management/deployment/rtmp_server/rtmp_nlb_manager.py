"""
RTMP NLB Manager

NLBの自動作成・削除、ポート割当・解放を管理するモジュール
"""

import os
import secrets
import string
import boto3
from datetime import datetime
from typing import Optional, Dict, Any, Tuple
from botocore.exceptions import ClientError

# Constants
PORTS_PER_NLB = 50
PORT_RANGE_START = 1935
PORT_RANGE_END = 6934  # 100 NLBs * 50 ports = 5000 cameras
TABLE_NAME = os.environ.get('RTMP_NLB_TABLE_NAME', 'cedix-rtmp-nlb')
CAMERA_TABLE_NAME = os.environ.get('CAMERA_TABLE_NAME', 'cedix-camera')


class RtmpNlbManager:
    """RTMP NLBとポートの管理クラス"""
    
    def __init__(self, region: str = None):
        self.region = region or os.environ.get('AWS_REGION', 'ap-northeast-1')
        self.dynamodb = boto3.resource('dynamodb', region_name=self.region)
        self.cf_client = boto3.client('cloudformation', region_name=self.region)
        self.ssm_client = boto3.client('ssm', region_name=self.region)
        self.nlb_table = self.dynamodb.Table(TABLE_NAME)
        self.camera_table = self.dynamodb.Table(CAMERA_TABLE_NAME)
        
        # SSM Parametersからインフラ情報を取得
        self._load_infra_params()
    
    def _load_infra_params(self):
        """SSM Parametersからインフラ情報を取得"""
        params = [
            '/Cedix/Main/VpcId',
            '/Cedix/Main/PublicSubnet1Id',
            '/Cedix/Main/PublicSubnet2Id',
            '/Cedix/Main/StackName',
            '/Cedix/Main/ZeroETLBucketName',
        ]
        
        try:
            response = self.ssm_client.get_parameters(Names=params)
            param_dict = {p['Name']: p['Value'] for p in response.get('Parameters', [])}
            
            self.vpc_id = param_dict.get('/Cedix/Main/VpcId')
            self.public_subnet1_id = param_dict.get('/Cedix/Main/PublicSubnet1Id')
            self.public_subnet2_id = param_dict.get('/Cedix/Main/PublicSubnet2Id')
            self.stack_prefix = param_dict.get('/Cedix/Main/StackName', 'cedix')
            self.access_logs_bucket = param_dict.get('/Cedix/Main/ZeroETLBucketName', '')
        except ClientError as e:
            print(f"Warning: Failed to load SSM parameters: {e}")
            self.vpc_id = None
            self.public_subnet1_id = None
            self.public_subnet2_id = None
            self.stack_prefix = 'cedix'
            self.access_logs_bucket = ''
    
    @staticmethod
    def generate_stream_key(length: int = 32) -> str:
        """
        推測困難なストリームキーを生成
        
        形式: 英数字32文字（約190ビットエントロピー）
        """
        alphabet = string.ascii_letters + string.digits
        return ''.join(secrets.choice(alphabet) for _ in range(length))
    
    def _get_next_nlb_id(self) -> str:
        """次のNLB IDを生成"""
        # 既存のNLB数をカウント
        response = self.nlb_table.scan(
            ProjectionExpression='nlb_id'
        )
        existing_count = len(response.get('Items', []))
        
        # 新しいIDを生成 (rtmp-nlb-001, rtmp-nlb-002, ...)
        return f"rtmp-nlb-{existing_count + 1:03d}"
    
    def _get_port_range_for_nlb(self, nlb_index: int) -> Tuple[int, int]:
        """NLBインデックスに基づいてポート範囲を計算"""
        start = PORT_RANGE_START + (nlb_index * PORTS_PER_NLB)
        end = start + PORTS_PER_NLB - 1
        return start, end
    
    def find_available_nlb(self) -> Optional[Dict[str, Any]]:
        """
        空きポートがあるNLBを検索
        
        Returns:
            空きのあるNLBレコード、なければNone
        """
        response = self.nlb_table.scan(
            FilterExpression='#s = :active AND used_ports < :max_ports',
            ExpressionAttributeNames={'#s': 'status'},
            ExpressionAttributeValues={
                ':active': 'active',
                ':max_ports': PORTS_PER_NLB
            }
        )
        
        items = response.get('Items', [])
        if items:
            # 使用ポート数が最も少ないNLBを選択
            return min(items, key=lambda x: x.get('used_ports', 0))
        return None
    
    def allocate_port(self, nlb_id: str) -> Optional[int]:
        """
        NLBからポートを割り当て
        
        Args:
            nlb_id: NLBのID
        
        Returns:
            割り当てられたポート番号、失敗時はNone
        """
        # NLBレコードを取得
        response = self.nlb_table.get_item(Key={'nlb_id': nlb_id})
        nlb = response.get('Item')
        
        if not nlb:
            print(f"Error: NLB {nlb_id} not found")
            return None
        
        port_range_start = nlb.get('port_range_start', PORT_RANGE_START)
        used_ports = nlb.get('used_ports', 0)
        allocated_ports = nlb.get('allocated_ports', [])
        
        # 使用済みポートから空きを探す
        for offset in range(PORTS_PER_NLB):
            port = port_range_start + offset
            if port not in allocated_ports:
                # ポートを割り当て
                try:
                    self.nlb_table.update_item(
                        Key={'nlb_id': nlb_id},
                        UpdateExpression='SET used_ports = used_ports + :inc, allocated_ports = list_append(if_not_exists(allocated_ports, :empty_list), :port)',
                        ExpressionAttributeValues={
                            ':inc': 1,
                            ':port': [port],
                            ':empty_list': []
                        },
                        ConditionExpression='attribute_exists(nlb_id)'
                    )
                    return port
                except ClientError as e:
                    if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
                        continue
                    raise
        
        return None
    
    def release_port(self, nlb_id: str, port: int) -> bool:
        """
        ポートを解放
        
        Args:
            nlb_id: NLBのID
            port: 解放するポート番号
        
        Returns:
            成功時True
        """
        try:
            # NLBレコードを取得
            response = self.nlb_table.get_item(Key={'nlb_id': nlb_id})
            nlb = response.get('Item')
            
            if not nlb:
                print(f"Warning: NLB {nlb_id} not found")
                return False
            
            allocated_ports = nlb.get('allocated_ports', [])
            
            if port in allocated_ports:
                allocated_ports.remove(port)
                
                self.nlb_table.update_item(
                    Key={'nlb_id': nlb_id},
                    UpdateExpression='SET used_ports = :count, allocated_ports = :ports',
                    ExpressionAttributeValues={
                        ':count': len(allocated_ports),
                        ':ports': allocated_ports
                    }
                )
                return True
            
            return False
        except ClientError as e:
            print(f"Error releasing port: {e}")
            return False
    
    def create_nlb(self, wait_for_completion: bool = False) -> Optional[Dict[str, Any]]:
        """
        新しいNLBを作成（デフォルトは非同期）
        
        Args:
            wait_for_completion: Trueの場合、スタック作成完了を待機
        
        Returns:
            作成されたNLBの情報（非同期の場合はstatus='creating'）
        """
        # 既存NLB数からインデックスを計算
        response = self.nlb_table.scan(ProjectionExpression='nlb_id')
        nlb_index = len(response.get('Items', []))
        
        # 上限チェック
        max_nlbs = (PORT_RANGE_END - PORT_RANGE_START + 1) // PORTS_PER_NLB
        if nlb_index >= max_nlbs:
            print(f"Error: Maximum NLB count ({max_nlbs}) reached")
            return None
        
        nlb_id = f"rtmp-nlb-{nlb_index + 1:03d}"
        port_range_start, port_range_end = self._get_port_range_for_nlb(nlb_index)
        stack_name = f"{self.stack_prefix}-{nlb_id}"
        
        # CloudFormationスタックを作成
        template_path = os.path.join(os.path.dirname(__file__), 'template-rtmp-nlb.yaml')
        
        with open(template_path, 'r') as f:
            template_body = f.read()
        
        try:
            self.cf_client.create_stack(
                StackName=stack_name,
                TemplateBody=template_body,
                Parameters=[
                    {'ParameterKey': 'NlbId', 'ParameterValue': nlb_id},
                    {'ParameterKey': 'PublicSubnet1Id', 'ParameterValue': self.public_subnet1_id},
                    {'ParameterKey': 'PublicSubnet2Id', 'ParameterValue': self.public_subnet2_id},
                    {'ParameterKey': 'VpcId', 'ParameterValue': self.vpc_id},
                    {'ParameterKey': 'PortRangeStart', 'ParameterValue': str(port_range_start)},
                    {'ParameterKey': 'PortRangeEnd', 'ParameterValue': str(port_range_end)},
                    {'ParameterKey': 'AccessLogsBucketName', 'ParameterValue': self.access_logs_bucket},
                ],
                Tags=[
                    {'Key': 'Purpose', 'Value': 'RTMP-NLB'},
                    {'Key': 'NlbId', 'Value': nlb_id},
                ],
                OnFailure='ROLLBACK',  # Changed from DELETE to preserve failed stacks for debugging
            )
            
            print(f"✅ NLB stack {stack_name} creation started")
            
            # DynamoDBに仮レコードを作成（status='creating'）
            now = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S')
            nlb_record = {
                'nlb_id': nlb_id,
                'nlb_arn': '',  # 作成完了後に更新
                'nlb_dns_name': '',  # 作成完了後に更新
                'security_group_id': '',  # 作成完了後に更新
                'port_range_start': port_range_start,
                'port_range_end': port_range_end,
                'used_ports': 0,
                'allocated_ports': [],
                'status': 'creating',
                'stack_name': stack_name,
                'created_at': now,
                'updated_at': now,
            }
            
            self.nlb_table.put_item(Item=nlb_record)
            
            if wait_for_completion:
                # 同期モード：完了を待機
                print(f"Waiting for NLB stack {stack_name} to complete...")
                waiter = self.cf_client.get_waiter('stack_create_complete')
                waiter.wait(StackName=stack_name, WaiterConfig={'Delay': 10, 'MaxAttempts': 60})
                
                # スタック完了後に情報を更新
                return self._update_nlb_from_stack(nlb_id, stack_name)
            else:
                # 非同期モード：即座に返却
                return nlb_record
            
        except ClientError as e:
            print(f"Error creating NLB: {e}")
            return None
    
    def _update_nlb_from_stack(self, nlb_id: str, stack_name: str) -> Optional[Dict[str, Any]]:
        """CloudFormationスタック出力からNLBレコードを更新"""
        try:
            stack_response = self.cf_client.describe_stacks(StackName=stack_name)
            outputs = {o['OutputKey']: o['OutputValue'] for o in stack_response['Stacks'][0].get('Outputs', [])}
            
            nlb_arn = outputs.get('NlbArn')
            nlb_dns_name = outputs.get('NlbDnsName')
            security_group_id = outputs.get('SecurityGroupId')
            
            now = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S')
            
            self.nlb_table.update_item(
                Key={'nlb_id': nlb_id},
                UpdateExpression='SET nlb_arn = :arn, nlb_dns_name = :dns, security_group_id = :sg, #s = :status, updated_at = :updated',
                ExpressionAttributeNames={'#s': 'status'},
                ExpressionAttributeValues={
                    ':arn': nlb_arn,
                    ':dns': nlb_dns_name,
                    ':sg': security_group_id,
                    ':status': 'active',
                    ':updated': now,
                }
            )
            
            # 更新後のレコードを返す
            response = self.nlb_table.get_item(Key={'nlb_id': nlb_id})
            return response.get('Item')
            
        except ClientError as e:
            print(f"Error updating NLB from stack: {e}")
            return None
    
    def check_and_update_nlb_status(self, nlb_id: str) -> Optional[Dict[str, Any]]:
        """NLBのステータスを確認し、必要に応じて更新"""
        response = self.nlb_table.get_item(Key={'nlb_id': nlb_id})
        nlb = response.get('Item')
        
        if not nlb:
            return None
        
        # すでにactiveならそのまま返す
        if nlb.get('status') == 'active':
            return nlb
        
        # creating状態ならCloudFormationスタックをチェック
        if nlb.get('status') == 'creating':
            stack_name = nlb.get('stack_name')
            if not stack_name:
                return nlb
            
            try:
                stack_response = self.cf_client.describe_stacks(StackName=stack_name)
                stack = stack_response['Stacks'][0]
                stack_status = stack['StackStatus']
                
                if stack_status == 'CREATE_COMPLETE':
                    # スタック完了、NLB情報を更新
                    return self._update_nlb_from_stack(nlb_id, stack_name)
                elif 'FAILED' in stack_status or 'ROLLBACK' in stack_status:
                    # 失敗
                    self.nlb_table.update_item(
                        Key={'nlb_id': nlb_id},
                        UpdateExpression='SET #s = :status',
                        ExpressionAttributeNames={'#s': 'status'},
                        ExpressionAttributeValues={':status': 'failed'}
                    )
                    nlb['status'] = 'failed'
                    return nlb
                else:
                    # まだ作成中
                    return nlb
                    
            except ClientError as e:
                print(f"Error checking NLB stack status: {e}")
                return nlb
        
        return nlb
    
    def delete_nlb(self, nlb_id: str) -> bool:
        """
        NLBを削除
        
        Args:
            nlb_id: 削除するNLBのID
        
        Returns:
            成功時True
        """
        response = self.nlb_table.get_item(Key={'nlb_id': nlb_id})
        nlb = response.get('Item')
        
        if not nlb:
            print(f"Warning: NLB {nlb_id} not found")
            return False
        
        # 使用中ポートがある場合は削除不可
        if nlb.get('used_ports', 0) > 0:
            print(f"Error: NLB {nlb_id} has {nlb['used_ports']} ports in use")
            return False
        
        stack_name = nlb.get('stack_name')
        
        try:
            # CloudFormationスタックを削除
            if stack_name:
                self.cf_client.delete_stack(StackName=stack_name)
                print(f"Deleting CloudFormation stack: {stack_name}")
                
                waiter = self.cf_client.get_waiter('stack_delete_complete')
                waiter.wait(StackName=stack_name, WaiterConfig={'Delay': 10, 'MaxAttempts': 60})
            
            # DynamoDBレコードを削除
            self.nlb_table.delete_item(Key={'nlb_id': nlb_id})
            print(f"✓ Deleted NLB: {nlb_id}")
            
            return True
            
        except ClientError as e:
            print(f"Error deleting NLB: {e}")
            return False
    
    def deploy_rtmp_server(
        self,
        camera_id: str,
        stream_name: str,
        retention_period: str = '24',
        fragment_duration: str = '2000',
        storage_size: str = '512'
    ) -> Dict[str, Any]:
        """
        RTMPサーバーをデプロイ（非同期、完了を待たない）
        
        Args:
            camera_id: カメラID
            stream_name: KVSストリーム名
            retention_period: KVS保持期間（時間）
            fragment_duration: フラグメント期間（ミリ秒）
            storage_size: ストレージサイズ（GB）
        
        Returns:
            デプロイ結果
            - NLB作成中の場合: {'success': True, 'status': 'nlb_creating', 'nlb_id': ...}
            - RTMPサーバー作成開始の場合: {'success': True, 'status': 'deploying', ...}
        """
        # ストリームキーを生成
        stream_key = self.generate_stream_key()
        
        # 利用可能なNLBを検索
        nlb = self.find_available_nlb()
        
        # NLBがない場合は作成（非同期）
        if not nlb:
            print("No available NLB found. Creating new NLB...")
            nlb = self.create_nlb(wait_for_completion=False)  # 非同期
            if not nlb:
                return {
                    'success': False,
                    'error': 'Failed to create NLB'
                }
        
        nlb_id = nlb['nlb_id']
        
        # NLBがcreating状態の場合は待機が必要
        if nlb.get('status') == 'creating':
            print(f"NLB {nlb_id} is still creating. Returning nlb_creating status.")
            return {
                'success': True,
                'status': 'nlb_creating',
                'nlb_id': nlb_id,
                'stream_key': stream_key,
                'message': 'NLB is being created. Please retry after NLB is ready.'
            }
        
        # NLBがactive状態でない場合はエラー
        if nlb.get('status') != 'active':
            return {
                'success': False,
                'error': f'NLB {nlb_id} is in invalid state: {nlb.get("status")}'
            }
        
        # ポートを割り当て
        port = self.allocate_port(nlb_id)
        if not port:
            return {
                'success': False,
                'error': f'Failed to allocate port from NLB {nlb_id}'
            }
        
        # RTMP ServerのCloudFormationスタックをデプロイ（完了を待たない）
        stack_name = f"{self.stack_prefix}-rtmp-server-{camera_id}"
        template_path = os.path.join(os.path.dirname(__file__), 'template-rtmp-server.yaml')
        
        # SSM Parametersから追加のパラメータを取得
        additional_params = self._get_rtmp_server_params()
        
        with open(template_path, 'r') as f:
            template_body = f.read()
        
        try:
            self.cf_client.create_stack(
                StackName=stack_name,
                TemplateBody=template_body,
                Parameters=[
                    {'ParameterKey': 'CameraId', 'ParameterValue': camera_id},
                    {'ParameterKey': 'StreamName', 'ParameterValue': stream_name},
                    {'ParameterKey': 'RtmpStreamPath', 'ParameterValue': stream_key},
                    {'ParameterKey': 'RetentionPeriod', 'ParameterValue': retention_period},
                    {'ParameterKey': 'NlbArn', 'ParameterValue': nlb['nlb_arn']},
                    {'ParameterKey': 'NlbSecurityGroupId', 'ParameterValue': nlb['security_group_id']},
                    {'ParameterKey': 'ListenerPort', 'ParameterValue': str(port)},
                    {'ParameterKey': 'VpcId', 'ParameterValue': self.vpc_id},
                    {'ParameterKey': 'PublicSubnet1Id', 'ParameterValue': self.public_subnet1_id},
                    {'ParameterKey': 'PublicSubnet2Id', 'ParameterValue': self.public_subnet2_id},
                    {'ParameterKey': 'RtmpServerRepositoryUri', 'ParameterValue': additional_params['rtmp_server_repository_uri']},
                    {'ParameterKey': 'EcsTaskRoleArn', 'ParameterValue': additional_params['ecs_task_role_arn']},
                    {'ParameterKey': 'EcsTaskExecutionRoleArn', 'ParameterValue': additional_params['ecs_task_execution_role_arn']},
                    {'ParameterKey': 'CameraClusterName', 'ParameterValue': additional_params['camera_cluster_name']},
                    {'ParameterKey': 'LogsKmsKeyArn', 'ParameterValue': additional_params['logs_kms_key_arn']},
                ],
                Capabilities=['CAPABILITY_AUTO_EXPAND', 'CAPABILITY_IAM'],
                Tags=[
                    {'Key': 'Purpose', 'Value': 'RTMP-Server'},
                    {'Key': 'CameraId', 'Value': camera_id},
                    {'Key': 'NlbId', 'Value': nlb_id},
                ],
                OnFailure='ROLLBACK',  # Changed from DELETE to preserve failed stacks for debugging
            )
            
            print(f"✅ RTMP Server stack {stack_name} creation started (async)")
            
            # RTMP URL生成
            rtmp_endpoint = f"rtmp://{nlb['nlb_dns_name']}:{port}/live/{stream_key}"
            
            return {
                'success': True,
                'status': 'deploying',
                'nlb_id': nlb_id,
                'port': port,
                'stream_key': stream_key,
                'rtmp_endpoint': rtmp_endpoint,
                'stack_name': stack_name,
                'nlb_dns_name': nlb['nlb_dns_name'],
            }
            
        except ClientError as e:
            # 失敗時はポートを解放
            self.release_port(nlb_id, port)
            return {
                'success': False,
                'error': str(e)
            }
    
    def _get_rtmp_server_params(self) -> Dict[str, str]:
        """SSM Parametersから RTMP Server用パラメータを取得"""
        params = [
            '/Cedix/Main/EcsTaskRoleArn',
            '/Cedix/Main/EcsTaskExecutionRoleArn',
            '/Cedix/Main/CameraClusterName',
            '/Cedix/Main/LogsKmsKeyArn',
            '/Cedix/Ecr/RtmpServerRepositoryUri',
        ]
        
        try:
            response = self.ssm_client.get_parameters(Names=params)
            param_dict = {p['Name']: p['Value'] for p in response.get('Parameters', [])}
            
            return {
                'ecs_task_role_arn': param_dict.get('/Cedix/Main/EcsTaskRoleArn', ''),
                'ecs_task_execution_role_arn': param_dict.get('/Cedix/Main/EcsTaskExecutionRoleArn', ''),
                'camera_cluster_name': param_dict.get('/Cedix/Main/CameraClusterName', ''),
                'logs_kms_key_arn': param_dict.get('/Cedix/Main/LogsKmsKeyArn', ''),
                'rtmp_server_repository_uri': param_dict.get('/Cedix/Ecr/RtmpServerRepositoryUri', ''),
            }
        except ClientError as e:
            print(f"Warning: Failed to get SSM parameters: {e}")
            return {}
    
    def undeploy_rtmp_server(self, camera_id: str) -> Dict[str, Any]:
        """
        RTMPサーバーをアンデプロイ（非同期）
        
        CloudFormationスタックの削除を開始し、完了を待たずに返す。
        ポート解放とNLB削除は即時実行（スタック削除は非同期で進行）。
        
        Args:
            camera_id: カメラID
        
        Returns:
            アンデプロイ結果
        """
        # カメラ情報を取得
        response = self.camera_table.get_item(Key={'camera_id': camera_id})
        camera = response.get('Item')
        
        if not camera:
            return {
                'success': False,
                'error': f'Camera {camera_id} not found'
            }
        
        nlb_id = camera.get('rtmp_nlb_id')
        port = camera.get('rtmp_port')
        stack_name = camera.get('rtmp_server_stack')
        
        if not stack_name:
            return {
                'success': False,
                'error': f'Camera {camera_id} has no RTMP server stack'
            }
        
        try:
            # CloudFormationスタックを削除（非同期 - 完了を待たない）
            self.cf_client.delete_stack(StackName=stack_name)
            print(f"Initiated deletion of RTMP server stack: {stack_name}")
            
            # ポートを即時解放（スタック削除の完了を待たない）
            # これにより、新しいカメラ作成時にポートが再利用可能になる
            if nlb_id and port:
                self.release_port(nlb_id, port)
                print(f"Released port {port} from NLB {nlb_id}")
                
                # NLBの使用ポートが0になったら削除を開始（非同期）
                nlb_response = self.nlb_table.get_item(Key={'nlb_id': nlb_id})
                nlb = nlb_response.get('Item')
                if nlb and nlb.get('used_ports', 0) == 0:
                    print(f"NLB {nlb_id} has no ports in use. Initiating deletion...")
                    self._delete_nlb_async(nlb_id)
            
            print(f"✓ Initiated undeploy for RTMP server: {camera_id}")
            
            return {
                'success': True,
                'deleted_stack': stack_name,
                'status': 'deleting'  # 削除中（非同期）
            }
            
        except ClientError as e:
            return {
                'success': False,
                'error': str(e)
            }
    
    def _delete_nlb_async(self, nlb_id: str) -> bool:
        """
        NLBを非同期で削除（完了を待たない）
        
        Args:
            nlb_id: 削除するNLBのID
        
        Returns:
            削除開始に成功した場合True
        """
        response = self.nlb_table.get_item(Key={'nlb_id': nlb_id})
        nlb = response.get('Item')
        
        if not nlb:
            print(f"Warning: NLB {nlb_id} not found")
            return False
        
        # 使用中ポートがある場合は削除不可
        if nlb.get('used_ports', 0) > 0:
            print(f"Error: NLB {nlb_id} has {nlb['used_ports']} ports in use")
            return False
        
        stack_name = nlb.get('stack_name')
        
        try:
            # CloudFormationスタックを削除（非同期）
            if stack_name:
                self.cf_client.delete_stack(StackName=stack_name)
                print(f"Initiated deletion of NLB CloudFormation stack: {stack_name}")
            
            # DynamoDBレコードを削除（status を 'deleting' に更新）
            self.nlb_table.update_item(
                Key={'nlb_id': nlb_id},
                UpdateExpression='SET #s = :status',
                ExpressionAttributeNames={'#s': 'status'},
                ExpressionAttributeValues={':status': 'deleting'}
            )
            print(f"✓ Initiated NLB deletion: {nlb_id}")
            
            return True
            
        except ClientError as e:
            print(f"Error initiating NLB deletion: {e}")
            return False
    
    def get_rtmp_status(self, camera_id: str) -> Dict[str, Any]:
        """
        RTMPサーバーのステータスを取得
        
        Args:
            camera_id: カメラID
        
        Returns:
            ステータス情報
        """
        response = self.camera_table.get_item(Key={'camera_id': camera_id})
        camera = response.get('Item')
        
        if not camera:
            return {'status': 'not_found'}
        
        stack_name = camera.get('rtmp_server_stack')
        if not stack_name:
            return {'status': 'no_rtmp_server'}
        
        try:
            stack_response = self.cf_client.describe_stacks(StackName=stack_name)
            stack = stack_response['Stacks'][0]
            stack_status = stack['StackStatus']
            
            if stack_status == 'CREATE_COMPLETE':
                return {
                    'status': 'deployed',
                    'rtmp_endpoint': camera.get('rtmp_endpoint'),
                    'port': camera.get('rtmp_port'),
                    'stream_key': camera.get('rtmp_stream_key'),
                    'kvs_stream_name': camera.get('rtmp_kvs_stream_name'),
                }
            elif 'IN_PROGRESS' in stack_status:
                return {'status': 'deploying'}
            elif 'FAILED' in stack_status or 'ROLLBACK' in stack_status:
                return {
                    'status': 'failed',
                    'reason': stack.get('StackStatusReason', 'Unknown')
                }
            else:
                return {'status': stack_status}
                
        except ClientError as e:
            if 'does not exist' in str(e):
                return {'status': 'not_deployed'}
            return {'status': 'error', 'error': str(e)}


# CLIエントリポイント
if __name__ == '__main__':
    import argparse
    
    parser = argparse.ArgumentParser(description='RTMP NLB Manager')
    subparsers = parser.add_subparsers(dest='command')
    
    # create-nlb コマンド
    subparsers.add_parser('create-nlb', help='Create a new NLB')
    
    # list-nlbs コマンド
    subparsers.add_parser('list-nlbs', help='List all NLBs')
    
    # deploy コマンド
    deploy_parser = subparsers.add_parser('deploy', help='Deploy RTMP server')
    deploy_parser.add_argument('--camera-id', required=True)
    deploy_parser.add_argument('--stream-name', required=True)
    deploy_parser.add_argument('--retention-period', default='24')
    
    # undeploy コマンド
    undeploy_parser = subparsers.add_parser('undeploy', help='Undeploy RTMP server')
    undeploy_parser.add_argument('--camera-id', required=True)
    
    args = parser.parse_args()
    manager = RtmpNlbManager()
    
    if args.command == 'create-nlb':
        result = manager.create_nlb()
        print(result)
    elif args.command == 'list-nlbs':
        response = manager.nlb_table.scan()
        for item in response.get('Items', []):
            print(f"{item['nlb_id']}: {item.get('used_ports', 0)}/{PORTS_PER_NLB} ports used")
    elif args.command == 'deploy':
        result = manager.deploy_rtmp_server(
            camera_id=args.camera_id,
            stream_name=args.stream_name,
            retention_period=args.retention_period
        )
        print(result)
    elif args.command == 'undeploy':
        result = manager.undeploy_rtmp_server(camera_id=args.camera_id)
        print(result)
    else:
        parser.print_help()
