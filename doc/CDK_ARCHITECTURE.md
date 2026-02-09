# CDK構成ガイド

本ドキュメントでは、CEDIXのAWS CDK構成（16スタック）の詳細と依存関係を記載します。

---

## 目次

1. [概要](#概要)
2. [CDKアプリ構成](#cdkアプリ構成)
3. [コアスタック](#コアスタック)
4. [ECRスタック](#ecrスタック)
5. [FoundationStackで作成されるリソース](#foundationstackで作成されるリソース)
6. [デプロイ依存関係](#デプロイ依存関係)
7. [シェルスクリプト一覧](#シェルスクリプト一覧)
8. [デプロイ手順](#デプロイ手順)

---

## 概要

CEDIXのインフラストラクチャは、AWS CDK（TypeScript）で定義されています。

**ディレクトリ構成**:

```
infrastructure/cdk/
├── bin/
│   ├── cdk.ts               # メインCDKアプリ
│   └── cdk-webapp.ts        # Webアプリ専用CDKアプリ
├── lib/
│   ├── config/
│   │   └── constants.ts     # 共通定数
│   └── stacks/              # CDKスタック定義（16ファイル）
├── keys/                    # CloudFront署名用RSAキーペア（setup-cloudfront-keys.shで生成）
├── cdk.config.json.template # 設定テンプレート
├── cdk.json                 # CDK設定
├── package.json
├── tsconfig.json
├── run-cdk.sh               # CDK実行スクリプト
├── run-cdk-webapp.sh        # Webアプリデプロイスクリプト
├── load-config.sh           # 設定読み込み
├── setup-cloudfront-keys.sh # CloudFrontキーセットアップ
└── cleanup_resources.sh     # リソースクリーンアップ
```

---

## CDKアプリ構成

| アプリ | ファイル | 説明 |
| --- | --- | --- |
| cdk | `bin/cdk.ts` | webapp-stack以外の全てをデプロイ |
| cdk-webapp | `bin/cdk-webapp.ts` | webapp-stackのみをデプロイ |

**分離理由**: WebAppStackはCloudFormation Outputの値解決後にビルドするため、別アプリとして分離。

---

## コアスタック

### 常時デプロイスタック（8個）

| スタック名 | ファイル | 役割 |
| --- | --- | --- |
| **CloudFrontKeysStack** | `cloudfront-keys-stack.ts` | CloudFront署名付きURL用キーペアのSecrets Manager参照 |
| **ApiEcrStack** | `api-ecr-stack.ts` | API Lambda用Dockerイメージのビルド＆プッシュ |
| **IngestionEcrStack** | `ingestion-ecr-stack.ts` | OpenSearch Ingestion Lambda用Dockerイメージ |
| **FoundationStack** | `foundation-stack.ts` | 基盤インフラ: VPC、DynamoDB、S3、Cognito、ECS Cluster |
| **ApplicationStack** | `application-stack.ts` | アプリ層: OpenSearch Serverless、API Lambda、API Gateway |
| **FrontendStack** | `frontend-stack.ts` | フロントエンド層: CloudFront Distribution、OAC、S3バケットポリシー |
| **BedrockStack** | `bedrock-stack.ts` | Bedrock AI解析Lambda |
| **WebAppStack** | `webapp-stack.ts` | Reactアプリのビルド＆S3デプロイ |

---

## ECRスタック

### 動的デプロイスタック（8個）

カメラ作成時やカメラ編集画面から任意でデプロイされるスタック。

| スタック名 | ファイル | 用途 |
| --- | --- | --- |
| **HlsYoloEcrStack** | `hlsyolo-ecr-stack.ts` | HLS+YOLOv9(MIT)物体検出コンテナ |
| **HlsRecEcrStack** | `hlsrec-ecr-stack.ts` | HLS録画コンテナ |
| **S3RecEcrStack** | `s3rec-ecr-stack.ts` | S3録画コンテナ |
| **S3YoloEcrStack** | `s3yolo-ecr-stack.ts` | S3+YOLO物体検出コンテナ |
| **RtspReceiverEcrStack** | `rtsp-receiver-ecr-stack.ts` | RTSP受信コンテナ（KVS SDK含む） |
| **RtspMovieEcrStack** | `rtsp-movie-ecr-stack.ts` | テスト動画RTSP配信コンテナ |
| **KvsBaseEcrStack** | `kvs-base-ecr-stack.ts` | KVS SDK + GStreamerベースイメージ |
| **RtmpServerEcrStack** | `rtmp-server-ecr-stack.ts` | RTMPサーバーコンテナ（Go） |

---

## FoundationStackで作成される主要リソース

### DynamoDB 15テーブル

| テーブル名 | 用途 |
| --- | --- |
| `cedix-place` | 現場管理 |
| `cedix-camera` | カメラ管理 |
| `cedix-collector` | コレクター管理 |
| `cedix-detector` | 検出器管理 |
| `cedix-file` | ファイル管理 |
| `cedix-detect-log` | 検出ログ |
| `cedix-detect-log-tag` | 検出ログタグ |
| `cedix-detect-tag-timeseries` | タグ時系列データ |
| `cedix-bookmark` | ブックマーク |
| `cedix-bookmark-detail` | ブックマーク詳細 |
| `cedix-tag-category` | タグカテゴリ |
| `cedix-tag` | タグ |
| `cedix-track-log` | トラッキングログ |
| `cedix-test-movie` | テスト動画 |
| `cedix-rtmp-nlb` | RTMP NLB管理 |

### S3 3バケット

| バケット | 用途 |
| --- | --- |
| Camera用バケット | 映像・画像保存 |
| WebApp用バケット | フロントエンド配信 |
| ZeroETL用バケット | データ連携 |

### その他のリソース

| リソース | 詳細 |
| --- | --- |
| VPC | 10.0.0.0/16、2AZ、NAT Gateway 1台 |
| VPCエンドポイント | S3、DynamoDB |
| Cognito | UserPool、UserPoolClient、IdentityPool |
| ECS | Cluster、TaskRole、TaskExecutionRole、SecurityGroup |
| KMS | CloudWatch Logs暗号化キー |
| SSM Parameters | 各種設定値の永続化 |

---

## デプロイ依存関係

### 依存関係図

```
CloudFrontKeysStack (独立)
        ↓
ApiEcrStack (独立)
IngestionEcrStack (独立)
        ↓
FoundationStack
        ↓
ApplicationStack ← ApiEcrStack, IngestionEcrStack
        ↓
FrontendStack ← CloudFrontKeysStack, ApplicationStack
        ↓
BedrockStack ← FoundationStack
WebAppStack (別アプリ: cdk-webapp.ts)

ECRスタック群 (独立、並列デプロイ可能)
```

### デプロイフェーズ

| Phase | スタック | 説明 |
| --- | --- | --- |
| 1 | keys, api-ecr, ingestion-ecr, foundation | 依存なし、並列デプロイ |
| 1 | 各種ECRスタック（8個） | 独立、並列デプロイ |
| 2 | application | foundation + api-ecr + ingestion-ecr 完了後 |
| 2 | bedrock | foundation 完了後 |
| 3 | frontend | keys + application 完了後 |

---

## シェルスクリプト一覧

| スクリプト | 役割 |
| --- | --- |
| `run-cdk.sh` | メインCDKコマンド実行ラッパー |
| `run-cdk-webapp.sh` | Webアプリデプロイ専用（SSM Parameter取得→ビルド→デプロイ） |
| `setup-cloudfront-keys.sh` | CloudFront署名用RSAキーペア生成＆Secrets Manager登録 |
| `cleanup_resources.sh` | 全リソースクリーンアップ（動的スタック、EventBridge、S3、ECR、KVS、CDKスタック、SSM） |

---

## デプロイ手順

### 設定ファイル

`cdk.config.json` を作成:

```bash
cp cdk.config.json.template cdk.config.json
```

設定内容:

```json
{
  "stackPrefix": "cedix-dev",
  "region": "ap-northeast-1",
  "s3AdditionalPrefix": "<unique-prefix>"
}
```

| パラメータ | 説明 | 必須 |
| --- | --- | --- |
| `stackPrefix` | 全てのAWSリソース名のプレフィックス | ✅ |
| `region` | デプロイ先のAWSリージョン | ✅ |
| `s3AdditionalPrefix` | S3バケット名のグローバル一意性を確保するための追加プレフィックス | ✅ |

### 全リソース一括デプロイ

```bash
cd infrastructure/cdk

# CDK Bootstrap（初回のみ）
cdk bootstrap

# CloudFront署名キーの作成
sudo rm -rf keys/
./setup-cloudfront-keys.sh

# メインリソースの一括デプロイ
./run-cdk.sh deploy --all

# Webアプリケーションのデプロイ
./run-cdk-webapp.sh deploy --all
```

### 個別デプロイ (全リソース一括デプロイに失敗する場合)

```bash
cd infrastructure/cdk

# CDK Bootstrap（初回のみ）
cdk bootstrap

# Secretsのセットアップ
./run-cdk.sh deploy cedix-<prefix>-keys

# KVSベースイメージを先にデプロイ（初回のみ30-60分）
# 一括デプロイに失敗する場合、これを単独実行してから再チャレンジすると成功することがあります
./run-cdk.sh deploy cedix-<prefix>-kvs-base-ecr

# ECRリポジトリの作成（API & Ingestion）
./run-cdk.sh deploy cedix-<prefix>-api-ecr cedix-<prefix>-ingestion-ecr

# 基盤リソースのデプロイ
./run-cdk.sh deploy cedix-<prefix>-foundation

# アプリケーションリソースのデプロイ
./run-cdk.sh deploy cedix-<prefix>-application

# フロントエンド基盤のデプロイ
./run-cdk.sh deploy cedix-<prefix>-frontend

# Detector（AI検出）リソースのデプロイ
./run-cdk.sh deploy cedix-<prefix>-bedrock

# Collector & Camera用ECRリポジトリの作成
./run-cdk.sh deploy cedix-<prefix>-hlsyolo-ecr \
                    cedix-<prefix>-hlsrec-ecr \
                    cedix-<prefix>-s3rec-ecr \
                    cedix-<prefix>-s3yolo-ecr \
                    cedix-<prefix>-rtsp-receiver-ecr \
                    cedix-<prefix>-rtsp-movie-ecr

# Webアプリケーション（SPA）のデプロイ
./run-cdk-webapp.sh deploy cedix-<prefix>-webapp
```

### スタック一覧の確認

```bash
./run-cdk.sh list
```

### 確認メッセージをスキップ

```bash
./run-cdk.sh deploy --all --require-approval never
./run-cdk-webapp.sh deploy --all --require-approval never
```

---

## トラブルシューティング

### デプロイに失敗した場合
1. エラーメッセージを確認し、該当するスタックのみを再デプロイ
2. 依存関係のあるスタックが先にデプロイされているか確認
3. `cdk.config.json` の設定値が正しいか確認

### リソースのクリーンアップ
```bash
./cleanup_resources.sh
```

**注意**: このスクリプトは全リソースを削除します。本番環境では慎重に使用してください。

---

## 特記事項

1. **循環依存回避**: L1 Construct（CfnDistribution等）とCustom Resourceを活用
2. **デグレ防止**: SSM Parameterへの永続化 + Custom Resourceによる即時更新のハイブリッド
3. **KVS Base依存**: `rtmp-server-ecr`は`kvs-base-ecr`のSSM Parameterが存在する場合のみ作成
4. **WebAppは別アプリ**: CloudFormation Outputの値解決後にビルドするため`cdk-webapp.ts`で分離

