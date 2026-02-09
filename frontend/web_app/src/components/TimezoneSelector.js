import React, { useState, useEffect } from 'react';
import {
  FormControl,
  Select,
  MenuItem,
  Box,
  Typography,
  Tooltip
} from '@mui/material';
import { Public as PublicIcon } from '@mui/icons-material';
import {
  getCurrentTimezone,
  setCurrentTimezone,
  getSupportedTimezones
} from '../utils/timezone';
import { useTranslation } from 'react-i18next';

/**
 * タイムゾーン選択コンポーネント
 * 
 * ユーザーがタイムゾーンを選択できるドロップダウンメニューを提供します。
 * 選択されたタイムゾーンはLocalStorageに保存され、
 * 全ての時刻表示に反映されます。
 */
const TimezoneSelector = () => {
  const { t } = useTranslation('navigation');
  const [timezone, setTimezone] = useState(getCurrentTimezone());

  useEffect(() => {
    // タイムゾーン変更イベントをリッスン
    const handleTimezoneChange = (event) => {
      setTimezone(event.detail.timezone);
    };

    window.addEventListener('timezoneChanged', handleTimezoneChange);
    return () => {
      window.removeEventListener('timezoneChanged', handleTimezoneChange);
    };
  }, []);

  const handleChange = (event) => {
    const newTimezone = event.target.value;
    setTimezone(newTimezone);
    setCurrentTimezone(newTimezone);
    
    // タイムゾーン変更を反映するためにページをリロード
    // （将来的にはReactのContext APIを使用してリロードなしで反映することも可能）
    setTimeout(() => {
      window.location.reload();
    }, 100);
  };

  // i18n対応のタイムゾーンリストを取得
  const supportedTimezones = getSupportedTimezones(t);

  // 現在選択されているタイムゾーンのラベルを取得
  const currentTimezoneLabel = supportedTimezones.find(
    tz => tz.value === timezone
  )?.label || 'JST';

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Tooltip title={t('timezoneSettings')}>
        <PublicIcon sx={{ color: 'inherit', fontSize: 20 }} />
      </Tooltip>
      <FormControl size="small" sx={{ minWidth: 180 }}>
        <Select
          value={timezone}
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
          {supportedTimezones.map((tz) => (
            <MenuItem key={tz.value} value={tz.value}>
              <Box sx={{ py: 0.5 }}>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {tz.label}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {tz.offset}
                </Typography>
              </Box>
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    </Box>
  );
};

export default TimezoneSelector;


