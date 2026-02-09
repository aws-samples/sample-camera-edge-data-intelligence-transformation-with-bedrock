// ===============================================
// i18next 設定ファイル
// ===============================================
// 
// react-i18nextを使用した多言語対応の設定
// サポート言語: 日本語(ja), 英語(en)
//
// ===============================================

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// 翻訳ファイルのインポート
import jaCommon from './locales/ja/common.json';
import jaNavigation from './locales/ja/navigation.json';
import jaPages from './locales/ja/pages.json';
import jaMessages from './locales/ja/messages.json';
import jaDialogs from './locales/ja/dialogs.json';

import enCommon from './locales/en/common.json';
import enNavigation from './locales/en/navigation.json';
import enPages from './locales/en/pages.json';
import enMessages from './locales/en/messages.json';
import enDialogs from './locales/en/dialogs.json';

// 翻訳リソース
const resources = {
  ja: {
    common: jaCommon,
    navigation: jaNavigation,
    pages: jaPages,
    messages: jaMessages,
    dialogs: jaDialogs
  },
  en: {
    common: enCommon,
    navigation: enNavigation,
    pages: enPages,
    messages: enMessages,
    dialogs: enDialogs
  }
};

// LocalStorageからロケール設定を取得
const getStoredLocale = () => {
  try {
    return localStorage.getItem('userLocale') || 'ja';
  } catch (error) {
    return 'ja';
  }
};

i18n
  // ブラウザ言語検出プラグイン（カスタムロジックで上書き）
  .use(LanguageDetector)
  // react-i18nextバインディング
  .use(initReactI18next)
  // 初期化
  .init({
    resources,
    lng: getStoredLocale(), // LocalStorageから取得した言語
    fallbackLng: 'ja', // フォールバック言語
    defaultNS: 'common', // デフォルト名前空間
    ns: ['common', 'navigation', 'pages', 'messages', 'dialogs'], // 使用する名前空間
    
    interpolation: {
      escapeValue: false // Reactは既にXSS対策済み
    },
    
    // デバッグモード（本番環境ではfalse）
    debug: process.env.NODE_ENV === 'development',
    
    // キーが見つからない場合の動作
    returnEmptyString: false,
    returnNull: false,
    
    // ブラウザ言語検出の設定（LocalStorageを優先）
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'userLocale'
    },
    
    // React Suspenseサポート
    react: {
      useSuspense: false // Suspenseを使用しない（エラーハンドリングを簡単に）
    }
  });

// ロケール変更時のカスタムイベントをリッスン
window.addEventListener('localeChanged', (event) => {
  const { locale } = event.detail;
  i18n.changeLanguage(locale);
});

export default i18n;

