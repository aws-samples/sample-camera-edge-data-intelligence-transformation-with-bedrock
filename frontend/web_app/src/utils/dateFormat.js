/**
 * 日付フォーマット用ユーティリティ
 * Intl.DateTimeFormatを使用してロケールに応じた日付表示を提供
 */

/**
 * 曜日を取得
 * @param {Date} date - 日付オブジェクト
 * @param {string} locale - ロケール ('ja-JP' or 'en-US')
 * @param {string} format - 'short' or 'long'
 * @returns {string} - 曜日（例: "日", "月", "Sun", "Mon"）
 */
export const getWeekday = (date, locale = 'ja-JP', format = 'short') => {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: format });
  return formatter.format(date);
};

/**
 * 月を取得
 * @param {Date} date - 日付オブジェクト
 * @param {string} locale - ロケール ('ja-JP' or 'en-US')
 * @param {string} format - 'numeric', 'long', or 'short'
 * @returns {string} - 月（例: "11月", "November", "Nov"）
 */
export const getMonth = (date, locale = 'ja-JP', format = 'long') => {
  const formatter = new Intl.DateTimeFormat(locale, { month: format });
  return formatter.format(date);
};

/**
 * 日付を "MM月DD日 (曜日)" または "MMM DD (Day)" 形式でフォーマット
 * @param {Date} date - 日付オブジェクト
 * @param {string} locale - ロケール ('ja-JP' or 'en-US')
 * @returns {string} - フォーマット済み日付文字列
 */
export const formatDateWithWeekday = (date, locale = 'ja-JP') => {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    return '';
  }

  if (locale === 'ja-JP' || locale === 'ja') {
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const weekday = getWeekday(date, 'ja-JP', 'short');
    return `${month}月${day}日 (${weekday})`;
  } else {
    // 英語の場合: "Nov 19 (Tue)"
    const formatter = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      weekday: 'short'
    });
    const parts = formatter.formatToParts(date);
    const month = parts.find(p => p.type === 'month').value;
    const day = parts.find(p => p.type === 'day').value;
    const weekday = parts.find(p => p.type === 'weekday').value;
    return `${month} ${day} (${weekday})`;
  }
};

/**
 * "MM月DD日 (曜日)" 形式の文字列をDateオブジェクトに変換
 * @param {string} dateString - 日付文字列
 * @returns {Date|null} - Dateオブジェクトまたはnull
 */
export const parseDateWithWeekday = (dateString) => {
  // 日本語形式: "11月19日 (火)"
  const jaMatch = dateString.match(/(\d+)月(\d+)日\s*\((.)\)/);
  if (jaMatch) {
    const month = parseInt(jaMatch[1], 10) - 1;
    const day = parseInt(jaMatch[2], 10);
    const date = new Date();
    date.setMonth(month);
    date.setDate(day);
    return date;
  }

  // 英語形式: "Nov 19 (Tue)"
  const enMatch = dateString.match(/([A-Za-z]+)\s+(\d+)\s*\(([A-Za-z]+)\)/);
  if (enMatch) {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = monthNames.indexOf(enMatch[1]);
    const day = parseInt(enMatch[2], 10);
    if (month >= 0) {
      const date = new Date();
      date.setMonth(month);
      date.setDate(day);
      return date;
    }
  }

  return null;
};

/**
 * 日付文字列から月と日を抽出（yyyy-mm-dd形式に対応）
 * @param {string} dateString - 日付文字列（例: "2025-11-19"）
 * @returns {Object|null} - { month: string, day: string } または null（0埋め2桁形式）
 */
export const extractMonthAndDay = (dateString) => {
  if (!dateString) return null;
  
  // yyyy-mm-dd形式
  const isoMatch = dateString.match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return { month: isoMatch[1], day: isoMatch[2] };
  }
  
  return null;
};

/**
 * i18n言語コードからロケール文字列に変換
 * @param {string} languageCode - i18n言語コード ('ja', 'en', 'fr' など)
 * @returns {string} - ロケール文字列 ('ja-JP', 'en-US', 'fr-FR' など)
 */
export const getLocaleFromLanguage = (languageCode) => {
  const localeMap = {
    'ja': 'ja-JP',
    'en': 'en-US',
    'fr': 'fr-FR',
    'de': 'de-DE',
    'es': 'es-ES',
    'zh': 'zh-CN',
    'ko': 'ko-KR',
    // 将来的に追加するロケールをここに追加
  };
  
  return localeMap[languageCode] || 'en-US'; // デフォルトは英語
};

/**
 * YYYYMMDDHHMM形式の文字列をパースして、日付文字列・時刻情報を返す
 * @param {string} datetime - YYYYMMDDHHMM形式の文字列
 * @param {string} languageCode - i18n言語コード（未使用、互換性のため残す）
 * @returns {Object|null} - { dateString, hour, minute, fullDateTime } または null
 */
export const parseDateTimeString = (datetime, languageCode = 'ja') => {
  if (!datetime || datetime.length !== 12) return null;
  
  const year = parseInt(datetime.substring(0, 4), 10);
  const month = parseInt(datetime.substring(4, 6), 10);
  const day = parseInt(datetime.substring(6, 8), 10);
  const hour = parseInt(datetime.substring(8, 10), 10);
  const minute = parseInt(datetime.substring(10, 12), 10);
  
  // Create date object to validate
  const date = new Date(year, month - 1, day, hour, minute);
  if (isNaN(date.getTime())) return null;
  
  // yyyy-mm-dd形式で返す
  const dateString = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
  
  return {
    dateString,
    hour,
    minute,
    fullDateTime: date
  };
};

/**
 * 現在の日付文字列を取得（yyyy-mm-dd形式）
 * @param {string} languageCode - i18n言語コード（未使用、互換性のため残す）
 * @param {string} timezone - タイムゾーン（例: 'Asia/Tokyo', 'UTC'）
 * @returns {string} - yyyy-mm-dd形式の日付文字列（例: "2025-11-19"）
 */
export const getCurrentDateString = (languageCode = 'ja', timezone = 'Asia/Tokyo') => {
  const now = new Date();
  
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  
  const parts = formatter.formatToParts(now);
  const year = parts.find(p => p.type === 'year')?.value || '2025';
  const month = parts.find(p => p.type === 'month')?.value || '01';
  const day = parts.find(p => p.type === 'day')?.value || '01';
  
  return `${year}-${month}-${day}`;
};

/**
 * 現在の時刻（時）を取得（タイムゾーン対応）
 * @param {string} languageCode - i18n言語コード（使用しないが一貫性のため）
 * @param {string} timezone - タイムゾーン（例: 'Asia/Tokyo', 'UTC'）
 * @returns {number} - 現在の時（0-23）
 */
export const getCurrentHourNumber = (languageCode = 'ja', timezone = 'Asia/Tokyo') => {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false
  });
  const parts = formatter.formatToParts(now);
  const hour = parts.find(p => p.type === 'hour')?.value;
  return parseInt(hour || '0', 10);
};

/**
 * 現在の時刻文字列を取得（HH:mm形式、タイムゾーン対応）
 * @param {string} languageCode - i18n言語コード（使用しないが一貫性のため）
 * @param {string} timezone - タイムゾーン（例: 'Asia/Tokyo', 'UTC'）
 * @returns {string} - 時刻文字列（例: "15:30"）
 */
export const getCurrentTimeString = (languageCode = 'ja', timezone = 'Asia/Tokyo') => {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(now);
  const hours = parts.find(p => p.type === 'hour')?.value || '00';
  const minutes = parts.find(p => p.type === 'minute')?.value || '00';
  return `${hours}:${minutes}`;
};

