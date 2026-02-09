import React, { useEffect, useState } from 'react';
import { Button, ButtonGroup, Typography, Box } from '@mui/material';
import { ArrowBackIos, ArrowForwardIos } from '@mui/icons-material';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs from 'dayjs';
import 'dayjs/locale/ja';
import 'dayjs/locale/en';
import { useTranslation } from 'react-i18next';

const DateSelector = ({ selectedDate, onDateChange }) => {
  const { t, i18n } = useTranslation('common');
  const [dayjsLocale, setDayjsLocale] = useState('ja');
  
  // ロケールが変更されたときにdayjsのロケールを更新
  useEffect(() => {
    const locale = i18n.language === 'ja' ? 'ja' : 'en';
    setDayjsLocale(locale);
    dayjs.locale(locale);
  }, [i18n.language]);
  
  // Parse the selected date (format: "yyyy-mm-dd")
  const parseDate = (dateString) => {
    if (!dateString || typeof dateString !== 'string') return new Date();
    const match = dateString.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return new Date();
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    const day = parseInt(match[3], 10);
    return new Date(year, month, day);
  };
  
  // Format date to yyyy-mm-dd format
  const formatDate = (date) => {
    if (!(date instanceof Date) || isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  
  // Get previous day
  const getPreviousDay = () => {
    const date = parseDate(selectedDate);
    date.setDate(date.getDate() - 1);
    return formatDate(date);
  };
  
  // Get next day
  const getNextDay = () => {
    const date = parseDate(selectedDate);
    date.setDate(date.getDate() + 1);
    return formatDate(date);
  };
  
  // Get today
  const getToday = () => {
    return formatDate(new Date());
  };
  
  // Handle previous day button click
  const handlePreviousDay = () => {
    onDateChange(getPreviousDay());
  };
  
  // Handle next day button click
  const handleNextDay = () => {
    onDateChange(getNextDay());
  };
  
  // Handle today button click
  const handleToday = () => {
    onDateChange(getToday());
  };
  
  // Handle date picker change
  const handleDatePickerChange = (newValue) => {
    if (newValue && newValue.isValid()) {
      const date = newValue.toDate();
      onDateChange(formatDate(date));
    }
  };
  
  // Convert selectedDate to dayjs object for DatePicker
  const selectedDateAsDayjs = dayjs(parseDate(selectedDate));
  
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <ButtonGroup variant="outlined" size="small">
          <Button onClick={handlePreviousDay} startIcon={<ArrowBackIos />}>
            {t('previousDay')}
          </Button>
          <Button onClick={handleToday}>
            {t('today')}
          </Button>
          <Button onClick={handleNextDay} endIcon={<ArrowForwardIos />}>
            {t('nextDay')}
          </Button>
        </ButtonGroup>
        
        <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale={dayjsLocale}>
          <DatePicker
            value={selectedDateAsDayjs}
            onChange={handleDatePickerChange}
            slotProps={{
              textField: {
                size: 'small',
                sx: { width: 160 }
              },
              actionBar: {
                actions: ['today', 'cancel', 'accept']
              }
            }}
            format="YYYY-MM-DD"
          />
        </LocalizationProvider>
      </Box>
      
      <Typography variant="h6" component="div">
        {selectedDate}
      </Typography>
    </Box>
  );
};

export default DateSelector;
