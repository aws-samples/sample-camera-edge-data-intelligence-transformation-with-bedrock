# Dynamo DB Tables Structure

### 1. Palace (場所) Table (cedix-place)
Stores information about locations.
| Attribute | Type | Description |
| --- | --- | --- |
| place_id | String  (pk) | 場所の一意識別子 |
| name | String | 場所の名前 |


### 2. テスト動画 () Table (cedix-test-movie)
| Attribute | Type | Description |
| --- | --- | --- |
| test_movie_id | String  (pk) | テスト動画の一意識別子 |
| name | String | テスト動画の名前（ユーザー指定、任意） |
| type | String | カメラエンドポイントテスト用の動画再生サービスの設置(none, rtsp, rtmp) |
| cloudformation_stack | String | カメラエンドポイントテスト用の動画再生サービス(RTSP/RTMP)のCloudFormationスタック名 |
| test_movie_s3_path | String | テスト動画のS3パス |
| rtsp_url | String | RTSPのURL |
| create_at | String | 作成日時 (UTC フォーマットは本プロジェクトのルールに従う) |
| update_at | String | 更新日時 (UTC フォーマットは本プロジェクトのルールに従う) |

### 3. Camera (カメラ) Table (cedix-camera)
Stores information about cameras.
| Attribute | Type | Description |
| --- | --- | --- |
| camera_id | String  (pk) | カメラの一意識別子 |
| name | String | カメラの名前 |
| place_id | String | カメラが設置されている場所への参照 |
| type | String | カメラの種類 (例: kinesis, vsaas, s3) |
| vsaas_device_id | String | VSaaSデバイスID（該当する場合） |
| vsaas_apikey | String | VSaaS APIキー（該当する場合） |
| kinesis_streamarn | String | Kinesisストリーム名（該当する場合） |
| s3path | String | type s3 で利用。アップロードしてもらうパス |
| capture | String | キャプチャ画像のS3パス |
| aws_access_key | String | AWSアクセスキー(kinesis。他アカウントにアクセスする際に利用) |
| aws_secret_access_key | String | AWSシークレットアクセスキー(kinesis。他アカウントにアクセスする際に利用) |
| aws_region | String | region (kinesis。他アカウントにアクセスする際に利用) |
| camera_endpoint | String | カメラエンドポイントの設置(none, rtsp, rtmp) |
| camera_endpoint_cloudformation_stack | String | カメラエンドポイント(RTSP)用のCloudFormationスタック名 |
| rtsp_url | String | RTSPサーバーのURL。camera_endpointがRTSPの場合に指定必須 |
| rtmp_nlb_id | String | RTMP用NLBのID（camera_endpoint='rtmp'の場合） |
| rtmp_port | Number | RTMP用ポート番号（camera_endpoint='rtmp'の場合） |
| rtmp_stream_key | String | RTMP用ストリームキー（32文字英数字ランダム生成） |
| rtmp_endpoint | String | RTMP接続URL（自動生成） |
| rtmp_kvs_stream_name | String | RTMPで使用するKVSストリーム名 |
| rtmp_server_stack | String | RTMPサーバー用CloudFormationスタック名 |



