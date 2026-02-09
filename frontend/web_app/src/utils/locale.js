// ===============================================
// ロケール管理ユーティリティ
// ===============================================
// 
// 基本原則:
// - ロケール設定: LocalStorageに保存
// - デフォルト: 日本語 (ja)
// - サポート: 日本語(ja), 英語(en)
// - タイムゾーンとは独立して管理
//
// ===============================================

// ロケール設定のキー
const LOCALE_STORAGE_KEY = 'userLocale';

// デフォルトロケール
const DEFAULT_LOCALE = 'ja';

// サポートされるロケール
export const SUPPORTED_LOCALES = [
  { 
    value: 'ja', 
    label: '日本語', 
    labelEn: 'Japanese',
    flag: '🇯🇵', 
    dateLocale: 'ja-JP',
    timeFormat: '24h' // 24時間制
  },
  { 
    value: 'en', 
    label: 'English', 
    labelEn: 'English',
    flag: '🇺🇸', 
    dateLocale: 'en-US',
    timeFormat: '12h' // 12時間制
  }
];

/**
 * 現在のロケール設定を取得
 * @returns {string} ロケール文字列（例: 'ja', 'en'）
 */
export function getCurrentLocale() {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored && SUPPORTED_LOCALES.some(loc => loc.value === stored)) {
      return stored;
    }
    return DEFAULT_LOCALE;
  } catch (error) {
    console.error('Failed to get locale from localStorage:', error);
    return DEFAULT_LOCALE;
  }
}

/**
 * ロケール設定を保存
 * @param {string} locale - ロケール文字列（'ja' または 'en'）
 */
export function setCurrentLocale(locale) {
  try {
    // バリデーション
    if (!SUPPORTED_LOCALES.some(loc => loc.value === locale)) {
      console.error('Unsupported locale:', locale);
      return;
    }
    
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    
    // カスタムイベントを発火してコンポーネントに通知
    window.dispatchEvent(new CustomEvent('localeChanged', { 
      detail: { locale } 
    }));
    
    console.log('Locale changed to:', locale);
  } catch (error) {
    console.error('Failed to save locale to localStorage:', error);
  }
}

/**
 * 日付フォーマット用のロケール文字列を取得
 * Intl.DateTimeFormat で使用する形式 (例: 'ja-JP', 'en-US')
 * @returns {string} ロケール文字列
 */
export function getDateFormatLocale() {
  const currentLocale = getCurrentLocale();
  const localeConfig = SUPPORTED_LOCALES.find(loc => loc.value === currentLocale);
  return localeConfig?.dateLocale || 'ja-JP';
}

/**
 * 現在のロケールの時刻フォーマット形式を取得
 * @returns {string} '12h' または '24h'
 */
export function getTimeFormat() {
  const currentLocale = getCurrentLocale();
  const localeConfig = SUPPORTED_LOCALES.find(loc => loc.value === currentLocale);
  return localeConfig?.timeFormat || '24h';
}

/**
 * 現在のロケール設定オブジェクトを取得
 * @returns {Object} ロケール設定オブジェクト
 */
export function getCurrentLocaleConfig() {
  const currentLocale = getCurrentLocale();
  return SUPPORTED_LOCALES.find(loc => loc.value === currentLocale) || SUPPORTED_LOCALES[0];
}

/**
 * ブラウザの言語設定からデフォルトロケールを推測
 * @returns {string} ロケール文字列
 */
export function detectBrowserLocale() {
  try {
    const browserLang = navigator.language || navigator.userLanguage;
    if (browserLang.startsWith('ja')) {
      return 'ja';
    } else if (browserLang.startsWith('en')) {
      return 'en';
    }
    return DEFAULT_LOCALE;
  } catch (error) {
    return DEFAULT_LOCALE;
  }
}

/**
 * 初回アクセス時にロケールを初期化
 * LocalStorageにロケール設定がない場合、ブラウザ言語を検出して設定
 */
export function initializeLocale() {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (!stored) {
      const browserLocale = detectBrowserLocale();
      localStorage.setItem(LOCALE_STORAGE_KEY, browserLocale);
      console.log('Initialized locale to:', browserLocale);
    }
  } catch (error) {
    console.error('Failed to initialize locale:', error);
  }
}

