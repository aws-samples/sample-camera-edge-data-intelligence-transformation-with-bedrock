"""
タイムゾーンユーティリティ関数

全ての時刻変換処理はこのモジュールを使用する。
"""
from datetime import datetime
from typing import Optional
from .timezone_config import UTC, DISPLAY_TIMEZONE, DB_TIME_FORMAT, DISPLAY_TIME_FORMAT

# ===========================
# 現在時刻取得
# ===========================

def now_utc() -> datetime:
    """
    現在時刻をUTC（タイムゾーン情報あり）で取得
    
    Returns:
        datetime: UTC現在時刻（tzinfo=UTC）
    """
    return datetime.now(UTC)

def now_utc_str() -> str:
    """
    現在時刻をUTC文字列（DynamoDB保存用）で取得
    
    Returns:
        str: UTC現在時刻文字列（例: '2025-11-17T20:42:04'）
    """
    return now_utc().strftime(DB_TIME_FORMAT)

def now_display() -> datetime:
    """
    現在時刻を表示用タイムゾーン（タイムゾーン情報あり）で取得
    
    Returns:
        datetime: 表示用タイムゾーン現在時刻（tzinfo=DISPLAY_TIMEZONE）
    """
    return datetime.now(DISPLAY_TIMEZONE)

def now_display_str() -> str:
    """
    現在時刻を表示用タイムゾーン文字列で取得
    
    Returns:
        str: 表示用タイムゾーン現在時刻文字列（例: '2025-11-18T05:42:04'）
    """
    return now_display().strftime(DISPLAY_TIME_FORMAT)

# ===========================
# datetime オブジェクト変換
# ===========================

def to_utc(dt: datetime) -> datetime:
    """
    任意のdatetimeをUTCに変換
    
    Args:
        dt: 変換元datetime（tzinfoあり/なし）
        
    Returns:
        datetime: UTC datetime（tzinfo=UTC）
        
    Note:
        - tzinfoがない場合は、表示用タイムゾーンと仮定
    """
    if dt.tzinfo is None:
        # タイムゾーン情報がない場合は表示用タイムゾーンと仮定
        dt = dt.replace(tzinfo=DISPLAY_TIMEZONE)
    return dt.astimezone(UTC)

def to_display_tz(dt: datetime) -> datetime:
    """
    任意のdatetimeを表示用タイムゾーンに変換
    
    Args:
        dt: 変換元datetime（tzinfoあり/なし）
        
    Returns:
        datetime: 表示用タイムゾーン datetime（tzinfo=DISPLAY_TIMEZONE）
        
    Note:
        - tzinfoがない場合は、UTCと仮定
    """
    if dt.tzinfo is None:
        # タイムゾーン情報がない場合はUTCと仮定
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(DISPLAY_TIMEZONE)

# ===========================
# 文字列 → datetime
# ===========================

def parse_display_str(display_str: str) -> datetime:
    """
    表示用タイムゾーン文字列をdatetime（UTC）に変換
    
    Args:
        display_str: 表示用タイムゾーン文字列（例: '2025-11-18T05:42:04'）
        
    Returns:
        datetime: UTC datetime（tzinfo=UTC）
        
    Note:
        - API Requestで受け取った時刻文字列をパースする際に使用
        - タイムゾーン情報がない文字列を表示用タイムゾーンと仮定してUTCに変換
    """
    dt_display = datetime.fromisoformat(display_str).replace(tzinfo=DISPLAY_TIMEZONE)
    return dt_display.astimezone(UTC)

def parse_db_str(db_str: str) -> datetime:
    """
    DynamoDB保存文字列をdatetime（UTC）に変換
    
    Args:
        db_str: DynamoDB保存文字列（例: '2025-11-17T20:42:04'）
        
    Returns:
        datetime: UTC datetime（tzinfo=UTC）
        
    Note:
        - DynamoDBから取得した時刻文字列をパースする際に使用
        - タイムゾーン情報がない文字列をUTCと仮定
    """
    return datetime.fromisoformat(db_str).replace(tzinfo=UTC)

