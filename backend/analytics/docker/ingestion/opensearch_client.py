"""
OpenSearch Serverless接続・操作モジュール
"""
import json
import os
from opensearchpy import OpenSearch, RequestsHttpConnection
from requests_aws4auth import AWS4Auth
import boto3


class OpenSearchClient:
    """
    OpenSearch Serverless接続・操作クラス
    """
    
    def __init__(self, endpoint, index_name):
        """
        初期化
        
        Args:
            endpoint: OpenSearch Serverlessエンドポイント（https://付きでもなしでもOK）
            index_name: インデックス名
        """
        self.endpoint = endpoint.replace('https://', '').replace('http://', '')
        self.index_name = index_name
        
        # AWS認証情報を取得
        credentials = boto3.Session().get_credentials()
        region = os.environ.get('AWS_DEFAULT_REGION', os.environ.get('AWS_REGION', 'ap-northeast-1'))
        
        awsauth = AWS4Auth(
            credentials.access_key,
            credentials.secret_key,
            region,
            'aoss',
            session_token=credentials.token
        )
        
        # OpenSearchクライアントを作成
        self.client = OpenSearch(
            hosts=[{'host': self.endpoint, 'port': 443}],
            http_auth=awsauth,
            use_ssl=True,
            verify_certs=True,
            connection_class=RequestsHttpConnection,
            timeout=30
        )
        
        print(f"OpenSearch client initialized for endpoint: {self.endpoint}, index: {self.index_name}")
    
    def index_exists(self):
        """
        インデックスの存在確認
        
        Returns:
            bool: インデックスが存在する場合True
        """
        try:
            return self.client.indices.exists(index=self.index_name)
        except Exception as e:
            print(f"Error checking index existence: {e}")
            return False
    
    def create_index_with_mapping(self):
        """
        kuromojiマッピングを使用してインデックスを作成
        """
        # mapping.jsonを読み込み
        mapping_file = os.path.join(os.path.dirname(__file__), 'mapping.json')
        
        if not os.path.exists(mapping_file):
            raise FileNotFoundError(f"Mapping file not found: {mapping_file}")
        
        with open(mapping_file, 'r', encoding='utf-8') as f:
            mapping_config = json.load(f)
        
        try:
            response = self.client.indices.create(
                index=self.index_name,
                body=mapping_config['template']
            )
            print(f"Index '{self.index_name}' created with kuromoji mapping")
            return response
        except Exception as e:
            print(f"Error creating index: {e}")
            raise
    
    def ensure_index_exists(self):
        """
        インデックスが存在しない場合は作成
        """
        if not self.index_exists():
            print(f"Index '{self.index_name}' does not exist. Creating...")
            self.create_index_with_mapping()
        else:
            print(f"Index '{self.index_name}' already exists")
    
    def index_document(self, document_id, document):
        """
        ドキュメントをインデックスに追加/更新
        
        Args:
            document_id: ドキュメントID
            document: ドキュメント内容（dict）
        """
        try:
            response = self.client.index(
                index=self.index_name,
                id=document_id,
                body=document
            )
            print(f"Document indexed: {document_id}")
            return response
        except Exception as e:
            print(f"Error indexing document {document_id}: {e}")
            raise
    
    def delete_document(self, document_id):
        """
        ドキュメントをインデックスから削除
        
        Args:
            document_id: ドキュメントID
        """
        try:
            response = self.client.delete(
                index=self.index_name,
                id=document_id,
                ignore=[404]  # 存在しない場合はエラーにしない
            )
            print(f"Document deleted: {document_id}")
            return response
        except Exception as e:
            print(f"Error deleting document {document_id}: {e}")
            raise
    
    def bulk_operation(self, operations):
        """
        バルク操作を実行
        
        Args:
            operations: 操作のリスト
                [
                    {'action': 'index', 'id': '...', 'document': {...}},
                    {'action': 'delete', 'id': '...'},
                ]
        
        Returns:
            dict: バルク操作の結果
        """
        if not operations:
            print("No operations to execute")
            return {'items': []}
        
        # バルクAPIのボディを構築
        bulk_body = []
        for op in operations:
            action = op['action']
            doc_id = op['id']
            
            if action == 'index':
                bulk_body.append({'index': {'_index': self.index_name, '_id': doc_id}})
                bulk_body.append(op['document'])
            elif action == 'delete':
                bulk_body.append({'delete': {'_index': self.index_name, '_id': doc_id}})
        
        try:
            response = self.client.bulk(body=bulk_body)
            
            # エラーチェック
            if response.get('errors'):
                error_items = [item for item in response['items'] if 'error' in list(item.values())[0]]
                print(f"Bulk operation completed with errors: {len(error_items)} errors out of {len(operations)} operations")
                for item in error_items[:5]:  # 最初の5件のみ表示
                    print(f"Error detail: {item}")
            else:
                print(f"Bulk operation completed successfully: {len(operations)} operations")
            
            return response
        except Exception as e:
            print(f"Error in bulk operation: {e}")
            raise

