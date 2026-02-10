# APIエンドポイント一覧
本ドキュメントでは、本サンプルの全APIエンドポイント（85個）を記載します。

## 1. userinfo（ユーザー情報）
| メソッド | パス | 説明 |
| --- | --- | --- |
| GET | `/api/userinfo/` | 認証ユーザー情報取得 |
| GET | `/api/userinfo/cognito-details` | Cognito詳細情報取得 |
| GET | `/api/userinfo/auth-debug` | 認証デバッグ情報 |
| POST | `/api/userinfo/change-password` | パスワード変更 |
| GET | `/api/userinfo/user-info` | ユーザー情報取得 |

## 2. place（現場管理）
| メソッド | パス | 説明 |
| --- | --- | --- |
| GET | `/api/place/` | 場所一覧取得 |
| GET | `/api/place/{place_id}` | 場所詳細取得 |
| POST | `/api/place/` | 場所作成 |
| PUT | `/api/place/{place_id}` | 場所更新 |
| DELETE | `/api/place/{place_id}` | 場所削除 |

## 3. camera（カメラ管理）
| メソッド | パス | 説明 |
| --- | --- | --- |
| GET | `/api/camera/` | カメラ一覧取得 |
| GET | `/api/camera/{camera_id}` | カメラ詳細取得 |
| POST | `/api/camera/` | カメラ作成（CloudFormationデプロイ開始） |
| PUT | `/api/camera/{camera_id}` | カメラ更新 |
| DELETE | `/api/camera/{camera_id}` | カメラ削除 |
| GET | `/api/camera/{camera_id}/deploy-status` | デプロイステータス取得 |
| GET | `/api/camera/{camera_id}/collectors` | カメラのコレクター一覧 |
| GET | `/api/camera/cameras/filtered` | フィルタリング付きカメラ一覧 |
| GET | `/api/camera/cameras` | カメラ一覧（シンプル） |
| GET | `/api/camera/cameras/{camera_id}` | カメラ詳細（シンプル） |
| POST | `/api/camera/upload-test-movie` | テスト動画アップロードURL生成 |

## 4. camera-collector（コレクター管理）
| メソッド | パス | 説明 |
| --- | --- | --- |
| GET | `/api/camera-collector/` | コレクター一覧取得 |
| GET | `/api/camera-collector/{collector_id}` | コレクター詳細取得 |
| POST | `/api/camera-collector/` | コレクター作成（CloudFormation自動デプロイ） |
| PUT | `/api/camera-collector/{collector_id}` | コレクター更新 |
| DELETE | `/api/camera-collector/{collector_id}` | コレクター削除 |
| GET | `/api/camera-collector/deploy-status/{collector_id}` | デプロイステータス確認 |
| GET | `/api/camera-collector/remove-status/{collector_id}` | 削除ステータス確認 |

## 5. file（ファイル管理）
| メソッド | パス | 説明 |
| --- | --- | --- |
| GET | `/api/file/camera/{camera_id}` | カメラ別ファイル一覧 |
| GET | `/api/file/datetime/{camera_id}/{datetime_prefix}` | 日時別ファイル取得 |
| GET | `/api/file/hls/{camera_id}` | HLS URL取得 |
| GET | `/api/file/mp4download/{file_id}` | ダウンロードURL取得 |
| POST | `/api/file/` | ファイル作成 |
| GET | `/api/file/{file_id}` | ファイル詳細取得 |
| PUT | `/api/file/{file_id}` | ファイル更新 |
| DELETE | `/api/file/{file_id}` | ファイル削除 |
| GET | `/api/file/summary/{camera_id}/{datetime_prefix}` | 時間別サマリー取得 |

## 6. detector（検出器管理）
| メソッド | パス | 説明 |
| --- | --- | --- |
| GET | `/api/detector/trigger-events` | トリガーイベント一覧 |
| GET | `/api/detector/cameras/{camera_id}/detectors` | カメラ別検知器一覧 |
| GET | `/api/detector/detectors/{detector_id}` | 検知器詳細 |
| POST | `/api/detector/` | 検知器作成 |
| PUT | `/api/detector/{detector_id}` | 検知器更新 |
| DELETE | `/api/detector/{detector_id}` | 検知器削除 |
| GET | `/api/detector/load-from-category/{tagcategory_id}` | タグカテゴリからロード |

## 7. detect-log（検出ログ）
| メソッド | パス | 説明 |
| --- | --- | --- |
| GET | `/api/detect-log/files/{file_id}/detect-logs` | ファイル別検出ログ |
| GET | `/api/detect-log/detect-logs/{detect_log_id}` | 検出ログ詳細 |
| PUT | `/api/detect-log/detect-logs/{detect_log_id}/notify` | 通知フラグ更新 |
| GET | `/api/detect-log/notifications/recent` | 直近通知取得 |
| GET | `/api/detect-log/notifications/history` | 通知履歴取得 |

