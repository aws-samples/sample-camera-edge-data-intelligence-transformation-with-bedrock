// ===============================================
// タイムゾーン管理ユーティリティ (UTC標準化版)
// ===============================================
// 
// 基本原則:
// - API送受信: 全てUTC時刻
// - 表示: ユーザー選択のタイムゾーン
// - 保存: LocalStorageにタイムゾーン設定
// - 日付フォーマット: ユーザー選択のロケール
//
// ===============================================

import { getDateFormatLocale } from './locale';

// タイムゾーン設定のキー
const TIMEZONE_STORAGE_KEY = 'userTimezone';

// デフォルトタイムゾーン
const DEFAULT_TIMEZONE = 'Asia/Tokyo';

// タイムゾーンの翻訳キーマッピング
const TIMEZONE_I18N_KEYS = {
  'Asia/Tokyo': 'timezones.asiaTokyo',
  'UTC': 'timezones.utc',
  'America/New_York': 'timezones.americaNewYork',
  'Europe/London': 'timezones.europeLondon',
  'Asia/Shanghai': 'timezones.asiaShanghai'
};

// サポートされるタイムゾーン一覧（関数で取得、i18n対応）
export const getSupportedTimezones = (t) => {
  if (!t) {
    // i18nが利用できない場合のフォールバック
    return [
      { value: 'Asia/Tokyo', label: '日本標準時 (JST)', offset: 'UTC+9' },
      { value: 'UTC', label: '協定世界時 (UTC)', offset: 'UTC+0' },
      { value: 'America/New_York', label: '米国東部時間 (EST/EDT)', offset: 'UTC-5/-4' },
      { value: 'Europe/London', label: '英国時間 (GMT/BST)', offset: 'UTC+0/+1' },
      { value: 'Asia/Shanghai', label: '中国標準時 (CST)', offset: 'UTC+8' }
    ];
  }
  
  return [
    { value: 'Asia/Tokyo', label: t(TIMEZONE_I18N_KEYS['Asia/Tokyo']), offset: 'UTC+9' },
    { value: 'UTC', label: t(TIMEZONE_I18N_KEYS['UTC']), offset: 'UTC+0' },
    { value: 'America/New_York', label: t(TIMEZONE_I18N_KEYS['America/New_York']), offset: 'UTC-5/-4' },
    { value: 'Europe/London', label: t(TIMEZONE_I18N_KEYS['Europe/London']), offset: 'UTC+0/+1' },
    { value: 'Asia/Shanghai', label: t(TIMEZONE_I18N_KEYS['Asia/Shanghai']), offset: 'UTC+8' }
  ];
};

// 後方互換性のため、SUPPORTED_TIMEZONESも残す（フォールバック用）
export const SUPPORTED_TIMEZONES = [
  { value: 'Asia/Tokyo', label: '日本標準時 (JST)', offset: 'UTC+9' },
  { value: 'UTC', label: '協定世界時 (UTC)', offset: 'UTC+0' },
  { value: 'America/New_York', label: '米国東部時間 (EST/EDT)', offset: 'UTC-5/-4' },
  { value: 'Europe/London', label: '英国時間 (GMT/BST)', offset: 'UTC+0/+1' },
  { value: 'Asia/Shanghai', label: '中国標準時 (CST)', offset: 'UTC+8' }
];

/**
 * 現在のタイムゾーン設定を取得
 * @returns {string} タイムゾーン文字列（例: 'Asia/Tokyo'）
 */
export function getCurrentTimezone() {
  try {
    const stored = localStorage.getItem(TIMEZONE_STORAGE_KEY);
    return stored || DEFAULT_TIMEZONE;
  } catch (error) {
    console.error('Failed to get timezone from localStorage:', error);
    return DEFAULT_TIMEZONE;
  }
}

/**
 * タイムゾーン設定を保存
 * @param {string} timezone - タイムゾーン文字列
 */
export function setCurrentTimezone(timezone) {
  try {
    localStorage.setItem(TIMEZONE_STORAGE_KEY, timezone);
    // カスタムイベントを発火してコンポーネントに通知
    window.dispatchEvent(new CustomEvent('timezoneChanged', { detail: { timezone } }));
  } catch (error) {
    console.error('Failed to save timezone to localStorage:', error);
  }
}