def parse_any_str(time_str: Optional[str]) -> datetime:
    """
    任意の形式の時刻文字列をdatetime（UTC）に変換
    
    Args:
        time_str: 時刻文字列（タイムゾーン情報あり/なし）、Noneまたは空文字列の場合は現在のUTC時刻
        
    Returns:
        datetime: UTC datetime（tzinfo=UTC）
        
    Note:
        - タイムゾーン情報がある場合はそれを使用
        - タイムゾーン情報がない場合はUTCと仮定
        - NoneまたはEmpty文字列の場合は現在のUTC時刻を返す
    """
    # None または空文字列の場合は現在のUTC時刻を返す
    if not time_str:
        return now_utc()
    
    try:
        # タイムゾーン情報ありの場合
        dt = datetime.fromisoformat(time_str.replace('Z', '+00:00'))
        if dt.tzinfo:
            return dt.astimezone(UTC)
        else:
            # タイムゾーン情報なし → UTCと仮定
            return dt.replace(tzinfo=UTC)
    except ValueError:
        # パースエラー → UTCと仮定して再パース
        return datetime.fromisoformat(time_str).replace(tzinfo=UTC)

# ===========================
# datetime → 文字列
# ===========================

def format_for_db(dt: datetime) -> str:
    """
    datetimeをDynamoDB保存用文字列（UTC）に変換
    
    Args:
        dt: 変換元datetime（tzinfoあり/なし）
        
    Returns:
        str: UTC文字列（例: '2025-11-17T20:42:04'）
        
    Note:
        - DynamoDBに保存する際に使用
        - タイムゾーン情報がない場合はUTCと仮定
    """
    dt_utc = to_utc(dt) if dt.tzinfo else dt.replace(tzinfo=UTC)
    return dt_utc.strftime(DB_TIME_FORMAT)

def format_for_display(dt: datetime) -> str:
    """
    datetimeを表示用文字列（表示用タイムゾーン）に変換
    
    Args:
        dt: 変換元datetime（tzinfoあり/なし）
        
    Returns:
        str: 表示用タイムゾーン文字列（例: '2025-11-18T05:42:04'）
        
    Note:
        - API Responseで返す際に使用
        - タイムゾーン情報がない場合はUTCと仮定
    """
    dt_utc = dt if dt.tzinfo else dt.replace(tzinfo=UTC)
    dt_display = dt_utc.astimezone(DISPLAY_TIMEZONE)
    return dt_display.strftime(DISPLAY_TIME_FORMAT)

# ===========================
# 文字列 → 文字列（ショートカット）
# ===========================

def db_str_to_display_str(db_str: str) -> str:
    """
    DynamoDB保存文字列を表示用文字列に変換
    
    Args:
        db_str: DynamoDB保存文字列（例: '2025-11-17T20:42:04'）
        
    Returns:
        str: 表示用タイムゾーン文字列（例: '2025-11-18T05:42:04'）
    """
    dt_utc = parse_db_str(db_str)
    return format_for_display(dt_utc)

def display_str_to_db_str(display_str: str) -> str:
    """
    表示用文字列をDynamoDB保存文字列に変換
    
    Args:
        display_str: 表示用タイムゾーン文字列（例: '2025-11-18T05:42:04'）
        
    Returns:
        str: DynamoDB保存文字列（例: '2025-11-17T20:42:04'）
    """
    dt_utc = parse_display_str(display_str)
    return format_for_db(dt_utc)

# ===========================
# 後方互換性（既存コード用エイリアス）
# ===========================

# 既存コードで使われている関数名のエイリアス
jst_to_utc = to_utc  # JST datetime → UTC datetime
utc_to_jst = to_display_tz  # UTC datetime → JST datetime
jst_str_to_utc_str = display_str_to_db_str  # JST文字列 → UTC文字列
utc_str_to_jst_str = db_str_to_display_str  # UTC文字列 → JST文字列
format_time_jst = format_for_display  # datetime → JST文字列