## 8. timeseries（時系列データ）
| メソッド | パス | 説明 |
| --- | --- | --- |
| GET | `/api/timeseries/tags` | タグ一覧取得 |
| POST | `/api/timeseries/timeseries` | 時系列データ取得 |
| POST | `/api/timeseries/detail-logs` | 詳細ログ取得 |

## 9. search（検索）
| メソッド | パス | 説明 |
| --- | --- | --- |
| POST | `/api/search/` | フルテキスト検索 |
| GET | `/api/search/tags` | 検索用タグ一覧 |
| GET | `/api/search/search-options` | 検索オプション取得 |

## 10. bookmark（ブックマーク）
| メソッド | パス | 説明 |
| --- | --- | --- |
| GET | `/api/bookmark/` | ブックマーク一覧 |
| POST | `/api/bookmark/` | ブックマーク作成 |
| DELETE | `/api/bookmark/{bookmark_id}` | ブックマーク削除 |
| GET | `/api/bookmark/{bookmark_id}/details` | ブックマーク詳細一覧 |
| POST | `/api/bookmark/{bookmark_id}/details` | ブックマーク詳細追加 |
| DELETE | `/api/bookmark/{bookmark_id}/details/{bookmark_no}` | ブックマーク詳細削除 |
| POST | `/api/bookmark/detail` | ブックマーク詳細作成 |

## 11. report（レポート）
| メソッド | パス | 説明 |
| --- | --- | --- |
| POST | `/api/report/create` | Bedrockでレポート生成 |

## 12. tag（タグ管理）
| メソッド | パス | 説明 |
| --- | --- | --- |
| GET | `/api/tag/categories/` | タグカテゴリ一覧 |
| POST | `/api/tag/categories/` | タグカテゴリ作成 |
| PUT | `/api/tag/categories/{tagcategory_id}` | タグカテゴリ更新 |
| DELETE | `/api/tag/categories/{tagcategory_id}` | タグカテゴリ削除 |
| GET | `/api/tag/` | タグ一覧 |
| GET | `/api/tag/{tag_name}` | タグ詳細 |
| POST | `/api/tag/` | タグ作成 |
| PUT | `/api/tag/{tag_name}` | タグ更新 |
| DELETE | `/api/tag/{tag_name}` | タグ削除 |
| POST | `/api/tag/upload-image/` | タグ画像アップロード |
| GET | `/api/tag/{tag_name}/image-url/` | タグ画像URL取得 |
| GET | `/api/tag/tags/sync` | タグ同期 |
| GET | `/api/tag/tags/detection-stats` | タグ検出統計 |

## 13. tags（タグ一覧）
| メソッド | パス | 説明 |
| --- | --- | --- |
| GET | `/api/tags/` | タグ一覧（Query使用） |

## 14. test-movie（テスト動画）
| メソッド | パス | 説明 |
| --- | --- | --- |
| GET | `/api/test-movie/` | テスト動画一覧 |
| GET | `/api/test-movie/{test_movie_id}` | テスト動画詳細 |
| POST | `/api/test-movie/` | テスト動画作成 |
| GET | `/api/test-movie/{test_movie_id}/status` | デプロイステータス |
| PUT | `/api/test-movie/{test_movie_id}` | テスト動画更新 |
| DELETE | `/api/test-movie/{test_movie_id}` | テスト動画削除 |
| POST | `/api/test-movie/upload` | アップロードURL生成 |

## APIルーター登録（main.py）
`backend/api_gateway/api/main.py` で以下のルーターが登録されています:
| プレフィックス | ルーター | タグ |
| --- | --- | --- |
| `/api/place` | place.router | Place |
| `/api/camera` | camera.router | Camera |
| `/api/camera-collector` | camera_collector.router | Camera Collector |
| `/api/file` | file.router | File |
| `/api/userinfo` | userinfo.router | User Info |
| `/api/detector` | detector.router | Detector |
| `/api/detect-log` | detect_log.router | Detect Log |
| `/api/bookmark` | bookmark.router | Bookmark |
| `/api/report` | report.router | Report |
| `/api/test-movie` | test_movie.router | Test Movie |
| `/api/search` | search.router | Search |
| `/api/timeseries` | detect_tag_timeseries.router | Timeseries |
| `/api/tag` | tag.router | Tag |
| `/api/tags` | tags.router | Tags |