/**
 * UTC時刻文字列を指定されたタイムゾーンで表示用にフォーマット
 * @param {string} utcString - UTC時刻文字列（例: '2025-11-18T01:26:00'）
 * @param {string} format - 表示フォーマット（デフォルト: 'YYYY-MM-DD HH:mm:ss'）
 * @param {string} timezone - タイムゾーン（省略時は現在の設定を使用）
 * @returns {string} 指定されたタイムゾーンでフォーマットされた文字列
 */
export function formatUTCWithTimezone(utcString, format = 'YYYY-MM-DD HH:mm:ss', timezone = null) {
  if (!utcString) return '';
  
  // タイムゾーンが指定されていない場合は現在の設定を使用
  const tz = timezone || getCurrentTimezone();
  
  try {
    // UTC文字列をDateオブジェクトに変換（Zを付けてUTCとして明示）
    const utcDate = new Date(utcString.endsWith('Z') ? utcString : utcString + 'Z');
    
    if (isNaN(utcDate.getTime())) {
      console.error('Invalid UTC date string:', utcString);
      return '';
    }
    
    // 指定されたタイムゾーンでフォーマット
    const options = {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    };
    
    // ユーザー設定のロケールを使用
    const dateLocale = getDateFormatLocale();
    const formatter = new Intl.DateTimeFormat(dateLocale, options);
    const parts = formatter.formatToParts(utcDate);
    
    // パーツから値を取得
    const values = {};
    parts.forEach(part => {
      if (part.type !== 'literal') {
        values[part.type] = part.value;
      }
    });
    
    // フォーマットに応じて文字列を生成
    if (format === 'YYYY-MM-DD HH:mm:ss') {
      return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
    } else if (format === 'YYYY-MM-DD HH:mm') {
      return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}`;
    } else if (format === 'YYYY-MM-DD') {
      return `${values.year}-${values.month}-${values.day}`;
    } else if (format === 'MM-DD HH:mm') {
      return `${values.month}-${values.day} ${values.hour}:${values.minute}`;
    } else if (format === 'HH:mm:ss') {
      return `${values.hour}:${values.minute}:${values.second}`;
    } else if (format === 'YYYYMMDDHHmm') {
      // ディープリンク用のコンパクトフォーマット（区切り文字なし）
      return `${values.year}${values.month}${values.day}${values.hour}${values.minute}`;
    }
    
    // デフォルト
    return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
  } catch (error) {
    console.error('Error formatting date with timezone:', error);
    return '';
  }
}

/**
 * 指定されたタイムゾーンのローカル時刻をUTC文字列に変換（API送信用）
 * @param {number} year - 年
 * @param {number} month - 月（1-12）
 * @param {number} day - 日
 * @param {number} hour - 時
 * @param {number} minute - 分
 * @param {string} timezone - タイムゾーン（省略時は現在の設定を使用）
 * @returns {string} UTC時刻文字列（例: '2025-11-17T16:26:00'）
 */
export function convertLocalToUTC(year, month, day, hour, minute = 0, timezone = null) {
  const tz = timezone || getCurrentTimezone();
  
  try {
    // 指定されたタイムゾーンでのローカル時刻を表す文字列を作成
    const localString = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
    
    // toLocaleStringを使用してタイムゾーンを考慮した変換を行う
    // 1. まず、指定されたタイムゾーンでの時刻文字列をパース
    const localDate = new Date(localString);
    
    // 2. ブラウザのタイムゾーンオフセットを取得
    const browserOffset = localDate.getTimezoneOffset(); // 分単位
    
    // 3. 指定されたタイムゾーンのオフセットを取得
    const targetOffset = getTimezoneOffsetMinutes(tz, localDate);
    
    // 4. オフセットの差分を計算してUTCに変換
    const offsetDiff = targetOffset - (-browserOffset); // 両方を同じ符号にする
    const utcTime = localDate.getTime() - (offsetDiff * 60 * 1000);
    const utcDate = new Date(utcTime);
    
    // UTC時刻文字列を生成
    const utcYear = utcDate.getUTCFullYear();
    const utcMonth = String(utcDate.getUTCMonth() + 1).padStart(2, '0');
    const utcDay = String(utcDate.getUTCDate()).padStart(2, '0');
    const utcHour = String(utcDate.getUTCHours()).padStart(2, '0');
    const utcMinute = String(utcDate.getUTCMinutes()).padStart(2, '0');
    const utcSecond = String(utcDate.getUTCSeconds()).padStart(2, '0');
    
    return `${utcYear}-${utcMonth}-${utcDay}T${utcHour}:${utcMinute}:${utcSecond}`;
  } catch (error) {
    console.error('Error converting local to UTC:', error);
    return '';
  }
}

/**
 * タイムゾーンのオフセット（分）を取得
 * @param {string} timezone - タイムゾーン
 * @param {Date} date - 基準日時（サマータイム対応）
 * @returns {number} オフセット（分、UTCより進んでいれば正）
 */
function getTimezoneOffsetMinutes(timezone, date) {
  try {
    // 指定されたタイムゾーンでの時刻文字列を取得
    const tzString = date.toLocaleString('en-US', { timeZone: timezone });
    const tzDate = new Date(tzString);
    
    // UTCでの時刻文字列を取得
    const utcString = date.toLocaleString('en-US', { timeZone: 'UTC' });
    const utcDate = new Date(utcString);
    
    // 差分を分単位で返す（UTCより進んでいれば正）
    return (tzDate - utcDate) / (1000 * 60);
  } catch (error) {
    console.error('Error getting timezone offset:', error);
    // デフォルトでJSTのオフセットを返す
    return timezone === 'Asia/Tokyo' ? 540 : 0;
  }
}

/**
 * YYYYMMDDHH(MM)形式に変換（API用）
 * @param {number} year - 年
 * @param {number} month - 月（1-12）
 * @param {number} day - 日
 * @param {number} hour - 時
 * @param {number} minute - 分（オプション）
 * @param {string} timezone - タイムゾーン（省略時は現在の設定を使用）
 * @returns {string} UTC YYYYMMDDHH(MM)文字列
 */
export function convertLocalToUTCForAPI(year, month, day, hour, minute = null, timezone = null) {
  const utcString = convertLocalToUTC(year, month, day, hour, minute || 0, timezone);
  
  if (!utcString) return '';
  
  // UTC文字列からYYYYMMDDHH(MM)形式を生成
  const parts = utcString.split(/[-T:]/);
  const utcYear = parts[0];
  const utcMonth = parts[1];
  const utcDay = parts[2];
  const utcHour = parts[3];
  const utcMinute = parts[4];
  
  if (minute !== null) {
    return `${utcYear}${utcMonth}${utcDay}${utcHour}${utcMinute}`;
  } else {
    return `${utcYear}${utcMonth}${utcDay}${utcHour}`;
  }
}

/**
 * DateオブジェクトをUTC文字列に変換（API送信用）
 * @param {Date} date - Dateオブジェクト
 * @returns {string} UTC時刻文字列（例: '2025-11-17T16:26:00'）
 */
export function convertDateToUTC(date) {
  if (!date || !(date instanceof Date)) {
    console.error('Invalid date object:', date);
    return '';
  }
  
  if (isNaN(date.getTime())) {
    console.error('Invalid date time:', date);
    return '';
  }
  
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');
  
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

/**
 * 現在の時刻をユーザー設定のタイムゾーンで取得
 * @returns {Date} 現在時刻のDateオブジェクト
 */
export function getCurrentTimeInTimezone() {
  return new Date();
}

// ===============================================
// 後方互換性のための関数（非推奨）
// ===============================================

/**
 * @deprecated formatUTCWithTimezone を使用してください
 */
export function parseJSTString(jstString) {
  console.warn('parseJSTString is deprecated. Use formatUTCWithTimezone instead.');
  // JSTとして解釈
  const date = new Date(jstString + '+09:00');
  return date;
}

/**
 * @deprecated convertDateToUTC を使用してください
 */
export function toUTCString(date) {
  console.warn('toUTCString is deprecated. Use convertDateToUTC instead.');
  return convertDateToUTC(date);
}

/**
 * @deprecated formatUTCWithTimezone を使用してください
 */
export function toJSTString(date) {
  console.warn('toJSTString is deprecated. Use formatUTCWithTimezone instead.');
  const utcString = convertDateToUTC(date);
  return formatUTCWithTimezone(utcString, 'YYYY-MM-DD HH:mm:ss', 'Asia/Tokyo');
}
