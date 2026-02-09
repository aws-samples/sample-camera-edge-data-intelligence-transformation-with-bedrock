import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { 
  Container, 
  Typography, 
  Box, 
  Paper, 
  Card, 
  CardContent, 
  CircularProgress, 
  Alert,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Divider,
  Grid,
  RadioGroup,
  FormControlLabel,
  Radio,
  FormLabel,
  Checkbox,
  ListItemText,
  Chip,
  Tab,
  Tabs,
  List,
  ListItem,
  ListItemIcon,
  ListItemButton,
  useTheme,
  useMediaQuery,
  Button,
  ButtonGroup,
  IconButton,
  Tooltip
} from '@mui/material';
import { Timeline, BarChart, FilterList, Insights, ChevronLeft, ChevronRight, ArrowForward } from '@mui/icons-material';
import PageLayout from '../components/PageLayout';
import TitleArea from '../components/TitleArea';
import { Line, Bar } from 'react-chartjs-2';
import { HEADER_HEIGHT, TITLE_AREA_HEIGHT } from '../constants/layout';
import { getSearchOptions, getDetectorTags, getTimeseriesData, getTimeseriesDetailLogs } from '../services/api';
import { convertDateToUTC, formatUTCWithTimezone, getCurrentTimezone } from '../utils/timezone';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip as ChartTooltip,
  Legend,
  TimeScale
} from 'chart.js';
import 'chartjs-adapter-date-fns';
import BookmarkButton from '../components/BookmarkButton';
import { useTranslation } from 'react-i18next';

// Chart.js components registration
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  ChartTooltip,
  Legend,
  TimeScale
);



// Chart colors
const CHART_COLORS = [
  'rgb(255, 99, 132)',
  'rgb(54, 162, 235)',
  'rgb(255, 205, 86)',
  'rgb(75, 192, 192)',
  'rgb(153, 102, 255)',
  'rgb(255, 159, 64)',
  'rgb(199, 199, 199)',
  'rgb(83, 102, 147)'
];

