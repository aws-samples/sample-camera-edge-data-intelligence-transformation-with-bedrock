# RTMP/RTMPS Server with AWS KVS Forwarding

gortmplib ベースの軽量 RTMP/RTMPS サーバー。受信したストリームを AWS Kinesis Video Streams に転送します。

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                     rtmp_kvs                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │ RTMPS/RTMP   │───▶│   gortmplib  │───▶│  GStreamer   │  │
│  │   Client     │    │   Server     │    │   + kvssink  │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│       :1936               H.264              ↓              │
│       :1935              Decoder          AWS KVS           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 特徴

- **gortmplib 使用**: Go 1.24 以上で動作（MediaMTX 不要）
- **RTMP/RTMPS 両対応**: TLS 暗号化をサポート
- **KVS 直接転送**: 受信した H.264 を GStreamer 経由で KVS に送信
- **軽量**: MediaMTX より依存が少なく、シンプル

## 必要要件

- Docker / Docker Compose
- AWS アカウント（KVS 権限付き）

## セットアップ

### 1. 環境変数の設定

```bash
cp .env.example .env
# .env を編集して AWS 認証情報を設定
```

### 2. TLS 証明書の生成（RTMPS 用）

```bash
./generate-certs.sh
```

### 3. 起動

```bash
./start.sh
# または
./start.sh --build  # 再ビルド
```

## 接続方法

### RTMP（非暗号化）

```bash
ffmpeg -re -i video.mp4 -c copy -f flv rtmp://localhost:1935/live/stream
```

### RTMPS（TLS 暗号化）

```bash
ffmpeg -re -i video.mp4 -c copy -f flv rtmps://localhost:1936/live/stream
```

## 環境変数

| 変数 | 必須 | 説明 | デフォルト |
|------|------|------|------------|
| `AWS_REGION` | ✅ | AWS リージョン | - |
| `AWS_ACCESS_KEY_ID` | ✅ | AWS アクセスキー | - |
| `AWS_SECRET_ACCESS_KEY` | ✅ | AWS シークレットキー | - |
| `STREAM_NAME` | ✅ | KVS ストリーム名 | - |
| `RETENTION_PERIOD` | | 保持期間（時間） | 24 |
| `FRAGMENT_DURATION` | | フラグメント長（ms） | 2000 |
| `STORAGE_SIZE` | | ストレージサイズ（MiB） | 512 |

## ポート

| ポート | プロトコル | 説明 |
|--------|------------|------|
| 1935 | RTMP | 非暗号化接続 |
| 1936 | RTMPS | TLS 暗号化接続 |

## ライセンス

- **gortmplib**: MIT License
- **KVS Producer SDK**: Apache 2.0 License

## 関連プロジェクト

- [gortmplib](https://github.com/bluenviron/gortmplib) - RTMP ライブラリ
- [MediaMTX](https://github.com/bluenviron/mediamtx) - フル機能メディアサーバー
- [KVS Producer SDK](https://github.com/awslabs/amazon-kinesis-video-streams-producer-sdk-cpp) - AWS KVS SDK
