"""
timezone_utils.py のテストコード
"""
import pytest
from datetime import datetime, timezone, timedelta
import sys
import os

# パスを追加してsharedモジュールをインポート可能にする
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

from shared.timezone_utils import (
    now_utc, now_utc_str, now_display, now_display_str,
    to_utc, to_display_tz,
    parse_display_str, parse_db_str, parse_any_str,
    format_for_db, format_for_display,
    db_str_to_display_str, display_str_to_db_str
)
from shared.timezone_config import UTC, DISPLAY_TIMEZONE


class TestCurrentTime:
    """現在時刻取得のテスト"""
    
    def test_now_utc(self):
        """now_utc() がUTC時刻を返すこと"""
        dt = now_utc()
        assert dt.tzinfo == UTC
        assert isinstance(dt, datetime)
    
    def test_now_utc_str(self):
        """now_utc_str() が正しいフォーマットの文字列を返すこと"""
        time_str = now_utc_str()
        assert len(time_str) == 19  # YYYY-MM-DDTHH:MM:SS
        assert 'T' in time_str
        # パース可能であることを確認
        dt = datetime.fromisoformat(time_str)
        assert isinstance(dt, datetime)
    
    def test_now_display(self):
        """now_display() が表示用タイムゾーンの時刻を返すこと"""
        dt = now_display()
        assert dt.tzinfo == DISPLAY_TIMEZONE
        assert isinstance(dt, datetime)
    
    def test_now_display_str(self):
        """now_display_str() が正しいフォーマットの文字列を返すこと"""
        time_str = now_display_str()
        assert len(time_str) == 19  # YYYY-MM-DDTHH:MM:SS
        assert 'T' in time_str
        # パース可能であることを確認
        dt = datetime.fromisoformat(time_str)
        assert isinstance(dt, datetime)


class TestConversion:
    """datetime変換のテスト"""
    
    def test_to_utc_from_jst(self):
        """JST datetime を UTC に変換"""
        # JST 2025-11-18 05:42:04
        dt_jst = datetime(2025, 11, 18, 5, 42, 4, tzinfo=DISPLAY_TIMEZONE)
        dt_utc = to_utc(dt_jst)
        
        # UTC 2025-11-17 20:42:04 になるはず
        assert dt_utc.tzinfo == UTC
        assert dt_utc.year == 2025
        assert dt_utc.month == 11
        assert dt_utc.day == 17
        assert dt_utc.hour == 20
        assert dt_utc.minute == 42
    
    def test_to_utc_without_tzinfo(self):
        """タイムゾーン情報なしのdatetimeをUTCに変換（JSTと仮定）"""
        # タイムゾーン情報なし: 2025-11-18 05:42:04
        dt_naive = datetime(2025, 11, 18, 5, 42, 4)
        dt_utc = to_utc(dt_naive)
        
        # JSTと仮定 → UTC 2025-11-17 20:42:04
        assert dt_utc.tzinfo == UTC
        assert dt_utc.year == 2025
        assert dt_utc.month == 11
        assert dt_utc.day == 17
        assert dt_utc.hour == 20
    
    def test_to_display_tz_from_utc(self):
        """UTC datetime を JST に変換"""
        # UTC 2025-11-17 20:42:04
        dt_utc = datetime(2025, 11, 17, 20, 42, 4, tzinfo=UTC)
        dt_jst = to_display_tz(dt_utc)
        
        # JST 2025-11-18 05:42:04 になるはず
        assert dt_jst.tzinfo == DISPLAY_TIMEZONE
        assert dt_jst.year == 2025
        assert dt_jst.month == 11
        assert dt_jst.day == 18
        assert dt_jst.hour == 5
        assert dt_jst.minute == 42
    
    def test_to_display_tz_without_tzinfo(self):
        """タイムゾーン情報なしのdatetimeをJSTに変換（UTCと仮定）"""
        # タイムゾーン情報なし: 2025-11-17 20:42:04
        dt_naive = datetime(2025, 11, 17, 20, 42, 4)
        dt_jst = to_display_tz(dt_naive)
        
        # UTCと仮定 → JST 2025-11-18 05:42:04
        assert dt_jst.tzinfo == DISPLAY_TIMEZONE
        assert dt_jst.year == 2025
        assert dt_jst.month == 11
        assert dt_jst.day == 18
        assert dt_jst.hour == 5


class TestParsing:
    """文字列パースのテスト"""
    
    def test_parse_display_str(self):
        """JST文字列をUTC datetimeにパース"""
        # JST '2025-11-18T05:42:04'
        dt_utc = parse_display_str('2025-11-18T05:42:04')
        
        # UTC 2025-11-17 20:42:04 になるはず
        assert dt_utc.tzinfo == UTC
        assert dt_utc.year == 2025
        assert dt_utc.month == 11
        assert dt_utc.day == 17
        assert dt_utc.hour == 20
    
    def test_parse_db_str(self):
        """UTC文字列をUTC datetimeにパース"""
        # UTC '2025-11-17T20:42:04'
        dt_utc = parse_db_str('2025-11-17T20:42:04')
        
        assert dt_utc.tzinfo == UTC
        assert dt_utc.year == 2025
        assert dt_utc.month == 11
        assert dt_utc.day == 17
        assert dt_utc.hour == 20
    
    def test_parse_any_str_with_timezone(self):
        """タイムゾーン情報ありの文字列をパース"""
        # UTC '2025-11-17T20:42:04+00:00'
        dt_utc = parse_any_str('2025-11-17T20:42:04+00:00')
        
        assert dt_utc.tzinfo == UTC
        assert dt_utc.year == 2025
        assert dt_utc.month == 11
        assert dt_utc.day == 17
        assert dt_utc.hour == 20
    
    def test_parse_any_str_without_timezone(self):
        """タイムゾーン情報なしの文字列をパース（UTCと仮定）"""
        # '2025-11-17T20:42:04'
        dt_utc = parse_any_str('2025-11-17T20:42:04')
        
        assert dt_utc.tzinfo == UTC
        assert dt_utc.year == 2025
        assert dt_utc.month == 11
        assert dt_utc.day == 17
        assert dt_utc.hour == 20