// Filter Panel Component
const FilterPanel = ({ 
  searchOptions,
  selectedPlace,
  setSelectedPlace,
  selectedCamera,
  setSelectedCamera,
  granularity,
  setGranularity,
  availableTags,
  selectedTags,
  setSelectedTags,
  isLoading,
  timeRange,
  moveTimeRange,
  t
}) => {
  const filteredCameras = selectedPlace 
    ? (searchOptions.cameras || []).filter(camera => camera.place_id === selectedPlace)
    : (searchOptions.cameras || []);

  return (
    <Paper sx={{ p: 3, height: 'fit-content' }}>
      <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <FilterList />
        {t('pages:insight.filters')}
      </Typography>
      
      <Grid container spacing={2}>
        {/* 場所選択 */}
        <Grid item xs={12}>
          <FormControl fullWidth size="small">
            <InputLabel>{t('pages:insight.place')}</InputLabel>
            <Select
              value={selectedPlace}
              label={t('pages:insight.place')}
              onChange={(e) => {
                setSelectedPlace(e.target.value);
                setSelectedCamera(''); // 場所が変更されたらカメラをリセット
              }}
            >
              <MenuItem value="">{t('pages:insight.allPlaces')}</MenuItem>
              {(searchOptions.places || []).map((place) => (
                <MenuItem key={place.place_id} value={place.place_id}>
                  {place.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>

        {/* カメラ選択 */}
        <Grid item xs={12}>
          <FormControl fullWidth size="small">
            <InputLabel>{t('pages:insight.camera')}</InputLabel>
            <Select
              value={selectedCamera}
              label={t('pages:insight.camera')}
              onChange={(e) => setSelectedCamera(e.target.value)}
              disabled={!selectedPlace}
            >
              <MenuItem value="">{t('pages:insight.allCameras')}</MenuItem>
              {filteredCameras.map((camera) => (
                <MenuItem key={camera.camera_id} value={camera.camera_id}>
                  {camera.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>

        <Grid item xs={12}>
          <Divider sx={{ my: 1 }} />
        </Grid>

        {/* 時間粒度選択 */}
        <Grid item xs={12}>
          <FormLabel component="legend">{t('pages:insight.timeGranularity')}</FormLabel>
          <RadioGroup
            value={granularity}
            onChange={(e) => setGranularity(e.target.value)}
            row
          >
            <FormControlLabel value="MINUTE" control={<Radio size="small" />} label={t('pages:insight.minute')} />
            <FormControlLabel value="HOUR" control={<Radio size="small" />} label={t('pages:insight.hour')} />
            <FormControlLabel value="DAY" control={<Radio size="small" />} label={t('pages:insight.day')} />
          </RadioGroup>
          <Typography variant="caption" color="text.secondary" display="block">
            {granularity === 'MINUTE' && t('pages:insight.timeRange3Hours')}
            {granularity === 'HOUR' && t('pages:insight.timeRange1Day')}
            {granularity === 'DAY' && t('pages:insight.timeRange2Weeks')}
          </Typography>
          
          {/* 時間範囲表示（ユーザータイムゾーン） */}
          {timeRange.startTime && timeRange.endTime && (
            <Box sx={{ mt: 1 }}>
              <Typography variant="caption" color="text.secondary" display="block">
                {t('pages:insight.startTime')}: {timeRange.startTime.toLocaleString('ja-JP', { timeZone: getCurrentTimezone(), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block">
                {t('pages:insight.endTime')}: {timeRange.endTime.toLocaleString('ja-JP', { timeZone: getCurrentTimezone(), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
              </Typography>
              
              {/* 時間移動ボタン */}
              <ButtonGroup size="small" sx={{ mt: 1 }}>
                <Button onClick={() => moveTimeRange('prev')}>{t('pages:insight.movePrev')}</Button>
                <Button onClick={() => moveTimeRange('next')}>{t('pages:insight.moveNext')}</Button>
              </ButtonGroup>
            </Box>
          )}
        </Grid>

        <Grid item xs={12}>
          <Divider sx={{ my: 1 }} />
        </Grid>

        {/* タグ選択 */}
        <Grid item xs={12}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Typography variant="subtitle2">
              {t('pages:insight.tagSelection')} ({t('pages:insight.tagCount', { selected: selectedTags.length, total: availableTags.length })})
            </Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button 
                size="small" 
                variant="outlined" 
                onClick={() => setSelectedTags([...availableTags])}
                disabled={isLoading || selectedTags.length === availableTags.length}
              >
                {t('pages:insight.selectAll')}
              </Button>
              <Button 
                size="small" 
                variant="outlined" 
                onClick={() => setSelectedTags([])}
                disabled={isLoading || selectedTags.length === 0}
              >
                {t('pages:insight.deselectAll')}
              </Button>
            </Box>
          </Box>
          {isLoading ? (
            <CircularProgress size={20} />
          ) : (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, maxHeight: 200, overflowY: 'auto' }}>
              {availableTags.map((tag) => (
                <Chip
                  key={tag}
                  label={tag}
                  clickable
                  size="small"
                  variant={selectedTags.includes(tag) ? 'filled' : 'outlined'}
                  color={selectedTags.includes(tag) ? 'primary' : 'default'}
                  onClick={() => {
                    if (selectedTags.includes(tag)) {
                      setSelectedTags(selectedTags.filter(t => t !== tag));
                    } else {
                      setSelectedTags([...selectedTags, tag]);
                    }
                  }}
                />
              ))}
            </Box>
          )}
        </Grid>
      </Grid>
    </Paper>
  );
};

// Single Tag Line Chart Component
const SingleTagLineChart = ({ data, tagName, onDataPointClick, granularity, timeRange, t }) => {
  // データをメモ化してリロードを防ぐ
  const processedData = useMemo(() => {
    return processDataForSingleTag(data, tagName);
  }, [data, tagName]);
  
  // 時間粒度に応じた時間軸設定（ユーザータイムゾーン対応 - 折れ線グラフ用）
  const getTimeScaleConfig = (granularity) => {
    switch (granularity) {
      case 'MINUTE':
        return {
          unit: 'hour',
          displayFormats: {
            hour: 'HH:mm'
          },
          tooltipFormat: 'MM/dd HH:mm',
          min: timeRange.startTime,
          max: timeRange.endTime
        };
      case 'HOUR':
        return {
          unit: 'hour',
          displayFormats: {
            hour: 'HH:mm'
          },
          tooltipFormat: 'MM/dd HH:mm',
          min: timeRange.startTime,
          max: timeRange.endTime
        };
      case 'DAY':
        return {
          unit: 'day',
          displayFormats: {
            day: 'MM/dd'
          },
          tooltipFormat: 'MM/dd',
          min: timeRange.startTime,
          max: timeRange.endTime
        };
      default:
        return {
          unit: 'hour',
          displayFormats: {
            hour: 'HH:mm'
          },
          tooltipFormat: 'MM/dd HH:mm',
          min: timeRange.startTime,
          max: timeRange.endTime
        };
    }
  };
  
  const timeConfig = getTimeScaleConfig(granularity);
  
  // オプションをメモ化
  const options = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false, // 個別グラフなのでレジェンド不要
      },
      title: {
        display: true,
        text: tagName,
        font: {
          size: 14,
          weight: 'bold'
        }
      },
      tooltip: {
        callbacks: {
          title: function(context) {
            // タグ名を表示
            return tagName;
          },
          label: function(context) {
            const dataPoint = context.dataset.data[context.dataIndex];
            
            if (dataPoint && dataPoint.startTime && dataPoint.endTime) {
              return [
                `${t('pages:insight.countLabel')}: ${dataPoint.y}`,
                `${t('pages:insight.startTimeLabel')}: ${formatUTCWithTimezone(dataPoint.startTime, 'YYYY-MM-DD HH:mm:ss')}`,
                `${t('pages:insight.endTimeLabel')}: ${formatUTCWithTimezone(dataPoint.endTime, 'YYYY-MM-DD HH:mm:ss')}`
              ];
            }
            return `${t('pages:insight.countLabel')}: ${context.parsed.y}`;
          }
        }
      }
    },
    scales: {
      x: {
        type: 'time',
        time: {
          unit: timeConfig.unit,
          displayFormats: timeConfig.displayFormats,
          tooltipFormat: timeConfig.tooltipFormat,
          timezone: getCurrentTimezone()
        },
        min: timeConfig.min,
        max: timeConfig.max,
        title: {
          display: false // 個別グラフなので軸タイトル簡素化
        }
      },
      y: {
        beginAtZero: true,
        suggestedMax: 10, // 空のグラフでも適切な範囲を表示
        title: {
          display: false
        }
      }
    },
    onClick: (event, elements) => {
      if (elements.length > 0) {
        const element = elements[0];
        const datasetIndex = element.datasetIndex;
        const dataIndex = element.index;
        const dataset = processedData.datasets[datasetIndex];
        const dataPoint = dataset.data[dataIndex];
        
        if (dataPoint && dataPoint.startTime && dataPoint.endTime) {
          onDataPointClick({
            tagName: tagName,
            startTime: dataPoint.startTime,
            endTime: dataPoint.endTime,
            count: dataPoint.y,
            timeLabel: formatUTCWithTimezone(dataPoint.startTime, 'YYYY-MM-DD HH:mm:ss')
          });
        }
      }
    }
  }), [timeConfig, processedData, onDataPointClick, tagName]);

  return (
    <Box sx={{ height: 300 }}>
      <Line data={processedData} options={options} />
    </Box>
  );
};

// Multiple Tags Line Charts Container
const MultipleTagLineCharts = ({ data, selectedTags, onDataPointClick, granularity, timeRange, t }) => {
  // グリッドサイズを計算
  const getGridSize = (tagCount) => {
    if (tagCount === 1) return 12;
    if (tagCount === 2) return 6;
    if (tagCount >= 3 && tagCount <= 4) return 6;
    return 4; // 5+タグ
  };

  const gridSize = getGridSize(selectedTags.length);

  return (
    <Grid container spacing={2}>
      {selectedTags.map((tagName) => (
        <Grid item xs={12} md={gridSize} key={tagName}>
          <SingleTagLineChart
            data={data}
            tagName={tagName}
            onDataPointClick={onDataPointClick}
            granularity={granularity}
            timeRange={timeRange}
            t={t}
          />
        </Grid>
      ))}
    </Grid>
  );
};



// Horizontal Bar Chart Component
const HorizontalBarChartComponent = ({ data, onDataPointClick, granularity, selectedTags, timeRange, t }) => {
  // タグ数に応じた高さ計算
  const calculateChartHeight = (tagCount) => {
    if (tagCount <= 5) return 400;
    if (tagCount <= 6) return 470;
    if (tagCount <= 7) return 540;
    if (tagCount <= 8) return 610;
    if (tagCount <= 9) return 680;
    if (tagCount <= 10) return 750;
    if (tagCount <= 11) return 820;
    if (tagCount <= 12) return 890;
    if (tagCount <= 13) return 960;
    if (tagCount <= 14) return 1030;
    if (tagCount <= 15) return 1100;
    if (tagCount <= 16) return 1170;
    if (tagCount <= 17) return 1240;
    if (tagCount <= 18) return 1310;
    if (tagCount <= 19) return 1380;
    if (tagCount <= 20) return 1450;
    if (tagCount <= 21) return 1520;
    if (tagCount <= 22) return 1590;
    if (tagCount <= 23) return 1660;
    if (tagCount <= 24) return 1730;
    if (tagCount <= 25) return 1800;
    if (tagCount <= 26) return 1870;
    if (tagCount <= 27) return 1940;
    if (tagCount <= 28) return 2010;
    return 2080; // それ以上は2500pxをmax
  };

  // データをメモ化してリロードを防ぐ
  const processedData = useMemo(() => {
    return processDataForBarChart(data, granularity, selectedTags);
  }, [data, granularity, selectedTags]);

  // 動的な高さを計算
  const chartHeight = calculateChartHeight(selectedTags.length);
  
  // 時間粒度に応じた時間軸設定（ユーザータイムゾーン対応 - 横棒グラフ用）
  const getTimeScaleConfig = (granularity) => {
    switch (granularity) {
      case 'MINUTE':
        return {
          unit: 'hour',
          displayFormats: {
            hour: 'HH:mm'
          },
          tooltipFormat: 'MM/dd HH:mm',
          min: timeRange.startTime,
          max: timeRange.endTime
        };
      case 'HOUR':
        return {
          unit: 'hour',
          displayFormats: {
            hour: 'HH:mm'
          },
          tooltipFormat: 'MM/dd HH:mm',
          min: timeRange.startTime,
          max: timeRange.endTime
        };
      case 'DAY':
        return {
          unit: 'day',
          displayFormats: {
            day: 'MM/dd'
          },
          tooltipFormat: 'MM/dd',
          min: timeRange.startTime,
          max: timeRange.endTime
        };
      default:
        return {
          unit: 'hour',
          displayFormats: {
            hour: 'HH:mm'
          },
          tooltipFormat: 'MM/dd HH:mm',
          min: timeRange.startTime,
          max: timeRange.endTime
        };
    }
  };
  
  const timeConfig = getTimeScaleConfig(granularity);
  
  // オプションをメモ化
  const options = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: 'y',
    plugins: {
      legend: {
        display: false, // 解説を非表示
      },
      title: {
        display: true,
        text: t('pages:insight.tagTimeseriesData')
      },
      tooltip: {
        callbacks: {
          title: function(context) {
            // タグ名を表示
            return context[0].label;
          },
          label: function(context) {
            const dataset = context.dataset;
            const rawData = dataset.rawData;
            
            if (rawData) {
              return [
                `${t('pages:insight.countLabel')}: ${rawData.count}`,
                `${t('pages:insight.startTimeLabel')}: ${formatUTCWithTimezone(rawData.startTime, 'YYYY-MM-DD HH:mm:ss')}`,
                `${t('pages:insight.endTimeLabel')}: ${formatUTCWithTimezone(rawData.endTime, 'YYYY-MM-DD HH:mm:ss')}`
              ];
            }
            return '';
          }
        }
      }
    },
    scales: {
      x: {
        type: 'time',
        time: {
          unit: timeConfig.unit,
          displayFormats: timeConfig.displayFormats,
          tooltipFormat: timeConfig.tooltipFormat,
          timezone: getCurrentTimezone()
        },
        min: timeConfig.min,
        max: timeConfig.max,
        title: {
          display: true,
          text: t('pages:insight.timeLabel')
        }
      },
      y: {
        stacked: true,
        title: {
          display: true,
          text: t('pages:insight.tagLabel')
        }
      }
    },
    onClick: (event, elements) => {
      if (elements.length > 0) {
        const element = elements[0];
        const datasetIndex = element.datasetIndex;
        const dataset = processedData.datasets[datasetIndex];
        const rawData = dataset.rawData;
        
        if (rawData) {
          onDataPointClick({
            tagName: rawData.tagName,
            startTime: rawData.startTime,
            endTime: rawData.endTime,
            count: rawData.count,
            timeLabel: `${formatUTCWithTimezone(rawData.startTime, 'YYYY-MM-DD HH:mm:ss')} ~ ${formatUTCWithTimezone(rawData.endTime, 'YYYY-MM-DD HH:mm:ss')}`
          });
        }
      }
    }
  }), [timeConfig, processedData, onDataPointClick]);

  return (
    <Box>
      <Box sx={{ height: chartHeight }}>
        <Bar data={processedData} options={options} />
      </Box>
      
      {/* 色の説明 */}
      <Box sx={{ mt: 2, p: 2, backgroundColor: 'grey.50', borderRadius: 1 }}>
        <Typography variant="subtitle2" gutterBottom>
          {t('pages:insight.barColorMeaning', { 
            granularity: granularity === 'MINUTE' ? t('pages:insight.minute') : granularity === 'HOUR' ? t('pages:insight.hour') : t('pages:insight.day')
          })}
        </Typography>
        <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
          {granularity === 'MINUTE' && (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ width: 16, height: 16, backgroundColor: 'rgb(54, 162, 235)', borderRadius: 0.5 }} />
                <Typography variant="caption">{t('pages:insight.countRange_1_2')}</Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ width: 16, height: 16, backgroundColor: 'rgb(255, 205, 86)', borderRadius: 0.5 }} />
                <Typography variant="caption">{t('pages:insight.countRange_3_5')}</Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ width: 16, height: 16, backgroundColor: 'rgb(255, 99, 132)', borderRadius: 0.5 }} />
                <Typography variant="caption">{t('pages:insight.countRange_6Plus')}</Typography>
              </Box>
            </>
          )}
          {granularity === 'HOUR' && (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ width: 16, height: 16, backgroundColor: 'rgb(54, 162, 235)', borderRadius: 0.5 }} />
                <Typography variant="caption">{t('pages:insight.countRange_1_3')}</Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ width: 16, height: 16, backgroundColor: 'rgb(255, 205, 86)', borderRadius: 0.5 }} />
                <Typography variant="caption">{t('pages:insight.countRange_4_7')}</Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ width: 16, height: 16, backgroundColor: 'rgb(255, 99, 132)', borderRadius: 0.5 }} />
                <Typography variant="caption">{t('pages:insight.countRange_8Plus')}</Typography>
              </Box>
            </>
          )}
          {granularity === 'DAY' && (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ width: 16, height: 16, backgroundColor: 'rgb(54, 162, 235)', borderRadius: 0.5 }} />
                <Typography variant="caption">{t('pages:insight.countRange_1_5')}</Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ width: 16, height: 16, backgroundColor: 'rgb(255, 205, 86)', borderRadius: 0.5 }} />
                <Typography variant="caption">{t('pages:insight.countRange_6_10')}</Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ width: 16, height: 16, backgroundColor: 'rgb(255, 99, 132)', borderRadius: 0.5 }} />
                <Typography variant="caption">{t('pages:insight.countRange_11Plus')}</Typography>
              </Box>
            </>
          )}
        </Box>
      </Box>
    </Box>
  );
};

