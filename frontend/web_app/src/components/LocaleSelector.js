import React, { useState, useEffect } from 'react';
import {
  FormControl,
  Select,
  MenuItem,
  Box,
  Typography,
  Tooltip
} from '@mui/material';
import { Language as LanguageIcon } from '@mui/icons-material';
import {
  getCurrentLocale,
  setCurrentLocale,
  SUPPORTED_LOCALES
} from '../utils/locale';
import { useTranslation } from 'react-i18next';

/**
 * ロケール選択コンポーネント
 * 
 * ユーザーがロケール（言語）を選択できるドロップダウンメニューを提供します。
 * 選択されたロケールはLocalStorageに保存され、
 * 全ての表示テキストと日付フォーマットに即座に反映されます。
 * 
 * 設計:
 * - タイムゾーンとは独立して管理
 * - ページリロードなしで即座に反映
 * - i18nextと連携
 */
const LocaleSelector = () => {
  const [locale, setLocale] = useState(getCurrentLocale());
  const { i18n, t } = useTranslation('navigation');

  useEffect(() => {
    // ロケール変更イベントをリッスン
    const handleLocaleChange = (event) => {
      setLocale(event.detail.locale);
    };

    window.addEventListener('localeChanged', handleLocaleChange);
    return () => {
      window.removeEventListener('localeChanged', handleLocaleChange);
    };
  }, []);

  const handleChange = (event) => {
    const newLocale = event.target.value;
    setLocale(newLocale);
    setCurrentLocale(newLocale);
    
    // i18nextの言語を即座に変更（ページリロード不要）
    i18n.changeLanguage(newLocale);
  };

  // 現在選択されているロケールの情報を取得
  const currentLocaleConfig = SUPPORTED_LOCALES.find(
    loc => loc.value === locale
  ) || SUPPORTED_LOCALES[0];

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Tooltip title={t('localeSettings')}>
        <LanguageIcon sx={{ color: 'inherit', fontSize: 20 }} />
      </Tooltip>
      <FormControl size="small" sx={{ minWidth: 160 }}>
        <Select
          value={locale}
          onChange={handleChange}
          displayEmpty
          sx={{
            color: 'inherit',
            fontSize: '0.875rem',
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: 'rgba(255, 255, 255, 0.23)'
            },
            '&:hover .MuiOutlinedInput-notchedOutline': {
              borderColor: 'rgba(255, 255, 255, 0.4)'
            },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
              borderColor: 'rgba(255, 255, 255, 0.6)'
            },
            '& .MuiSelect-select': {
              py: 1,
              display: 'flex',
              alignItems: 'center'
            }
          }}
        >
          {SUPPORTED_LOCALES.map((loc) => (
            <MenuItem key={loc.value} value={loc.value}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
                <Typography component="span" sx={{ fontSize: '1.2rem' }}>
                  {loc.flag}
                </Typography>
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {loc.label}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {loc.labelEn}
                  </Typography>
                </Box>
              </Box>
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    </Box>
  );
};

export default LocaleSelector;