### 4. Camera Collector (カメラコレクター) Table (cedix-collector)
Stores information about data collection methods for cameras.
| Attribute | Type | Description |
| --- | --- | --- |
| collector_id | String  (pk、GSI-1-sk) | コレクターの一意識別子 |
| camera_id | String  (GSI-1-pk) | カメラの一意識別子 |
| collector | String | hlsRec/hlsYolo/s3Rec |
| collector_mode | String | image/video/image_and_video |
| cloudformation_stack | String | このコレクター用のCloudFormationスタック名 |
| capture_cron | String | カメラのCronスケジュール バッチキャプチャで利用 |
| capture_image_interval | Number | 間隔（秒）(例 5) リアルタイムキャプチャで利用 |
| capture_video_duration | Number | 動画の長さ（秒）（デフォルト: 60） リアルタイムキャプチャで利用 |
| model_path | String | デフォルトは、「yolo11n.pt」 ただ、Yoloが対応しているモデルなら自由に指定可能。URLで指定も可能 |
| capture_track_interval | Number | 間隔（ミリ秒）(例 200) トラッキング頻度で利用。ただし、capture_image_intervalのタイミングは必ず実施する。0　の場合、トラッキング機能はオフ |
| capture_track_image_flg | Boolean | capture_track_intervalとあわせて利用。detectorを利用する際は必ず画像を保存するが、それ以外で定期的に画像を保存していきたい場合はONにする。デフォルトは true |
| capture_track_image_counter | Number | capture_track_intervalとあわせて利用。何回に1回画像を保存するかを指定。1なら毎回。5なら5回に1回。デフォルトは 25 。capture_track_intervalが200だった場合は5秒に1回という計算になる |
| collect_class | String | 人や車など収集したいクラスを指定(YOLOv9を前提) 例: "person", "car", "person,car" |
| confidence | Number | YOLO検出の信頼度閾値（0.0～1.0）。この値以上の信頼度を持つ検出のみをfiltered_detectionsに含める。デフォルト: 0.5（50%） |
| track_eventtype | String | イベント発生条件。"class_detect": 指定クラス検出時に毎回、"area_detect": エリア侵入・退出時のみ |
| detect_area | String | 検出エリアのポリゴン座標（track_eventtype="area_detect"時に必須）。例: "[(400,200), (880,200), (880,520), (400,520)]" |
| area_detect_type | String | エリア判定方法（track_eventtype="area_detect"時のみ使用）。"center": 中心点判定（デフォルト、高速）、"intersects": 一部でも重なり判定（早期検出向け、高速）、"iou": IoU閾値判定（柔軟、やや低速） |
| area_detect_iou_threshold | Number | IoU閾値（area_detect_type="iou"時のみ使用）。0.0〜1.0。デフォルト: 0.5。0.0=少しでも重なり、0.5=半分以上、0.9=ほぼ全体 |
| area_detect_method | String | エリア検出の判定方法（track_eventtype="area_detect"時のみ使用）。"track_ids_change": track_idの変化で判定（デフォルト）、"class_count_change": 数の増減で判定（YOLO精度問題回避用） |
| related_data_update_time | String | 関連データ（コレクター自身またはデテクター）の最終更新時刻（ISO 8601形式）。コレクター更新時、デテクター追加/更新/削除時に自動更新される。この値の変更を検知して、実行中のコレクターを自動再起動する |
**GSI構成:**
- **GSI-1**: camera_id (PK) + collector_id (SK) - カメラ別のコレクター検索用

補足
capture_image_intervalのタイミングで画像を出す
capture_track_intervalのタイミングでトラッキング結果を残す（yoloは常時動くがそのトラック情報をどのタイミングで出すか）
detect_timing track-log

### 5. Camera Track Log (カメラトラックログ) Table (cedix-track-log)
このテーブルは、1フレームのYOLO検出結果を保存する。1フレームにつき1レコード。

| Attribute | Type | Description |
| --- | --- | --- |
| track_log_id | String(PK) | トラックログID（UUID） |
| camera_id | String | カメラの一意識別子 |
| collector_id | String(GSI-1-PK) | コレクターの一意ID |
| file_id | String | 該当する file_id |
| time | String(GSI-1-SK) | トラック時刻（ISO 8601形式） |
| track_alldata | Map | YoloがDetect(トラッキング)した全trackデータ（key: track_id, value: track情報） |
| track_classdata | Map | track_alldataのうち、collect_classに該当するclassだけに絞ったデータ（key: track_id, value: track情報） |
| area_in_data | Map | track_classdataのうち、areaに入っている扱いとなったtrackデータ（key: track_id, value: track情報） |
| area_out_data | Map | track_classdataのうち、areaに入っていない扱いとなったtrackデータ（key: track_id, value: track情報） |
| area_in_count | Number | area_in_dataの数 |
| area_out_count | Number | area_out_dataの数 |
| entered_ids | String | 今回新たにエリアに侵入したtrack_idのリスト（パイプ区切り、例: "1 | 2 | 3"） |
| entered_ids_count | Number | 今回新たにエリアに侵入したtrack数（前回と比較した差分） |
| exited_ids | String | 今回新たにエリアから退出したtrack_idのリスト（パイプ区切り、例: "4 | 5"） |
| exited_ids_count | Number | 今回新たにエリアから退出したtrack数（前回と比較した差分） |
**GSI構成:**
- **GSI-1**: collector_id (PK) + time (SK) - コレクター別の時系列検索用
- **GSI-2**: file_id (PK) - ファイルIDからのトラックログ検索用



### 6. File (ファイル) Table (cedix-file)
Stores information about video files.

