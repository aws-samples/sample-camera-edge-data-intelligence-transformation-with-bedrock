# 開発者ガイド
このドキュメントは、本サンプルプロジェクトをローカル環境で開発するための手順を説明します。
---

## 📋 目次

- [前提条件](#前提条件)
- [開発環境のセットアップ](#開発環境のセットアップ)
- [ローカル開発環境の起動](#ローカル開発環境の起動)
- [各サービスの起動方法](#各サービスの起動方法)
- [トラブルシューティング](#トラブルシューティング)

---

## 前提条件

### 必須条件

このガイドは、**AWSへのデプロイが完了している**ことを前提としています。

- AWS環境にCEDIXがデプロイ済み（[README.md](README.md)のデプロイ手順を完了）
- 少なくても以下のCloudFormationスタックが正常に動作している：
  - `{stackPrefix}-foundation`
  - `{stackPrefix}-application`
  - `{stackPrefix}-frontend`
  - `{stackPrefix}-keys`

### 必要なソフトウェア

| ソフトウェア | バージョン | 用途 |
| --- | --- | --- |
| **Docker** | 最新版 | コンテナ実行環境 |
| **Docker Compose** | v2.0以上 | マルチコンテナ管理 |
| **AWS CLI** | v2.0以上 | AWS認証情報・リソース取得 |
| **Python** | 3.11以上 | バックエンド開発（オプション） |
| **Node.js** | v20以上 | フロントエンド開発 |
| **Git** | 最新版 | ソースコード管理 |

### AWS認証情報

ローカル開発では、AWS CLIの認証情報を使用してAWSリソースにアクセスします。認証が出来ているかをご確認ください。
```bash
# AWS認証情報が設定されているか確認
aws sts get-caller-identity

# 認証情報が未設定の場合
aws configure
```

### 
### データベース設計書
- [Database設計書](_doc/README_DEV.md) を参考ください


## 開発環境の確認
### 1. CDK設定の確認
ローカル開発では、デプロイ済みのAWSリソースから設定を自動取得します。デプロイ時に設定済みなはずですが、 `cdk.config.json` は重要です。
**cdk.config.json 設定例**:
```json
{
  "stackPrefix": "cedix-dev",
  "region": "ap-northeast-1",
  "s3AdditionalPrefix": "your-unique-prefix"
}
```

### 2. 各Docker起動用の start.sh について
ローカル開発は、各サービスの`start.sh`スクリプトを利用して行ってください。
各サービスの`start.sh`スクリプトはローカル開発用のDockerを起動しますが、その際に、Deploy済みのCloudFormationスタックからDockerで利用する各種情報を自動取得します。以下のその例です：
- Cognito User Pool ID / Client ID
- CloudFront Domain / Key Pair ID
- S3 Bucket Name
- OpenSearch Serverless Endpoint
- その他のAWSリソース情報

---

## ローカル開発環境の起動
### 起動コマンドの共通パターン
全てのサービスで共通の起動スクリプト`start.sh`を使用します。
```bash
# 通常起動（既存のコンテナイメージを使用）
./start.sh

# ビルドして起動（コード変更後）
./start.sh --build

# キャッシュなしでビルドして起動（依存関係変更後）
./start.sh --build-no-cache
```

### 起動オプション
| オプション | 説明 | 使用タイミング |
| --- | --- | --- |
| なし | 既存のコンテナイメージで起動 | 通常の開発時 |
| `--build` | コードをビルドしてから起動 | コード変更後 |
| `--build-no-cache` | キャッシュなしでビルドして起動 | requirements.txt変更後、依存関係追加時 |

---

## 各サービスの起動方法
### 1. API Gateway（統合APIサーバー）
**概要**: 全てのバックエンドAPIを統合したメインエントリーポイント
**起動方法**:
```bash
cd backend/api_gateway
./start.sh
```

**アクセス**:
- URL: `http://localhost:8000`
- API Docs: `http://localhost:8000/docs`（Swagger UI）
- Health Check: `http://localhost:8000/health`

**含まれるAPI**:
- Camera Management API（カメラ管理）
- Collector API（データ収集）
- Detector API（AI検出）
- Analytics API（分析・検索）
- Place API（現場管理）
- Test Movie API（テストムービー）

**環境変数**:
- `AUTH_MODE=middleware`: 認証モード（middleware/none）
- `DEPLOY_MODE=production`: デプロイモード
- `CAMERA_RESOURCE_DEPLOY=on`: カメラリソースデプロイ制御
- `COLLECTION_RESOURCE_DEPLOY=off`: コレクションリソースデプロイ制御
- `DETECTOR_RESOURCE_DEPLOY=on`: Detectorリソースデプロイ制御

**ホットリロード**:
- `backend/api_gateway`配下のコード変更は自動反映
- `backend/shared`、`backend/camera_management`等の共通モジュールも監視対象

---

### 2. Ingestion（OpenSearchデータ取り込み）
**概要**: DynamoDB Streams → OpenSearch Serverlessへのデータ取り込み
**起動方法**:
```bash
cd backend/analytics/docker/ingestion
./start.sh
```

**機能**:
- DynamoDB DetectLogテーブルの変更を監視
- OpenSearch Serverlessへインデックス登録
- 検索用データの構造化

**接続先**:
- DynamoDB: `{stackPrefix}-detectLog`テーブル
- OpenSearch: CloudFormationから取得したエンドポイント

---

### 3. Collector（データ収集サービス）

#### 3.1 HlsYolo（HLS + YOLOv9物体検出）

**概要**: HLSストリームから映像を取得し、YOLOv9で物体検出・ByteTrackで追跡

**起動方法**:
```bash
cd backend/collector/docker/hlsyolo
./start.sh
```

**機能**:
- HLSストリームからフレーム抽出
- YOLOv9（MIT版）による物体検出（人・車両等80クラス）
- ByteTrackアルゴリズムによる物体追跡
- イベント駆動型検出（class_detect、area_detect）
- EventBridge経由でDetectorへ通知

#### 3.2 HlsRec（HLS画像/動画キャプチャ）

**概要**: HLSストリームから画像・動画をキャプチャ

**起動方法**:
```bash
cd backend/collector/docker/hlsrec
./start.sh
```

**機能**:
- HLSストリームから定期的に画像・動画を取得
- S3バケットへ保存
- DynamoDBへメタデータ登録

#### 3.3 S3Rec（S3ファイル収集）

**概要**: S3バケットから静的な画像・動画ファイルを収集

**起動方法**:
```bash
cd backend/collector/docker/s3rec
./start.sh
```

**機能**:
- S3バケットのEventBridgeイベントを監視
- 新規アップロードファイルを処理
- DynamoDBへメタデータ登録

#### 3.4 S3Yolo（S3 + YOLOv9物体検出）

**概要**: S3バケットにアップロードされた画像に対してYOLOv9で物体検出

**起動方法**:
```bash
cd backend/collector/docker/s3yolo
./start.sh
```

**機能**:
- S3バケットのEventBridgeイベントを監視
- YOLOv9（MIT版）による物体検出（人・車両等80クラス）
- イベント駆動型検出（class_detect）
- EventBridge経由でDetectorへ通知

**注意**:
- HlsYoloと異なり、リアルタイムストリーム処理ではなくバッチ処理
- 侵入/退出検知（area_detect）は非対応（静止画のため）

---

### 4. Detector（AI検出サービス）

#### Bedrock Detector（AWS Bedrock映像解析）

**概要**: AWS Bedrock（Claude 3.5 Sonnet v2等）による映像解析

**起動方法**:
```bash
cd backend/detector/docker/bedrock
./start.sh
```

**機能**:
- EventBridge駆動でCollectorからのイベントを受信
- AWS Bedrockのマルチモーダルモデルで映像解析
- カスタムプロンプトによる柔軟な解析
- 検出ログをDynamoDB + OpenSearchへ保存
- タグ自動生成


---

### 5. Camera Management（カメラ管理）

#### RTSP Receiver（RTSPカメラ接続）

**概要**: RTSPカメラからの映像をKinesis Video Streamsへ転送

**起動方法**:
```bash
cd backend/camera_management/docker/rtsp_reciver
./start.sh
```

**機能**:
- RTSPストリームを受信
- Kinesis Video Streamsへ転送
- HLS配信用エンドポイント生成

**設定**:
- カメラ作成時にCloudFormationで自動デプロイ
- ローカル開発では手動起動

---

### 6. Frontend（React SPA）

#### Web App（React + Material-UI）

**概要**: ユーザー向けWebアプリケーション

**起動方法**:

**ローカルAPIを参照する場合**:
```bash
cd frontend/web_app
./start.sh
```

**デプロイ済みのAPIを参照する場合**:
```bash
cd frontend/web_app
./start.sh --prod
```

**アクセス**:
- URL: `http://localhost:3000`

**機能**:
- Cognito認証（ログイン・ログアウト）
- ライブダッシュボード（最大12カメラ同時表示）
- カメラビュー（タイムライン、検出マーカー）
- 検索・分析（OpenSearch全文検索）
- インサイト（タグ別時系列グラフ）
- ブックマーク管理

**開発時の注意**:
- `--prod`オプションを使用すると、デプロイ済みのAPI Gatewayに接続
- オプションなしの場合は`http://localhost:8000`のローカルAPIに接続

---

### 7. Sample Data（サンプルデータ投入）

**概要**: DynamoDBへサンプルデータを投入

**起動方法**:
```bash
cd infrastructure/testdata
./start.sh
```

**オプション**:
- `--lang ja`: 日本語データ（デフォルト）
- `--lang en`: 英語データ
- `--build`: ビルドして実行

**機能**:
- Tagのサンプルデータを作成
- 開発・テスト用のデータセットアップ