class TestFormatting:
    """文字列フォーマットのテスト"""
    
    def test_format_for_db(self):
        """UTC datetime をDB保存文字列にフォーマット"""
        dt_utc = datetime(2025, 11, 17, 20, 42, 4, tzinfo=UTC)
        db_str = format_for_db(dt_utc)
        
        assert db_str == '2025-11-17T20:42:04'
    
    def test_format_for_db_with_microseconds(self):
        """マイクロ秒を含むUTC datetimeをDB保存文字列にフォーマット"""
        dt_utc = datetime(2025, 11, 17, 20, 42, 4, 123456, tzinfo=UTC)
        db_str = format_for_db(dt_utc)
        
        # マイクロ秒は切り捨てられる
        assert db_str == '2025-11-17T20:42:04'
    
    def test_format_for_display(self):
        """UTC datetime を表示用文字列にフォーマット"""
        dt_utc = datetime(2025, 11, 17, 20, 42, 4, tzinfo=UTC)
        display_str = format_for_display(dt_utc)
        
        # JST '2025-11-18T05:42:04'
        assert display_str == '2025-11-18T05:42:04'


class TestStringToString:
    """文字列→文字列変換のテスト"""
    
    def test_db_str_to_display_str(self):
        """DB保存文字列を表示用文字列に変換"""
        # UTC '2025-11-17T20:42:04' → JST '2025-11-18T05:42:04'
        display_str = db_str_to_display_str('2025-11-17T20:42:04')
        assert display_str == '2025-11-18T05:42:04'
    
    def test_display_str_to_db_str(self):
        """表示用文字列をDB保存文字列に変換"""
        # JST '2025-11-18T05:42:04' → UTC '2025-11-17T20:42:04'
        db_str = display_str_to_db_str('2025-11-18T05:42:04')
        assert db_str == '2025-11-17T20:42:04'
    
    def test_round_trip_conversion(self):
        """往復変換のテスト"""
        original_db_str = '2025-11-17T20:42:04'
        
        # DB → Display → DB
        display_str = db_str_to_display_str(original_db_str)
        result_db_str = display_str_to_db_str(display_str)
        
        assert original_db_str == result_db_str


class TestBoundary:
    """境界値のテスト"""
    
    def test_midnight_jst_to_utc(self):
        """JST 00:00:00 → UTC 変換"""
        # JST 2025-11-18 00:00:00 → UTC 2025-11-17 15:00:00
        dt_utc = parse_display_str('2025-11-18T00:00:00')
        assert dt_utc.day == 17
        assert dt_utc.hour == 15
    
    def test_midnight_utc_to_jst(self):
        """UTC 00:00:00 → JST 変換"""
        # UTC 2025-11-17 00:00:00 → JST 2025-11-17 09:00:00
        dt_utc = datetime(2025, 11, 17, 0, 0, 0, tzinfo=UTC)
        display_str = format_for_display(dt_utc)
        assert display_str == '2025-11-17T09:00:00'
    
    def test_end_of_day_jst_to_utc(self):
        """JST 23:59:59 → UTC 変換"""
        # JST 2025-11-18 23:59:59 → UTC 2025-11-18 14:59:59
        dt_utc = parse_display_str('2025-11-18T23:59:59')
        assert dt_utc.day == 18
        assert dt_utc.hour == 14
        assert dt_utc.minute == 59
        assert dt_utc.second == 59
    
    def test_end_of_day_utc_to_jst(self):
        """UTC 23:59:59 → JST 変換"""
        # UTC 2025-11-17 23:59:59 → JST 2025-11-18 08:59:59
        dt_utc = datetime(2025, 11, 17, 23, 59, 59, tzinfo=UTC)
        display_str = format_for_display(dt_utc)
        assert display_str == '2025-11-18T08:59:59'


class TestBackwardCompatibility:
    """後方互換性のテスト"""
    
    def test_jst_to_utc_alias(self):
        """jst_to_utc エイリアスが機能すること"""
        from shared.timezone_utils import jst_to_utc
        
        dt_jst = datetime(2025, 11, 18, 5, 42, 4, tzinfo=DISPLAY_TIMEZONE)
        dt_utc = jst_to_utc(dt_jst)
        
        assert dt_utc.hour == 20
    
    def test_utc_to_jst_alias(self):
        """utc_to_jst エイリアスが機能すること"""
        from shared.timezone_utils import utc_to_jst
        
        dt_utc = datetime(2025, 11, 17, 20, 42, 4, tzinfo=UTC)
        dt_jst = utc_to_jst(dt_utc)
        
        assert dt_jst.hour == 5
    
    def test_format_time_jst_alias(self):
        """format_time_jst エイリアスが機能すること"""
        from shared.timezone_utils import format_time_jst
        
        dt_utc = datetime(2025, 11, 17, 20, 42, 4, tzinfo=UTC)
        jst_str = format_time_jst(dt_utc)
        
        assert jst_str == '2025-11-18T05:42:04'


if __name__ == '__main__':
    pytest.main([__file__, '-v'])


