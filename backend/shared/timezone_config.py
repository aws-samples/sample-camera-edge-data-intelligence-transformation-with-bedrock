"""
タイムゾーン設定の一元管理

全てのタイムゾーン関連の定義はこのファイルに集約する。
"""
import os
from datetime import timezone, timedelta

# ===========================
# タイムゾーン定義
# ===========================

# UTC（協定世界時）
UTC = timezone.utc

# 表示用タイムゾーン（デフォルト: JST）
# 環境変数で変更可能（将来対応）
DISPLAY_TIMEZONE_OFFSET_HOURS = int(os.getenv('DISPLAY_TIMEZONE_OFFSET', '9'))
DISPLAY_TIMEZONE = timezone(timedelta(hours=DISPLAY_TIMEZONE_OFFSET_HOURS))
DISPLAY_TIMEZONE_NAME = os.getenv('DISPLAY_TIMEZONE_NAME', 'JST')

# 後方互換性のため JST も定義
JST = DISPLAY_TIMEZONE

# ===========================
# 便利な定数
# ===========================

# タイムゾーンオフセット文字列（例: "+09:00"）
if DISPLAY_TIMEZONE_OFFSET_HOURS >= 0:
    DISPLAY_TIMEZONE_OFFSET_STR = f"+{DISPLAY_TIMEZONE_OFFSET_HOURS:02d}:00"
else:
    DISPLAY_TIMEZONE_OFFSET_STR = f"{DISPLAY_TIMEZONE_OFFSET_HOURS:03d}:00"

# DynamoDB保存用フォーマット
DB_TIME_FORMAT = '%Y-%m-%dT%H:%M:%S'

# 表示用フォーマット（API Response）
DISPLAY_TIME_FORMAT = '%Y-%m-%dT%H:%M:%S'