| Attribute | Type | Description |
| --- | --- | --- |
| file_id | String  (pk) | ファイルの一意識別子 |
| camera_id | String (GSI-3-pk) | 動画を録画したカメラへの参照 |
| collector_id | String | コレクターの一意ID |
| file_type | String | image/video |
| collector_id_file_type | String (GSI-1-pk) | 結合キー (collector_id + " | " + file_type) |
| start_time | String (GSI-1-sk) (GSI-3-sk) | 動画/画像の開始時刻 |
| end_time | String | 動画/画像の終了時刻(画像では実質使わない) |
| s3path | String (GSI-2-pk) | 動画ファイルまたは画像フォルダーへのS3パス。s3://<bucket_name>/<collector_id>/<file_type>/....となること |
| s3path_detect | String | 動画ファイルまたは画像フォルダーへのS3パス。s3://<bucket_name>/<collector_id>/<file_type>_detect/....となること。 |
**GSI構成:**
- **GSI-1**: collector_id_file_type (PK) + start_time (SK) - コレクター・ファイルタイプ別検索用（メイン検索GSI）
- **GSI-2**: s3path (PK) - S3パス検索用
- **GSI-3**: camera_id (PK) + start_time (SK) - カメラ別の基本検索用

### 7. Detector (検出) Table (cedix-detector)
Stores information about detection configurations.

| Attribute | Type | Description |
| --- | --- | --- |
| detector_id | String (pk) | 検出器の一意識別子 |
| camera_id | String(GSI-2-pk) | カメラへの参照 |
| collector_id | String(GSI-2-sk) | コレクターの一意ID |
| file_type | String | 検出対象のファイルタイプ (image/video) |
| collector_id_file_type | String (GSI-1-pk) | 結合キー (collector_id + " | " + file_type) |
| trigger_event | String | SaveVideoEvent/SaveImageEvent/AreaDetectEvent/ClassDetectEvent |
| detector | String | 検出方法 (bedrock/sagemaker/custom) |
| detect_interval | Number | 間隔（ミリ秒）(例 5000) リアルタイムキャプチャで利用 |
| model | String | AIモデル |
| system_prompt | String | 役割の定義(システムプロンプト) |
| detect_prompt | String | 検出条件/何を検出するのか (検出プロンプト) |
| tag_prompt_list | Set | タグ出力判定基準 (検出したものがどういう基準を満たしていたらタグを出力するのか) cedix-tag の tag_id,tag_name, tag_prompt と、notify_flg (Boolean) と、compare_file_flg (Boolean) |
| tag_list | String | 検出するタグのリスト（パイプ区切り。tag_name ） |
| compare_file_flg | Boolean | 古いファイルと比較するフラグ |
| max_tokens | Number | 最大トークン数 |
| temperature | Number | 生成の温度パラメータ |
| top_p | Number | Top-pサンプリングパラメータ |
| lambda_endpoint_arn | String | lambdaのARN |
| event_notify | Boolean | イベント情報をdetect-logに保存してかつ notify するかのフラグ。デフォルト falseだが、AreaDetectEvent はデフォルト true |
**GSI構成:**
- **GSI-1**: collector_id_file_type (PK) - コレクター・ファイルタイプ別検索用
- **GSI-2**: camera_id (PK) + collector_id (SK) - カメラ別検索用

### 8. DetectLog (検出ログ) Table (cedix-detect-log)
Stores detection results and logs.

