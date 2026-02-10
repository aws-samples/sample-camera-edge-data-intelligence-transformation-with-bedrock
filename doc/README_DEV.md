# 開発者ガイド
このドキュメントは、本サンプルプロジェクトをローカル環境で開発するための手順を説明します。
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
### 1. 開発環境
開発環境については 現状は Macでのみ動作確認をしています。
- OS
  - macOS Monterey 以降
- メモリ
  - 16GB以上推奨

### 2. CDK設定の確認
ローカル開発では、デプロイ済みのAWSリソースから設定を自動取得します。デプロイ時に設定済みなはずですが、 `cdk.config.json` は重要です。
**cdk.config.json 設定例**:
```json
{
  "stackPrefix": "cedix-dev",
  "region": "ap-northeast-1",
  "s3AdditionalPrefix": "your-unique-prefix"
}
```

### 3. 各Docker起動用の start.sh について
ローカル開発は、各サービスの`start.sh`スクリプトを利用して行ってください。
```bash
# 通常起動（既存のコンテナイメージを使用）
./start.sh

# ビルドして起動（コード変更後）
./start.sh --build

# キャッシュなしでビルドして起動（依存関係変更後）
./start.sh --build-no-cache
```

起動オプション
| オプション | 説明 | 使用タイミング |
| --- | --- | --- |
| なし | 既存のコンテナイメージで起動 | 通常の開発時 |
| `--build` | コードをビルドしてから起動 | コード変更後 |
| `--build-no-cache` | キャッシュなしでビルドして起動 | requirements.txt変更後、依存関係追加時 |


## 各サービスの起動方法
### 1. Camera Management（カメラ管理）

#### 1.1 RTSP Receiver（RTSPカメラ接続）

**概要**: RTSPカメラからの映像をKinesis Video Streamsへ転送

**起動方法**:
```bash
cd backend/camera_management/docker/rtsp_reciver
./start.sh
```

**機能**:
- RTSPストリームを受信 (RTSP Receiverがクライアントなので、RTSPサーバーに接続して映像を受信する)
- GStreamer経由でKinesis Video Streamsへ転送


#### 1.2 RTMP Server（RTMPカメラ接続）

**概要**: RTMPカメラからの映像を受信し、Kinesis Video Streamsへ転送

**起動方法**:
```bash
cd backend/camera_management/docker/rtmp_server
./start.sh
```

**機能**:
- RTMP ストリームを受信 (RTMP Server がサーバーなので、RTSPクライアントからの映像を受信する)
- GStreamer経由でKinesis Video Streamsへ転送

**ポート**:
- `1935`: RTMP（非暗号化）


### 2. Collector（データ収集サービス）

#### 2.1 HlsRec（HLS画像/動画キャプチャ）

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
- 発火するイベントは（save_image、save_video）
- EventBridge経由でDetectorへ通知
- ECS サービスで稼働

#### 2.2 HlsYolo（HLS + YOLOv9物体検出）

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
- 発火するイベントは（class_detect、area_detect）
- EventBridge経由でDetectorへ通知
- ECS サービスで稼働


#### 2.3 S3Rec（S3ファイル収集）

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
- 発火するイベントは（save_image、save_video）
- EventBridge経由でDetectorへ通知
- EventBridge +  Lambdaで稼働

#### 2.4 S3Yolo（S3 + YOLOv9物体検出）

**概要**: S3バケットにアップロードされた画像に対してYOLOv9で物体検出

**起動方法**:
```bash
cd backend/collector/docker/s3yolo
./start.sh
```

**機能**:
- S3バケットのEventBridgeイベントを監視
- YOLOv9（MIT版）による物体検出（人・車両等80クラス）
- 侵入/退出検知（area_detect）は非対応（静止画のため）
- イベント駆動型検出（class_detect）
- EventBridge経由でDetectorへ通知
- EventBridge +  Lambdaで稼働

---

### 3. Detector（AI検出サービス）

#### Bedrock Detector（AWS Bedrock映像解析）

**概要**: AWS Bedrock（生成AIモデル）による映像解析

**起動方法**:
```bash
cd backend/detector/docker/bedrock
./start.sh
```

**機能**:
- EventBridge駆動でCollectorからのイベントを受信
- AWS Bedrockのマルチモーダルモデルで映像解析
- カスタムプロンプトによる柔軟な解析
- 検出ログをDynamoDB + OpenSearchへ保存 (OpenSearchはDynamoDBStream+Lambda経由)

---

### 4. API Gateway（統合APIサーバー）
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

**Dockerのホットリロード**:
- `backend/api_gateway`配下のコード変更は自動反映
- `backend/shared`、`backend/camera_management`等の共通モジュールも監視対象

---

### 5. Ingestion（OpenSearchデータ取り込み）
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
