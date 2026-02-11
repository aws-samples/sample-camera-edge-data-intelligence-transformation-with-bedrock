# Quick Start RTSP Camera (ローカルネットワーク経由)

本ドキュメントでは、**AWSから直接RTSPカメラに接続できない場合**のセットアップ手順を記載します。

ルーターのポート開放ができない環境では、ローカルネットワーク内にRTSP Receiverを設置し、Kinesis Video Streams (KVS) 経由で映像をAWSに送信します。

基本的な操作（Collector、Detector、分析機能など）は RTSPカメラのQuick Startと同じですので、そちらもご確認ください。

[Quick Start RTSPカメラ](./QUICK_START_RTSP.md)

---

## アーキテクチャ概要

```
[RTSPカメラ] --RTSP--> [RTSP Receiver (ローカルPC)] --KVS--> [KVS on AWS]
                        (Docker Container)
```
- **RTSP Receiver**: ローカルネットワーク内でDockerコンテナとして動作
- **Kinesis Video Streams**: 映像をAWSに安全に転送
---

## 前提条件

### ローカルPC要件

| 項目 | 要件 |
| --- | --- |
| OS | Linux推奨（Ubuntu 20.04以降）、macOS、Windows (WSL2) |
| Docker | Docker Engine 20.10以降 |
| AWS CLI | v2以降（認証情報の設定に使用） |
| ネットワーク | RTSPカメラと同一ネットワーク、インターネット接続必須 |
| メモリ | 4GB以上推奨 |

### OSについて
Dockerが動けばどのOSでも問題ありませんが、Windowsでは start.sh が使えませんので、同様の機能を持つ スクリプトを別途作成必要です。どうしてもWindows でしたら WSL2 をご利用頂くのが最もスムーズです。

### AWS認証情報
ローカルPCには以下のいずれかの方法でAWS認証情報を設定する必要があります：
1. **IAM User の長期クレデンシャル**（開発・検証用）
2. **IAM Roles Anywhere**（本番推奨）
3. **AWS IoT 認証機構**（IoTデバイス向け）

> ⚠️ **セキュリティ注意**: 長期クレデンシャルは流出リスクがあるため、本番環境では IAM Roles Anywhere または AWS IoT 認証の利用を推奨します。

---

## セットアップ手順
### Camera を作成する（KVSエンドポイント
カメラ画面にて、CONNECT CAMERA をクリックします。
![カメラ接続](image/1770694215288.png)
名前と場所を入れて、タイプにて Kinesis を選択してSAVEボタンを押す。カメラ作成中のメッセージがでるため完了するまで待機する。CloudFormation でのデプロイのため一定時間かかります。
※ RTSP Reciverはローカルでセットアップするので、AWS側で必要なのは Kinesis Video Streams のエンドポイントとなります。そのため、Kinesisだけを作成します![image/1770823956482.png](image/1770823956482.png)
作成が完了すると、**Kinesis Stream ARN **が生成されます。この値を**必ずコピー**してください。ただ、必要なのは ARN の内、「**Stream Name**」の部分のみとなります
arn:aws:kinesisvideo:<regnion>:<account>:stream/<cameraid>-stream/<strem_name>
の <strem_name> の部分だけあれば十分です
![image/1770824243126.png](image/1770824243126.png)
> 📝 **重要**: Stream Name は後の手順で RTSP Receiver の設定に使用します。

---

### RTSP Receiver をセットアップする
ローカルPCで以下の手順を実行します。

#### リポジトリをクローン（まだの場合）
```bash
git clone https://github.com/your-org/sample-camera-edge-data-intelligence-transformation-with-bedrock.git
cd sample-camera-edge-data-intelligence-transformation-with-bedrock
```

#### RTSP Receiver ディレクトリに移動
```bash
cd backend/camera_management/docker/rtsp_reciver
```

#### 環境変数ファイル (.env) を作成
`.env` ファイルを作成し、AWS認証情報を設定します。
なお、**本設定は長期クレデンシャルを利用しており、あくまでテスト用の設定だとご理解ください。**
```bash
# .env ファイルを作成
cat << 'EOF' > .env
AWS_ACCESS_KEY_ID=<your-access-key-id>
AWS_SECRET_ACCESS_KEY=<your-secret-access-key>
EOF
```
> ⚠️ **セキュリティ注意**: `.env` ファイルは `.gitignore` に含まれていますが、認証情報の取り扱いには十分注意してください。

#### start.sh を編集
`start.sh` を開き、以下の環境変数を設定します。
```bash
# ========================================
# 0. 環境変数の設定
# ========================================
export STREAM_NAME="<コピーした Stream Name>"
export RTSP_URL="rtsp://<RTSPカメラのIPアドレス>:<ポート>/<パス>"
export GSTREAMER_LOG_MODE="stdout"  # デバッグ時は stdout、本番は null
```

**設定例:**
| 変数 | 説明 | 例 |
| --- | --- | --- |
| `STREAM_NAME` | CEDIXで作成したKVSストリーム名 | `1770523904461` |
| `RTSP_URL` | RTSPカメラのURL | `rtsp://192.168.1.100:554/stream1` |
| `GSTREAMER_LOG_MODE` | ログ出力モード | `stdout` または `null` |

**RTSPカメラURL形式の例:**
```bash
# 一般的なRTSPカメラ
export RTSP_URL="rtsp://192.168.1.100:554/stream1"

# 認証が必要な場合
export RTSP_URL="rtsp://username:password@192.168.1.100:554/stream1"

# RTSPS（TLS暗号化）の場合
export RTSP_URL="rtsps://192.168.1.100:8322/stream"
```

---

### Step 4: RTSP Receiver を起動する

#### 初回起動（ビルドが必要）
```bash
./start.sh --build
```
> ⏱️ **注意**: 初回ビルドは KVS Producer SDK のコンパイルを含むため、**15〜30分**かかります。2回目以降はキャッシュが使用されるため高速です。

#### 2回目以降の起動
```bash
./start.sh
```

#### 起動確認
正常に起動すると、以下のようなログが表示されます：
```
==========================================
RTSP Receiver 起動スクリプト (開発環境)
==========================================
✅ ビルダーイメージが既に存在します: cedix-rtsp-receiver-builder:v1.0.0
   キャッシュを使用して高速ビルドします

環境変数の設定:
  - STREAM_NAME: place-00001-entrance-stream
  - RTSP_URL: rtsp://192.168.1.100:554/stream1
  - BUILDER_TAG: cedix-rtsp-receiver-builder:v1.0.0
  - GSTREAMER_LOG_MODE: stdout

AWS設定:
  - AWS_REGION: ap-northeast-1
  - STACK_PREFIX: cedix

==========================================
Docker Compose で起動中...
==========================================
GStreamerパイプラインを開始します...
RTSPソースへの接続を確認中...
RTSPソースへの接続確認完了
GStreamerパイプラインを起動中...
パイプラインが正常に起動しました。PID: 12345
🚀 パイプライン開始: 2025-02-11 10:30:00
```

---

### Webで映像を確認する
カメラ画面で、先程作成したカメラをクリックします。
LIVE タブに映像が表示されていれば接続成功です。
![image/1770824774635.png](image/1770824774635.png)
> 📝 **注意**: 初回接続時は映像表示まで1〜2分かかる場合があります。LIVE画面を再読み込みしながら確認してください。