| Attribute | Type | Description |
| --- | --- | --- |
| detect_log_id | String (pk) | 検出ログの一意識別子 |
| detector_id | String | 検出器の一意識別子 |
| camera_id | String | カメラへの参照 |
| collector_id | String | コレクターの一意ID |
| file_type | String | 検出対象のファイルタイプ (image/video) |
| collector_id_file_type | String (GSI-1-pk) | 結合キー (collector_id + " | " + file_type) |
| file_id | String (GSI-3-pk) | 処理されたファイルへの参照 |
| s3path | String | 検出結果画像のS3パス |
| s3path_detect | String | 動画ファイルまたは画像フォルダーへのS3パス。s3://<bucket_name>/<collector_id>/<file_type>_detect/....となること。 |
| start_time | String(GSI-1-sk) (GSI-2-sk) | 検出開始時刻 |
| end_time | String | 検出終了時刻 |
| detect_result | String | 検出結果の詳細 |
| detect_tag | Set | 検出されたタグのセット |
| detect_notify_flg　(GSI-2-pk) | Boolean | 通知が送信されたかどうか |
| detect_notify_reason | String | 通知の理由 |
| place_id | String | 場所への参照 |
| place_name | String | 場所の名前 |
| camera_name | String | カメラの名前 |
| collector | String | 使用された収集方法 |
| detector | String | 使用された検出方法 (vlmImage/vlmVideo/cvImage) |
| track_log_id | String | 該当するトラックログID |
| trigger_event | String | SaveVideoEvent/SaveImageEvent/AreaDetectEvent/ClassDetectEvent |
**GSI構成:**
- **GSI-1**: collector_id_file_type (PK) + start_time (SK) - コレクター・ファイルタイプ別検索用
- **GSI-2**: detect_notify_flg (PK) + start_time (SK) - 通知フラグ別検索用
- **GSI-3**: collector_id_file_type (PK) + start_time (SK) - タイムライン表示最適化用（ProjectionType: ALL、2025-11-19変更）※GSI-1と重複のため削除予定
- **GSI-4**: file_id (PK) + detector_id (SK) - ファイル・検出器ID別検索用
- **GSI-5**: collector_id_detector_id (PK) + start_time (SK) - has_detect判定用（ProjectionType: KEYS_ONLY、2026-01-27追加）

### 9. DetectLogTag (検出ログのタグ) Table (cedix-detect-log-tag)
cedix-detect-logにて検出されたタグを、全体/場所別/カメラ別に蓄積する。
| Attribute | Type | Description |
| --- | --- | --- |
| data_type | String (PK) | TAG or PLACE\ | {place_id} or CAMERA\ | {camera_id} |
| detect_tag_name | String (SK) | 検出されたタグの名前 |

**data_type の値:**
- `TAG` - 全体のタグ一覧
- `PLACE|{place_id}` - 特定の場所で検出されたタグ
- `CAMERA|{camera_id}` - 特定のカメラで検出されたタグ

**Query例:**
```python
# 全タグ取得
table.query(KeyConditionExpression="data_type = :dt", ExpressionAttributeValues={':dt': 'TAG'})

# 特定place_idのタグ取得
table.query(KeyConditionExpression="data_type = :dt", ExpressionAttributeValues={':dt': f'PLACE|{place_id}'})

# 特定camera_idのタグ取得
table.query(KeyConditionExpression="data_type = :dt", ExpressionAttributeValues={':dt': f'CAMERA|{camera_id}'})
```

### 10. 時系列データ作成 (cedix-detect-tag-timeseries)
| Attribute | Type | Description |
| --- | --- | --- |
| tag_name | String (PK) | タグ名 |
| time_key | String (SK, GSI-1-SK、GSI-2-SK) | 時間キー (MINUTE | yyyy-mm-ddThh:mm, HOUR | yyyy-mm-ddThh, DAY | yyyy-mm-dd ここの時刻は 集計開始時間ベース) |
| count | Number | カウント数 |
| place_id | String | 場所ID（GSI用） |
| camera_id | String | カメラID（GSI用） |
| place_tag_key | String (GSI-1-PK) | 結合キー (place_id + " | " + tag_name) |
| camera_tag_key | String (GSI-2-PK) | 結合キー (camera_id + " | " + tag_name) |
| start_time | String | 集計開始時間 |
| end_time | String | 集計終了時間 |
| granularity | String | 粒度 (MINUTE/HOUR/DAY) |
| data_type | String | TAG/PLACE/CAMERA (どの集計単位のデータか) |
[GSI-設計]
// GSI-1: 場所＞タグ検索用
GSI-1-PK: place_tag_key
GSI-1-SK: time_key

// GSI-2: カメラ＞タグ検索用
GSI-2-PK: camera_tag_key
GSI-2-SK: time_key

(1) タグごとの時系列
PK = "tag1"
SK between "MINUTE|2025-01-12T00:00" and "MINUTE|2025-01-12T23:59"

(2) 場所＞タグごとの時系列
PK = "place01|tag1"
SK between "MINUTE|2025-01-12T00:00" and "MINUTE|2025-01-12T23:59"

(3) カメラ＞タグごとの時系列
PK = "camera01|tag1"
SK between "MINUTE|2025-01-12T00:00" and "MINUTE|2025-01-12T23:59"