// Detail Panel Component
const DetailPanel = ({ detailLogs, isLoading, selectedDataPoint, generateDetailLogUrl, t }) => {
  const navigate = useNavigate();
  // ISO文字列→yyyymmddhhmi変換
  const toYYYYMMDDHHMI = (isoString) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${year}${month}${day}${hours}${minutes}`;
  };
  if (!selectedDataPoint) {
    return (
      <Paper sx={{ p: 3, height: 'fit-content' }}>
        <Typography variant="h6" gutterBottom>
          {t('pages:insight.detailLog')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('pages:insight.clickDataPoint')}
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="h6" gutterBottom>
        {t('pages:insight.detailLog')}
      </Typography>
      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent sx={{ pb: '16px !important' }}>
          <Typography variant="subtitle2" color="primary">
            {selectedDataPoint.tagName}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {selectedDataPoint.timeLabel || t('pages:insight.timeSlot')}: {t('pages:insight.countLabel')} {selectedDataPoint.count}
          </Typography>
          <Typography variant="caption" display="block">
            {formatUTCWithTimezone(selectedDataPoint.startTime, 'YYYY-MM-DD HH:mm:ss')} 〜 {formatUTCWithTimezone(selectedDataPoint.endTime, 'YYYY-MM-DD HH:mm:ss')}
          </Typography>
        </CardContent>
      </Card>
      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Box sx={{ maxHeight: 500, overflowY: 'auto' }}>
          <List>
            {detailLogs.map((log, index) => (
              <Box
                key={log.detect_log_id || index}
                sx={{
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  py: 1.5,
                  px: 1,
                  minHeight: 80,
                  '&:hover': { backgroundColor: 'action.hover' }
                }}
              >
                {/* 右上にブックマークボタン */}
                <Box sx={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}>
                  <BookmarkButton 
                    bookmarkData={{
                      ...log,
                      datetime: log.datetime || log.start_time || undefined
                    }}
                    variant="icon"
                    tooltip="ブックマークする"
                  />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0, pr: 7 }}>
                  <Typography variant="body2" fontWeight="bold" noWrap>
                    {log.camera_name} ({log.place_name})
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                      {log.start_time ? formatUTCWithTimezone(log.start_time, 'YYYY-MM-DD HH:mm:ss') : '時間不明'}
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 1 }}>
                    {log.detect_result || '検出結果なし'}
                  </Typography>
                  {log.detect_tag && (
                    <Box sx={{ mt: 1 }}>
                      {Array.isArray(log.detect_tag) ? (
                        log.detect_tag.map((tag, tagIndex) => (
                          <Chip key={tagIndex} label={tag} size="small" sx={{ mr: 0.5 }} />
                        ))
                      ) : (
                        <Chip label={log.detect_tag} size="small" />
                      )}
                    </Box>
                  )}
                </Box>
                {/* 右下または右端にCameraViewボタン */}
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
                  <Button
                    variant="outlined"
                    color="primary"
                    size="small"
                    startIcon={<ArrowForward />}
                    onClick={() => navigate(generateDetailLogUrl(log))}
                  >
                    {t('pages:insight.detail')}
                  </Button>
                </Box>
              </Box>
            ))}
          </List>
          {detailLogs.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', p: 2 }}>
              {t('pages:insight.noLogsFound')}
            </Typography>
          )}
        </Box>
      )}
    </Paper>
  );
};

// Data processing functions
function processDataForLineChart(rawData) {
  const tagGroups = {};
  
  // タグごとにデータをグループ化
  rawData.forEach(item => {
    if (!tagGroups[item.tag_name]) {
      tagGroups[item.tag_name] = [];
    }
    tagGroups[item.tag_name].push(item);
  });
  
  const datasets = Object.keys(tagGroups).map((tagName, index) => {
    const tagData = tagGroups[tagName];
    tagData.sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
    
    return {
      label: tagName,
      data: tagData.map(item => {
        // APIレスポンスはUTC形式なのでそのまま使用（Chart.jsがタイムゾーン変換）
        const utcStartTime = new Date(item.start_time + 'Z');
        return {
          x: utcStartTime,
          y: item.count,
          startTime: item.start_time,
          endTime: item.end_time
        };
      }),
      borderColor: CHART_COLORS[index % CHART_COLORS.length],
      backgroundColor: CHART_COLORS[index % CHART_COLORS.length] + '33',
      pointStyle: 'circle',
      pointRadius: 4,
      pointHoverRadius: 6
    };
  });
  
  return { datasets };
}

// 個別タグ用のデータ処理関数
function processDataForSingleTag(rawData, tagName) {
  // 指定されたタグのデータのみをフィルタリング
  const tagData = rawData.filter(item => item.tag_name === tagName);
  
  // データが存在する場合の処理
  if (tagData.length > 0) {
    tagData.sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
    
    return {
      datasets: [{
        label: tagName,
        data: tagData.map(item => {
          // APIレスポンスはUTC形式なのでそのまま使用（Chart.jsがタイムゾーン変換）
          const utcStartTime = new Date(item.start_time + 'Z');
          return {
            x: utcStartTime,
            y: item.count,
            startTime: item.start_time,
            endTime: item.end_time
          };
        }),
        borderColor: CHART_COLORS[0], // 個別グラフなので最初の色を使用
        backgroundColor: CHART_COLORS[0] + '33',
        pointStyle: 'circle',
        pointRadius: 4,
        pointHoverRadius: 6
      }]
    };
  }
  
  // データが存在しない場合は空のデータセットを返す
  return {
    datasets: [{
      label: tagName,
      data: [],
      borderColor: CHART_COLORS[0],
      backgroundColor: CHART_COLORS[0] + '33',
      pointStyle: 'circle',
      pointRadius: 4,
      pointHoverRadius: 6
    }]
  };
}

// Count-based color function
function getCountBasedColor(count, granularity) {
  let thresholds;
  
  switch (granularity) {
    case 'MINUTE':
      thresholds = { low: 2, medium: 5 }; // 1-2: 青, 3-5: 黄, 6+: 赤
      break;
    case 'HOUR':
      thresholds = { low: 3, medium: 7 }; // 1-3: 青, 4-7: 黄, 8+: 赤
      break;
    case 'DAY':
      thresholds = { low: 5, medium: 10 }; // 1-5: 青, 6-10: 黄, 11+: 赤
      break;
    default:
      thresholds = { low: 2, medium: 5 };
  }
  
  if (count <= thresholds.low) {
    return 'rgb(54, 162, 235)'; // 青
  } else if (count <= thresholds.medium) {
    return 'rgb(255, 205, 86)'; // 黄色
  } else {
    return 'rgb(255, 99, 132)'; // 赤
  }
}

function processDataForBarChart(rawData, granularity = 'MINUTE', selectedTags = []) {
  // 選択されたタグをベースに行を作成（データがないタグも表示）
  const allTags = selectedTags.length > 0 ? selectedTags.sort() : [...new Set(rawData.map(item => item.tag_name))].sort();
  
  // 各データポイントを個別のdatasetとして作成
  const datasets = [];
  
  // 実際のデータに基づくデータセットを作成
  rawData.forEach((item, index) => {
    // APIレスポンスはUTC形式なのでそのまま使用（Chart.jsがタイムゾーン変換）
    const startTime = new Date(item.start_time + 'Z');
    const endTime = new Date(item.end_time + 'Z');
    
    // 各タグに対応するデータ配列を作成（該当タグの位置のみ時間範囲、他はnull）
    const data = allTags.map(tag => {
      if (tag === item.tag_name) {
        return [startTime, endTime];
      }
      return null;
    });
    
    // カウントに基づく色を取得
    const backgroundColor = getCountBasedColor(item.count, granularity);
    
    datasets.push({
      label: '', // 解説不要のため空文字
      data: data,
      backgroundColor: backgroundColor,
      borderColor: backgroundColor,
      borderWidth: 1,
      // 追加データ（クリック時に使用）
      rawData: {
        tagName: item.tag_name,
        startTime: item.start_time,
        endTime: item.end_time,
        count: item.count,
        timeKey: item.time_key
      }
    });
  });
  
  // ダミーデータセットは不要
  // Chart.jsはlabels配列があればY軸のタグ名を表示し、
  // datasets配列が空でもグラフの基本構造は保持される
  
  return { 
    labels: allTags, 
    datasets: datasets 
  };
}

// Main Component
const Insight = () => {
  const { t } = useTranslation(['pages', 'common']);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const navigate = useNavigate();
  
  // State management
  const [searchOptions, setSearchOptions] = useState({ places: [], cameras: [] });
  const [selectedPlace, setSelectedPlace] = useState('');
  const [selectedCamera, setSelectedCamera] = useState('');
  const [granularity, setGranularity] = useState('MINUTE');
  const [availableTags, setAvailableTags] = useState([]);
  const [selectedTags, setSelectedTags] = useState([]);
  const [timeseriesData, setTimeseriesData] = useState([]);
  const [detailLogs, setDetailLogs] = useState([]);
  const [selectedDataPoint, setSelectedDataPoint] = useState(null);
  const [activeTab, setActiveTab] = useState(0);
  const [timeRange, setTimeRange] = useState({ startTime: null, endTime: null });
  
  // Detail panel collapse state
  const [isDetailPanelCollapsed, setIsDetailPanelCollapsed] = useState(true);
  
  // Loading states
  const [isLoadingOptions, setIsLoadingOptions] = useState(true);
  const [isLoadingTags, setIsLoadingTags] = useState(false);
  const [isLoadingTimeseries, setIsLoadingTimeseries] = useState(false);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  
  // Error state
  const [error, setError] = useState(null);

  // 時間範囲計算関数（ユーザー設定のタイムゾーンに基づく）
  const calculateTimeRange = useCallback((granularity, baseTime = new Date()) => {
    // 現在のユーザータイムゾーンでの現在時刻を基準に計算
    const timezone = getCurrentTimezone();
    const now = baseTime;
    
    // ユーザータイムゾーンでの日時コンポーネントを取得
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false
    });
    
    const parts = formatter.formatToParts(now);
    const dateValues = {};
    parts.forEach(part => {
      if (part.type !== 'literal') {
        dateValues[part.type] = parseInt(part.value);
      }
    });
    
    let startTime, endTime;
    
    switch (granularity) {
      case 'MINUTE':
        // 3時間前から現在まで（ユーザータイムゾーン）
        startTime = new Date(now.getTime() - 3 * 60 * 60 * 1000);
        endTime = now;
        break;
      case 'HOUR':
        // 今日の0時から23:59まで（ユーザータイムゾーン）
        // ユーザータイムゾーンでの今日の開始・終了を計算
        const todayStart = new Date(Date.UTC(
          dateValues.year,
          dateValues.month - 1,
          dateValues.day,
          0, 0, 0, 0
        ));
        const todayEnd = new Date(Date.UTC(
          dateValues.year,
          dateValues.month - 1,
          dateValues.day,
          23, 59, 59, 999
        ));
        
        // タイムゾーンオフセットを計算
        const startOffset = getTimezoneOffsetMinutes(timezone, todayStart);
        const endOffset = getTimezoneOffsetMinutes(timezone, todayEnd);
        
        startTime = new Date(todayStart.getTime() - startOffset * 60 * 1000);
        endTime = new Date(todayEnd.getTime() - endOffset * 60 * 1000);
        break;
      case 'DAY':
        // 2週間前から今日まで（ユーザータイムゾーン）
        const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
        const twoWeeksAgoStart = new Date(Date.UTC(
          dateValues.year,
          dateValues.month - 1,
          dateValues.day - 14,
          0, 0, 0, 0
        ));
        const todayEndDay = new Date(Date.UTC(
          dateValues.year,
          dateValues.month - 1,
          dateValues.day,
          23, 59, 59, 999
        ));
        
        const startOffsetDay = getTimezoneOffsetMinutes(timezone, twoWeeksAgoStart);
        const endOffsetDay = getTimezoneOffsetMinutes(timezone, todayEndDay);
        
        startTime = new Date(twoWeeksAgoStart.getTime() - startOffsetDay * 60 * 1000);
        endTime = new Date(todayEndDay.getTime() - endOffsetDay * 60 * 1000);
        break;
      default:
        startTime = new Date(now.getTime() - 3 * 60 * 60 * 1000);
        endTime = now;
    }
    
    return { startTime, endTime };
  }, []);
  
  // タイムゾーンオフセット計算ヘルパー関数
  const getTimezoneOffsetMinutes = (timezone, date) => {
    try {
      const tzString = date.toLocaleString('en-US', { timeZone: timezone });
      const tzDate = new Date(tzString);
      const utcString = date.toLocaleString('en-US', { timeZone: 'UTC' });
      const utcDate = new Date(utcString);
      return (tzDate - utcDate) / (1000 * 60);
    } catch (error) {
      console.error('Error getting timezone offset:', error);
      return 0;
    }
  };

  // 時間範囲移動関数
  const moveTimeRange = useCallback((direction) => {
    if (!timeRange.startTime || !timeRange.endTime) return;

    const currentStart = new Date(timeRange.startTime);
    const currentEnd = new Date(timeRange.endTime);
    let offset = 0;

    switch (granularity) {
      case 'MINUTE':
        offset = 3 * 60 * 60 * 1000; // 3時間
        break;
      case 'HOUR':
        offset = 24 * 60 * 60 * 1000; // 1日
        break;
      case 'DAY':
        offset = 14 * 24 * 60 * 60 * 1000; // 2週間
        break;
    }

    const multiplier = direction === 'next' ? 1 : -1;
    const newStartTime = new Date(currentStart.getTime() + (offset * multiplier));
    const newEndTime = new Date(currentEnd.getTime() + (offset * multiplier));

    setTimeRange({ startTime: newStartTime, endTime: newEndTime });
  }, [timeRange, granularity]);

  // Load initial data
  useEffect(() => {
    loadSearchOptions();
    // 初期時間範囲を設定
    const initialRange = calculateTimeRange(granularity);
    setTimeRange(initialRange);
  }, [calculateTimeRange]);

  // Granularity変更時に時間範囲を更新
  useEffect(() => {
    const newRange = calculateTimeRange(granularity);
    setTimeRange(newRange);
  }, [granularity, calculateTimeRange]);

  // Load tags when place/camera changes
  useEffect(() => {
    loadTags();
  }, [selectedPlace, selectedCamera]);

  // Load timeseries data when filters change
  useEffect(() => {
    if (selectedTags.length > 0 && timeRange.startTime && timeRange.endTime) {
      loadTimeseriesData();
    } else {
      setTimeseriesData([]);
      setSelectedDataPoint(null);
      setDetailLogs([]);
    }
  }, [selectedTags, granularity, selectedPlace, selectedCamera, timeRange]);

  const loadSearchOptions = async () => {
    try {
      setIsLoadingOptions(true);
      const data = await getSearchOptions();
      setSearchOptions(data);
    } catch (err) {
      setError(t('pages:insight.searchOptionsFailed'));
      console.error(err);
    } finally {
      setIsLoadingOptions(false);
    }
  };

  const loadTags = async () => {
    try {
      setIsLoadingTags(true);
      const data = await getDetectorTags(selectedPlace || null, selectedCamera || null); // 新しいAPIを使用
      setAvailableTags(data.tags);
      // デフォルトで全タグを選択
      setSelectedTags(data.tags);
    } catch (err) {
      setError(t('pages:insight.tagListFailed'));
      console.error(err);
    } finally {
      setIsLoadingTags(false);
    }
  };

  const loadTimeseriesData = async () => {
    try {
      setIsLoadingTimeseries(true);
      
      // ローカル時間をUTCに変換してAPI送信（API仕様変更: 全てUTC）
      const startTimeUTC = convertDateToUTC(timeRange.startTime);
      const endTimeUTC = convertDateToUTC(timeRange.endTime);
      
      console.log(`DEBUG: Sending UTC times - start: ${startTimeUTC}, end: ${endTimeUTC}`);
      
      const data = await getTimeseriesData(
        selectedTags,
        granularity,
        selectedPlace || null,
        selectedCamera || null,
        startTimeUTC,
        endTimeUTC
      );
      setTimeseriesData(data.data);
    } catch (err) {
      setError(t('pages:insight.timeseriesDataFailed'));
      console.error(err);
    } finally {
      setIsLoadingTimeseries(false);
    }
  };

  // ISO形式の時刻をYYYYMMDDHHMM形式に変換（UTCのまま）
  const convertISOToDateTime = (isoString) => {
    try {
      // UTC ISO文字列 → UTC YYYYMMDDHHmm形式（タイムゾーン変換なし）
      // 末尾に 'Z' を付けて UTC として解釈
      const utcDate = new Date(isoString.endsWith('Z') ? isoString : isoString + 'Z');
      if (isNaN(utcDate.getTime())) return null;
      
      // getUTCXXX() を使って UTC の値を取得
      const year = utcDate.getUTCFullYear();
      const month = (utcDate.getUTCMonth() + 1).toString().padStart(2, '0');
      const day = utcDate.getUTCDate().toString().padStart(2, '0');
      const hours = utcDate.getUTCHours().toString().padStart(2, '0');
      const minutes = utcDate.getUTCMinutes().toString().padStart(2, '0');
      
      return `${year}${month}${day}${hours}${minutes}`;
    } catch (error) {
      console.error('Error converting ISO string to datetime:', error);
      return null;
    }
  };

  // 詳細ログURL生成処理
  const generateDetailLogUrl = (log) => {
    console.log('=== generateDetailLogUrl DEBUG ===');
    console.log('Full log object:', log);
    
    const { camera_id, file_id, detector_id, file_type, collector_id, start_time } = log;
    
    console.log('Extracted values:', {
      camera_id,
      file_id,
      detector_id,
      file_type,
      collector_id,
      start_time
    });
    
    console.log('Check results:', {
      has_camera_id: !!camera_id,
      has_file_id: !!file_id,
      has_detector_id: !!detector_id,
      has_file_type: !!file_type,
      has_collector_id: !!collector_id,
      has_start_time: !!start_time
    });
    
    if (camera_id && file_id && detector_id && file_type && collector_id && start_time) {
      const datetime = convertISOToDateTime(start_time);
      console.log('Converted datetime:', datetime);
      
      if (datetime) {
        const params = new URLSearchParams({
          collector_id: collector_id,
          file_type: file_type,
          datetime: datetime,
          detector_id: detector_id,
          file_id: file_id
        });
        
        const deepLinkUrl = `/camera/${camera_id}?${params.toString()}`;
        console.log('✅ Generated deep link URL:', deepLinkUrl);
        
        return deepLinkUrl;
      } else {
        console.warn('❌ Failed to parse start_time, using simple navigation');
        return `/camera/${camera_id}`;
      }
    } else {
      console.warn('❌ Missing required log data, using simple navigation');
      console.warn('Missing fields:', {
        camera_id: !camera_id ? 'MISSING' : 'OK',
        file_id: !file_id ? 'MISSING' : 'OK',
        detector_id: !detector_id ? 'MISSING' : 'OK',
        file_type: !file_type ? 'MISSING' : 'OK',
        collector_id: !collector_id ? 'MISSING' : 'OK',
        start_time: !start_time ? 'MISSING' : 'OK'
      });
      if (log.camera_id) {
        return `/camera/${log.camera_id}`;
      }
      return '#'; // fallback
    }
  };

  const handleDataPointClick = async (dataPoint) => {
    setSelectedDataPoint(dataPoint);
    
    // 詳細ログ取得時に自動展開
    if (isDetailPanelCollapsed) {
      setIsDetailPanelCollapsed(false);
    }
    
    try {
      setIsLoadingDetails(true);
      
      // dataPoint.startTime と dataPoint.endTime は既にUTC形式の文字列（API仕様変更）
      // そのまま送信
      const startTimeUTC = dataPoint.startTime;
      const endTimeUTC = dataPoint.endTime;
      
      console.log(`DEBUG: Sending UTC times - start: ${startTimeUTC}, end: ${endTimeUTC}`);
      
      const data = await getTimeseriesDetailLogs(
        startTimeUTC,
        endTimeUTC,
        dataPoint.tagName,
        selectedPlace || null,
        selectedCamera || null
      );
      setDetailLogs(data.logs);
    } catch (err) {
      setError(t('pages:insight.detailLogFailed'));
      console.error(err);
    } finally {
      setIsLoadingDetails(false);
    }
  };

  if (isLoadingOptions) {
    return (
      <PageLayout>
        <TitleArea title={t('pages:insight.title')} leftContent={<Insights sx={{ ml: 1 }} />} />
        <Box
          sx={{
            marginTop: `${HEADER_HEIGHT + TITLE_AREA_HEIGHT}px`,
            overflow: 'auto',
            height: `calc(100vh - ${HEADER_HEIGHT + TITLE_AREA_HEIGHT}px)`,
          }}
        >
          <Container maxWidth={false} sx={{ py: 3, maxWidth: "2000px", mx: "auto" }}>
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 300 }}>
              <CircularProgress />
            </Box>
          </Container>
        </Box>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <TitleArea title={t('pages:insight.title')} leftContent={<Insights sx={{ ml: 1 }} />} />
      <Box
        sx={{
          marginTop: `${HEADER_HEIGHT + TITLE_AREA_HEIGHT}px`,
          overflow: 'auto',
          height: `calc(100vh - ${HEADER_HEIGHT + TITLE_AREA_HEIGHT}px)`,
        }}
      >
        <Container maxWidth={false} sx={{ py: 3, maxWidth: "2000px", mx: "auto" }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        
        <Grid container spacing={3}>
          {/* Left Panel - Filters */}
          <Grid item xs={12} md={3}>
            <FilterPanel
              searchOptions={searchOptions}
              selectedPlace={selectedPlace}
              setSelectedPlace={setSelectedPlace}
              selectedCamera={selectedCamera}
              setSelectedCamera={setSelectedCamera}
              granularity={granularity}
              setGranularity={setGranularity}
              availableTags={availableTags}
              selectedTags={selectedTags}
              setSelectedTags={setSelectedTags}
              isLoading={isLoadingTags}
              timeRange={timeRange}
              moveTimeRange={moveTimeRange}
              t={t}
            />
          </Grid>
          
          {/* Center Panel - Charts */}
          <Grid item xs={12} md={isDetailPanelCollapsed ? 9 : 6}>
            <Paper sx={{ p: 3, position: 'relative' }}>
              {/* 折りたたみボタン */}
              <Box sx={{ position: 'absolute', top: 16, right: 16, zIndex: 1 }}>
                <Tooltip title={isDetailPanelCollapsed ? t('pages:insight.showDetailLog') : t('pages:insight.hideDetailLog')}>
                  <IconButton
                    onClick={() => setIsDetailPanelCollapsed(!isDetailPanelCollapsed)}
                    size="small"
                    sx={{ 
                      backgroundColor: 'background.paper',
                      boxShadow: 1,
                      '&:hover': {
                        boxShadow: 2
                      }
                    }}
                  >
                    {isDetailPanelCollapsed ? <ChevronLeft /> : <ChevronRight />}
                  </IconButton>
                </Tooltip>
              </Box>
              
              <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
                <Tabs value={activeTab} onChange={(e, newValue) => setActiveTab(newValue)}>
                  <Tab label={t('pages:insight.lineChart')} icon={<Timeline />} />
                  <Tab label={t('pages:insight.barChart')} icon={<BarChart />} />
                </Tabs>
              </Box>
              
              {isLoadingTimeseries ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 400 }}>
                  <CircularProgress />
                </Box>
              ) : selectedTags.length === 0 ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 400 }}>
                  <Typography variant="body1" color="text.secondary">
                    {t('pages:insight.selectTagsToView')}
                  </Typography>
                </Box>
              ) : (
                <>
                  {activeTab === 0 && (
                    <MultipleTagLineCharts 
                      data={timeseriesData} 
                      selectedTags={selectedTags}
                      onDataPointClick={handleDataPointClick}
                      granularity={granularity}
                      timeRange={timeRange}
                      t={t}
                    />
                  )}
                  {activeTab === 1 && (
                    <HorizontalBarChartComponent 
                      data={timeseriesData} 
                      onDataPointClick={handleDataPointClick}
                      granularity={granularity}
                      selectedTags={selectedTags}
                      timeRange={timeRange}
                      t={t}
                    />
                  )}
                </>
              )}
            </Paper>
          </Grid>
          
          {/* Right Panel - Detail Logs */}
          {!isDetailPanelCollapsed && (
            <Grid item xs={12} md={3}>
              <DetailPanel
                detailLogs={detailLogs}
                isLoading={isLoadingDetails}
                selectedDataPoint={selectedDataPoint}
                generateDetailLogUrl={generateDetailLogUrl}
                t={t}
              />
            </Grid>
          )}
        </Grid>
        </Container>
      </Box>
    </PageLayout>
  );
};

export default Insight; 