### 11. ブックマーク (cedix-bookmark)
ユーザーが作成したブックマーク情報を保存する。
| Attribute | Type | Description |
| --- | --- | --- |
| bookmark_id | String (pk) | ブックマークの一意識別子 |
| bookmark_name | String | ブックマークの名前 |
| username | String | Cognitoのusername（メールアドレス） |
| updatedate | String (GSI-1-pk) | 作成日時/更新日時 |
(GSI構成)
- GSI-1: updatedate (pk) - 更新日時での検索用

### 12. ブックマーク詳細 (cedix-bookmark-detail)
ブックマークに含まれる具体的なファイルやデータの詳細情報を保存する。
| Attribute | Type | Description |
| --- | --- | --- |
| bookmark_id | String (pk, GSI-1-pk) | ブックマークの一意識別子 |
| bookmark_no | Number (sk) | ブックマーク内での順序番号 |
| file_id | String | ファイルへの参照 |
| collector_id | String | コレクターの一意ID |
| collector | String | コレクター |
| file_type | String | ファイルのタイプ (image/video) |
| datetime | String(GSI-1-sk) | ファイルの日時 (YYYYMMDDHHMM形式) |
| camera_id | String | カメラの一意識別子 |
| camera_name | String | カメラの名前 |
| place_id | String | 場所の一意識別子 |
| place_name | String | 場所の名前 |
| detector_id | String | 検出器の一意識別子 |
| detector | String | 使用された検出方法 (vlmImage/vlmVideo/cvImage) |

### 13. タグカテゴリ (cedix-tag-category)
タグを分類するためのカテゴリ情報を保存する。
| Attribute | Type | Description |
| --- | --- | --- |
| tagcategory_id | String (pk) | タグカテゴリの一意識別子 |
| tagcategory_name | String | タグカテゴリの名前 |
| updatedate | String | 更新日時 |
| system_prompt | String | 役割の定義(システムプロンプトテンプレート) |
| detect_prompt | String | 検出条件/何を検出するのか (プロンプトテンプレート) |

### 14. タグ (cedix-tag)
検出タグのマスター情報を保存する。
| Attribute | Type | Description |
| --- | --- | --- |
| tag_id | String (pk) | タグ名（一意識別子） |
| tag_name | String (GSI-2-pk, GSI-1-sk) | タグ名（一意識別子） |
| detect_tag_name | String | CV用タグ |
| tag_prompt | String | タグ出力判定基準/検出したものがどういう基準を満たしていたらタグを出力するのか (プロンプトテンプレート) |
| description | String | タグ説明 |
| tagcategory_id | String(GSI-1-pk) | タグカテゴリへの参照 |
| s3path | String | 判断基準となる参考画像のS3パス |
| file_format | String | 参考画像のファイル形式（例：jpg, png） |
| updatedate | String | 更新日時 |
注意。このタグテーブルは「マスタ」のような厳密なものではない。
単に、cedix-detectを簡単につくれるようにするため」


### 15. RTMP NLB管理 (cedix-rtmp-nlb)
RTMPカメラ用の共有NLBを管理するテーブル。
| Attribute | Type | Description |
| --- | --- | --- |
| nlb_id | String (pk) | NLBの一意識別子（例: rtmp-nlb-001） |
| nlb_arn | String | NLBのARN |
| nlb_dns_name | String | NLBのDNS名 |
| security_group_id | String | NLB用セキュリティグループID |
| port_range_start | Number | このNLBのポート範囲開始（例: 1935） |
| port_range_end | Number | このNLBのポート範囲終了（例: 1984） |
| used_ports | Number | 使用中ポート数（0-50） |
| allocated_ports | List | 割り当て済みポート番号のリスト |
| status | String (GSI-1-pk) | NLBステータス（active/deleting） |
| stack_name | String | CloudFormationスタック名 |
| created_at | String (GSI-1-sk) | 作成日時（ISO 8601形式、UTC） |
| updated_at | String | 更新日時（ISO 8601形式、UTC） |
**GSI構成:**
- **GSI-1**: status (PK) + created_at (SK) - ステータス別検索用

**設計概要:**
- 1 NLB = 50ポート（NLBリスナー上限）
- 100 NLB × 50ポート = 5000台のRTMPカメラに対応
- ポート範囲: 1935-6934
- NLBは最初のRTMPカメラ追加時に自動作成
- NLBの使用ポートが0になったら自動削除
