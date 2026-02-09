import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Typography, Box, CircularProgress, Paper, Button, Alert, ToggleButton, ToggleButtonGroup, FormControl, InputLabel, Select, MenuItem, IconButton, Drawer } from '@mui/material';
import { ArrowBack, ChevronLeft, ChevronRight, Refresh } from '@mui/icons-material';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import VideoPlayer from '../components/VideoPlayer';
import VSaaSPlayer from '../components/VSaaSPlayer';
import HlsPlayer from '../components/HlsPlayer';
import ImageViewer from '../components/ImageViewer';
import Timeline from '../components/Timeline';
import DateSelector from '../components/DateSelector';
import HourSelector from '../components/HourSelector';
import DetectResultViewer from '../components/DetectResultViewer';
import BookmarkButton from '../components/BookmarkButton';
import { getCamera, hlsRecUrl, getFilesByDateTime, getFilesSummaryByHour, downloadFile, getCameraCollectors, getCameraDetectors, getFileDetectLogs, updateDetectLogNotify } from '../services/api';
import { useTheme } from '@mui/material/styles';
import { HEADER_HEIGHT, TITLE_AREA_HEIGHT, SIDEBAR_WIDTH } from '../constants/layout';
import { convertLocalToUTCForAPI, formatUTCWithTimezone, getCurrentTimezone } from '../utils/timezone';
import { 
  getCurrentDateString,
  getCurrentHourNumber,
  getCurrentTimeString,
  extractMonthAndDay
} from '../utils/dateFormat';
import { useTranslation } from 'react-i18next';

const CameraView = () => {
  const { t, i18n } = useTranslation(['pages', 'common']);
  const { cameraId } = useParams();
  const [searchParams] = useSearchParams();
  
  // URL parameters for direct navigation - now dynamic using useMemo
  const urlParams = useMemo(() => {
    return {
      collector_id: searchParams.get('collector_id'),
      file_type: searchParams.get('file_type'),
      datetime: searchParams.get('datetime'),
      detector_id: searchParams.get('detector_id'),
      file_id: searchParams.get('file_id'),
    };
  }, [searchParams]);
  
  // Check if URL parameters indicate direct navigation
  const hasDirectNavParams = useMemo(() => urlParams.file_type && urlParams.datetime, [urlParams.file_type, urlParams.datetime]);
  
  // Parse datetime string (YYYYMMDDHHMM) to date and hour
  // datetime は UTC として解釈し、ユーザータイムゾーンでの表示用の値も返す
  const parseDateTimeString = (datetime) => {
    if (!datetime || datetime.length < 12) return null;
    
    try {
      const year = parseInt(datetime.substring(0, 4));
      const month = parseInt(datetime.substring(4, 6));
      const day = parseInt(datetime.substring(6, 8));
      const hour = parseInt(datetime.substring(8, 10));
      const minute = parseInt(datetime.substring(10, 12));
      
      console.log('=== parseDateTimeString DEBUG ===');
      console.log('Input datetime:', datetime);
      console.log('Parsed UTC components:', { year, month, day, hour, minute });
      
      // UTC として Date オブジェクトを作成
      const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
      
      if (isNaN(utcDate.getTime())) {
        console.error('Invalid UTC date');
        return null;
      }
      
      // ユーザータイムゾーンでの表示用の値を直接 Intl.DateTimeFormat で取得
      const timezone = getCurrentTimezone();
      const formatter = new Intl.DateTimeFormat('ja-JP', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
      
      const parts = formatter.formatToParts(utcDate);
      const values = {};
      parts.forEach(part => {
        if (part.type !== 'literal') {
          values[part.type] = part.value;
        }
      });
      
      // 表示用の値を生成
      const fullDateString = `${values.year}-${values.month}-${values.day}`;
      const dateString = `${values.month}/${values.day}`;
      const timeString = `${values.hour}:${values.minute}:${values.second}`;
      const displayHour = parseInt(values.hour);
      
      console.log('UTC Date:', utcDate.toISOString());
      console.log('Display values (user timezone):', {
        dateString,
        fullDateString,
        timeString,
        displayHour
      });
      console.log('UTC values (for API):', {
        utcYear: year.toString(),
        utcMonth: month.toString().padStart(2, '0'),
        utcDay: day.toString().padStart(2, '0'),
        utcHour: hour.toString().padStart(2, '0'),
        utcMinute: minute.toString().padStart(2, '0')
      });
      
      return {
        fullDateTime: utcDate,
        dateString: dateString,  // MM/DD (ユーザータイムゾーン)
        fullDateString: fullDateString,  // YYYY-MM-DD (ユーザータイムゾーン)
        displayHour: displayHour,  // ユーザータイムゾーンの hour (数値)
        displayTimeString: timeString,  // HH:mm:ss (ユーザータイムゾーン)
        // UTC の値（API送信用）
        utcYear: year.toString(),
        utcMonth: month.toString().padStart(2, '0'),
        utcDay: day.toString().padStart(2, '0'),
        utcHour: hour.toString().padStart(2, '0'),
        utcMinute: minute.toString().padStart(2, '0')
      };
    } catch (error) {
      console.error('Error parsing datetime string:', error);
      return null;
    }
  };
  
  const [camera, setCamera] = useState(null);
  const [hlsUrl, setHlsUrl] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [videoSegments, setVideoSegments] = useState([]);
  const [currentSegment, setCurrentSegment] = useState(null);
  const [videoTimeInfo, setVideoTimeInfo] = useState(null);
  const [viewMode, setViewMode] = useState('live');
  const [isInitialized, setIsInitialized] = useState(false);
  const [videoPlayer, setVideoPlayer] = useState(null);
  const [hlsPlayer, setHlsPlayer] = useState(null);
  
  // Track if this is the initial URL parameter based navigation
  const [hasProcessedURLParams, setHasProcessedURLParams] = useState(false);
  
  // Image-specific state
  const [imageSegments, setImageSegments] = useState([]);
  const [currentImage, setCurrentImage] = useState(null);
  
  // Timeline summary state
  const [timelineSummary, setTimelineSummary] = useState([]);
  
  // Collector information
  const [collectors, setCollectors] = useState({ video: [], image: [] });
  const [selectedCollectorId, setSelectedCollectorId] = useState('');
  const [collectorError, setCollectorError] = useState('');
  
  // Detector information
  const [detectors, setDetectors] = useState([]);
  const [selectedDetector, setSelectedDetector] = useState('bedrock');
  const [selectedDetectorId, setSelectedDetectorId] = useState('');
  const [detectorError, setDetectorError] = useState('');
  
  // Detection logs
  const [detectLogs, setDetectLogs] = useState([]);
  const [detectLoading, setDetectLoading] = useState(false);
  
  // Tab switching state
  const [shouldAutoSelectOnSwitch, setShouldAutoSelectOnSwitch] = useState(false);
  const [preservedTimeOnSwitch, setPreservedTimeOnSwitch] = useState(null);
  
  // Right sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(false);
  
  // Detect image toggle state (for hlsYolo collector)
  const [showDetectImage, setShowDetectImage] = useState(false);
  
  // Control area and thumbnail area height for layout calculation
  const [controlAreaHeight, setControlAreaHeight] = useState(200); // デフォルト値を設定
  const [thumbnailAreaHeight, setThumbnailAreaHeight] = useState(0);
  const controlAreaRef = useRef(null);
  const thumbnailAreaRef = useRef(null);
  
  // Current date and time state
  const [currentDate, setCurrentDate] = useState(() => {
    return getCurrentDateString(i18n.language, getCurrentTimezone());
  });
  
  const [currentHour, setCurrentHour] = useState(() => {
    return getCurrentHourNumber(i18n.language, getCurrentTimezone());
  });
  
  const [currentTime, setCurrentTime] = useState(() => {
    return getCurrentTimeString(i18n.language, getCurrentTimezone());
  });
  
  const theme = useTheme();
  
  // 検出画像切り替え用の表示用セグメント
  const displayImageSegments = useMemo(() => {
    if (!showDetectImage) return imageSegments;
    return imageSegments.map(segment => ({
      ...segment,
      presigned_url: segment.presigned_url_detect || segment.presigned_url
    }));
  }, [imageSegments, showDetectImage]);
  
  // 検出画像切り替え用の表示用currentImage
  const displayCurrentImage = useMemo(() => {
    if (!currentImage || !showDetectImage) return currentImage;
    return {
      ...currentImage,
      presigned_url: currentImage.presigned_url_detect || currentImage.presigned_url
    };
  }, [currentImage, showDetectImage]);

  // 選択中のコレクター情報を取得
  const selectedCollector = useMemo(() => {
    const available = viewMode === 'video' ? collectors.video : collectors.image;
    return available?.find(c => c.collector_id === selectedCollectorId) || null;
  }, [collectors, viewMode, selectedCollectorId]);

  // ポリゴン表示条件: 画像タブ + hlsYolo + area_detect + 検出画像表示時
  const detectAreaForDisplay = useMemo(() => {
    if (viewMode !== 'image') return null;
    if (!showDetectImage) return null;  // 検出画像表示時のみ
    if (selectedCollector?.collector !== 'hlsYolo') return null;
    if (selectedCollector?.track_eventtype !== 'area_detect') return null;
    return selectedCollector?.detect_area || null;
  }, [viewMode, showDetectImage, selectedCollector]);
  
  // タイムゾーンまたはロケールが変更された時に現在の日付と時刻を更新
  useEffect(() => {
    const handleChange = () => {
      const timezone = getCurrentTimezone();
      const language = i18n.language;
      
      // 日付・時刻を更新
      setCurrentDate(getCurrentDateString(language, timezone));
      setCurrentHour(getCurrentHourNumber(language, timezone));
      setCurrentTime(getCurrentTimeString(language, timezone));
    };
    
    // タイムゾーン変更イベントをリッスン
    window.addEventListener('timezoneChanged', handleChange);
    // ロケール変更イベントもリッスン（i18n.language変更時に自動発火）
    window.addEventListener('localeChanged', handleChange);
    
    return () => {
      window.removeEventListener('timezoneChanged', handleChange);
      window.removeEventListener('localeChanged', handleChange);
    };
  }, [i18n.language]);
  
  // Update control area height when layout changes
  useEffect(() => {
    const updateHeight = () => {
      if (controlAreaRef.current) {
        const height = controlAreaRef.current.offsetHeight;
        setControlAreaHeight(height);
      }
    };
    
    updateHeight();
    // 少し遅延させて再計算（レンダリング完了後）
    const timer = setTimeout(updateHeight, 100);
    
    return () => clearTimeout(timer);
  }, [viewMode, currentDate, currentHour, timelineSummary]);
  
  // Update thumbnail area height when images change
  useEffect(() => {
    if (thumbnailAreaRef.current) {
      const height = thumbnailAreaRef.current.offsetHeight;
      setThumbnailAreaHeight(height);
    } else {
      setThumbnailAreaHeight(0);
    }
  }, [viewMode, imageSegments]);
  
  // Auto-open sidebar when has_detect is true
  useEffect(() => {
    const currentFile = viewMode === 'video' ? currentSegment : currentImage;
    
    if (currentFile?.has_detect && selectedDetector !== 'none') {
      setSidebarOpen(true);
    }
  }, [currentSegment, currentImage, viewMode, selectedDetector]);
  
  // Set initial view mode and date/time based on URL parameters
  useEffect(() => {
    console.log('=== Set Initial URL Parameters DEBUG ===');
    console.log('hasDirectNavParams:', hasDirectNavParams);
    console.log('hasProcessedURLParams:', hasProcessedURLParams);
    console.log('urlParams.datetime:', urlParams.datetime);
    
    if (hasDirectNavParams && !hasProcessedURLParams) {
      console.log('Processing initial URL parameters...');
      
      if (urlParams.file_type === 'video' || urlParams.file_type === 'image') {
        console.log('Setting viewMode to:', urlParams.file_type);
        setViewMode(urlParams.file_type);
      }
      
      if (urlParams.datetime) {
        const parsed = parseDateTimeString(urlParams.datetime);
        console.log('parseDateTimeString result:', parsed);
        if (parsed) {
          console.log('Setting state:', {
            currentDate: parsed.fullDateString,
            currentHour: parsed.displayHour,
            currentTime: parsed.displayTimeString
          });
          setCurrentDate(parsed.fullDateString);  // ユーザータイムゾーンの日付 (YYYY-MM-DD)
          setCurrentHour(parsed.displayHour);  // ユーザータイムゾーンの hour
          setCurrentTime(parsed.displayTimeString);  // ユーザータイムゾーンの時刻
        }
      }
    } else {
      console.log('Skipped: hasDirectNavParams or hasProcessedURLParams condition not met');
    }
  }, [hasDirectNavParams, urlParams.file_type, urlParams.datetime, hasProcessedURLParams]);
  
  // Handle URL parameter changes
  useEffect(() => {
    if (hasDirectNavParams) {
      console.log('URL parameters changed, resetting processed flag for new direct navigation');
      setHasProcessedURLParams(false);
    }
  }, [urlParams.collector_id, urlParams.file_type, urlParams.datetime, urlParams.detector_id, urlParams.file_id, hasDirectNavParams]);
  
  // Fetch camera details, HLS URL, and collector information
  useEffect(() => {
    let isMounted = true;
    const fetchCameraData = async () => {
      if (isInitialized) return;
      
      try {
        console.log('Fetching camera data from API...');
        const cameraData = await getCamera(cameraId);
        if (!isMounted) return;
        
        setCamera(cameraData);
        
        if (cameraData.type === 's3' && viewMode === 'live') {
          setViewMode('image');
        }
        
        if (cameraData.type === 'kinesis') {
          try {
            const hlsUrlData = await hlsRecUrl(cameraId);
            if (!isMounted) return;
            setHlsUrl(hlsUrlData.url);
          } catch (hlsError) {
            console.error('Error fetching HLS URL:', hlsError);
            setHlsUrl('');
          }
        } else if (cameraData.type === 'vsaas') {
          setHlsUrl('');
        }
        
        try {
          const collectorsData = await getCameraCollectors(cameraId);
          if (!isMounted) return;
          
          const videoCollectors = [];
          const imageCollectors = [];
          if (Array.isArray(collectorsData)) {
            collectorsData.forEach(c => {
              if (c.collector_mode === 'video') videoCollectors.push(c);
              if (c.collector_mode === 'image') imageCollectors.push(c);
              if (c.collector_mode === 'image_and_video') {
                videoCollectors.push(c);
                imageCollectors.push(c);
              }
            });
          }
          setCollectors({ video: videoCollectors, image: imageCollectors });
        } catch (collectorsError) {
          console.error('Error fetching camera collectors:', collectorsError);
          setCollectors({ video: [], image: [] });
        }
        
        setLoading(false);
        setIsInitialized(true);
      } catch (err) {
        console.error('Error fetching camera data:', err);
        if (!isMounted) return;
        setError('カメラデータの取得に失敗しました。');
        setLoading(false);
      }
    };
    
    fetchCameraData();
    
    return () => {
      isMounted = false;
    };
  }, [cameraId, isInitialized]);

  // Set default collector when view mode changes
  useEffect(() => {
    const available = getAvailableCollectors();
    if (available.length > 0) {
      // IDでマッチング
      if (urlParams.collector_id && available.some(c => c.collector_id === urlParams.collector_id)) {
        const collector = available.find(c => c.collector_id === urlParams.collector_id);
        if (collector && selectedCollectorId !== collector.collector_id) {
          setSelectedCollectorId(collector.collector_id);
        }
      }
      // デフォルト: 最初のコレクターを選択
      else if (!selectedCollectorId || !available.some(c => c.collector_id === selectedCollectorId)) {
        setSelectedCollectorId(available[0].collector_id);
      }
    }
    // eslint-disable-next-line
  }, [collectors, viewMode, urlParams.collector_id, hasProcessedURLParams]);
  
  // Set default detector when view mode changes
  useEffect(() => {
    const available = getAvailableDetectors();
    if (available.length > 0) {
      // IDでマッチング
      if (urlParams.detector_id) {
        const matchingDetector = available.find(d => d.id === urlParams.detector_id && d.id !== 'none');
        if (matchingDetector) {
          setSelectedDetector(matchingDetector.name);
          setSelectedDetectorId(matchingDetector.id);
          return;
        }
      }
      
      // デフォルト: bedrockを選択
      const bedrockDetector = available.find(d => d.name === 'bedrock' && d.id !== 'none');
      if (bedrockDetector) {
        setSelectedDetector(bedrockDetector.name);
        setSelectedDetectorId(bedrockDetector.id);
      } else {
        setSelectedDetector('none');
        setSelectedDetectorId('');
      }
    }
    // eslint-disable-next-line
  }, [detectors, urlParams.detector_id, hasProcessedURLParams]);
  
  // Fetch detectors when collector, view mode, or camera changes
  useEffect(() => {
    let isMounted = true;
    const fetchDetectors = async () => {
      if (!isInitialized || viewMode === 'live' || !selectedCollectorId || !cameraId) {
        setDetectors([]);
        setDetectorError('');
        return;
      }
      
      try {
        const detectorsData = await getCameraDetectors(cameraId, selectedCollectorId, viewMode);
        if (!isMounted) return;
        
        setDetectors(detectorsData.detectors || []);
        setDetectorError('');
        
        // URLパラメータに detector_id がある場合、それを優先
        if (urlParams.detector_id && hasDirectNavParams) {
          const matchingDetector = (detectorsData.detectors || [])
            .find(d => d.detector_id === urlParams.detector_id);
          if (matchingDetector) {
            setSelectedDetector(matchingDetector.detector);
            setSelectedDetectorId(matchingDetector.detector_id);
            return;
          }
        }
        
        // URLパラメータがない場合、bedrockをデフォルトとして選択
        const bedrockDetector = (detectorsData.detectors || []).find(d => d.detector === 'bedrock');
        if (bedrockDetector) {
          setSelectedDetector('bedrock');
          setSelectedDetectorId(bedrockDetector.detector_id);
        } else {
          setSelectedDetector('none');
          setSelectedDetectorId('');
        }
        // setDetectLogs([]) を削除 - fetchDetectLogs が自動的に更新するため不要
      } catch (err) {
        console.error('Error fetching detectors:', err);
        if (!isMounted) return;
        setDetectors([]);
        setDetectorError(t('pages:cameraView.detectorFetchFailed'));
      }
    };
    
    fetchDetectors();
    
    return () => {
      isMounted = false;
    };
  }, [isInitialized, selectedCollectorId, viewMode, cameraId, urlParams.detector_id, hasDirectNavParams]);
  
  // Fetch detection logs when detector or current file changes
  useEffect(() => {
    let isMounted = true;
    const fetchDetectLogs = async () => {
      if (selectedDetector === 'none' || !selectedDetectorId) {
        setDetectLogs([]);
        return;
      }
      
      let fileId = null;
      if (viewMode === 'video' && currentSegment && currentSegment.id) {
        fileId = currentSegment.id;
      } else if (viewMode === 'image' && currentImage && currentImage.id) {
        fileId = currentImage.id;
      }
      
      if (!fileId) {
        setDetectLogs([]);
        return;
      }
      
      try {
        setDetectLoading(true);
        const logsData = await getFileDetectLogs(fileId, selectedDetectorId);
        if (!isMounted) return;
        
        setDetectLogs(logsData.logs || []);
      } catch (err) {
        console.error('Error fetching detection logs:', err);
        if (!isMounted) return;
        setDetectLogs([]);
      } finally {
        if (isMounted) {
          setDetectLoading(false);
        }
      }
    };
    
    fetchDetectLogs();
    
    return () => {
      isMounted = false;
    };
  }, [selectedDetector, selectedDetectorId, currentSegment, currentImage, viewMode, hasProcessedURLParams]);
  
  // URL parameter-based direct navigation
  useEffect(() => {
    let isMounted = true;
    const handleDirectNavigation = async () => {
      if (!hasDirectNavParams || !isInitialized || !selectedCollectorId || hasProcessedURLParams) return;
      
      const available = getAvailableCollectors();
      const urlCollector = available.find(c => c.collector_id === urlParams.collector_id);
      if (!urlCollector || selectedCollectorId !== urlCollector.collector_id) return;
      
      try {
        const parsed = parseDateTimeString(urlParams.datetime);
        if (!parsed) {
          if (isMounted) {
            setHasProcessedURLParams(true);
          }
          return;
        }
        
        // datetime は既に UTC なので、そのまま使用（タイムゾーン変換不要）
        const dateTimePrefix = `${parsed.utcYear}${parsed.utcMonth}${parsed.utcDay}${parsed.utcHour}`;
        const fileType = urlParams.file_type === 'video' ? 'video' : 'image';
        
        try {
          const summaryData = await getFilesSummaryByHour(cameraId, dateTimePrefix, selectedCollectorId, fileType, true, selectedDetector !== 'none' ? selectedDetectorId : null);
          if (isMounted) {
            setTimelineSummary(summaryData.summary || []);
          }
        } catch (summaryErr) {
          console.error('Error fetching timeline summary:', summaryErr);
          if (isMounted) {
            setTimelineSummary([]);
          }
        }
        
        if (urlParams.file_type === 'video') {
          const filesData = await getFilesByDateTime(cameraId, dateTimePrefix, selectedCollectorId, 'video', true, true, selectedDetector !== 'none' ? selectedDetectorId : null);
          if (!isMounted) return;
          
          const segments = filesData.files.map(file => ({
            id: file.file_id,
            startTime: file.start_time,
            endTime: file.end_time,
            url: file.s3path,
            presigned_url: file.presigned_url,
            url_detect: file.s3path_detect,
            presigned_url_detect: file.presigned_url_detect,
            has_detect: file.has_detect || false
          }));
          
          setVideoSegments(segments);
          
          console.log('=== Direct Navigation Video Debug ===');
          console.log('Segments count:', segments.length);
          console.log('urlParams.file_id:', urlParams.file_id);
          console.log('parsed.fullDateTime:', parsed.fullDateTime);
          
          let targetSegment = null;
          if (urlParams.file_id) {
            targetSegment = segments.find(segment => segment.id === urlParams.file_id);
            console.log('Found by file_id:', targetSegment?.id);
          }
          
          if (!targetSegment) {
            const targetTime = parsed.fullDateTime;
            targetSegment = segments.find(segment => {
              if (!segment.startTime || !segment.endTime) return false;
              // UTC として正しく解釈するため、Z を付ける
              const startTime = new Date(segment.startTime.endsWith('Z') ? segment.startTime : segment.startTime + 'Z');
              const endTime = new Date(segment.endTime.endsWith('Z') ? segment.endTime : segment.endTime + 'Z');
              const matches = targetTime >= startTime && targetTime <= endTime;
              console.log(`Checking segment ${segment.id}: ${startTime.toISOString()} - ${endTime.toISOString()}, targetTime: ${targetTime.toISOString()}, matches: ${matches}`);
              return matches;
            });
            console.log('Found by time:', targetSegment?.id);
          }
          
          if (!targetSegment && segments.length > 0) {
            targetSegment = segments[0];
            console.log('Using first segment:', targetSegment.id);
          }
          
          console.log('Final targetSegment:', targetSegment?.id, typeof targetSegment?.id);
          
          if (targetSegment) {
            await playSegment(targetSegment);
            console.log('playSegment called with:', targetSegment.id);
          }
        } else if (urlParams.file_type === 'image') {
          // datetime は既に UTC なので、そのまま使用（分付き）
          const imageDateTimePrefix = `${parsed.utcYear}${parsed.utcMonth}${parsed.utcDay}${parsed.utcHour}${parsed.utcMinute}`;
          
          const filesData = await getFilesByDateTime(cameraId, imageDateTimePrefix, selectedCollectorId, 'image', true, true, selectedDetector !== 'none' ? selectedDetectorId : null);
          if (!isMounted) return;
          
          const segments = filesData.files.map(file => ({
            id: file.file_id,
            startTime: file.start_time,
            endTime: file.end_time,
            url: file.s3path,
            presigned_url: file.presigned_url,
            url_detect: file.s3path_detect,
            presigned_url_detect: file.presigned_url_detect,
            has_detect: file.has_detect || false
          }));
          
          setImageSegments(segments);
          
          console.log('=== Direct Navigation Image Debug ===');
          console.log('Segments count:', segments.length);
          console.log('urlParams.file_id:', urlParams.file_id);
          console.log('parsed.fullDateTime:', parsed.fullDateTime);
          
          let targetImage = null;
          if (urlParams.file_id) {
            targetImage = segments.find(segment => segment.id === urlParams.file_id);
            console.log('Found by file_id:', targetImage?.id);
          }
          
          if (!targetImage) {
            const targetTime = parsed.fullDateTime;
            targetImage = segments.find(segment => {
              if (!segment.startTime) return false;
              // UTC として正しく解釈するため、Z を付ける
              const imageTime = new Date(segment.startTime.endsWith('Z') ? segment.startTime : segment.startTime + 'Z');
              const timeDiff = Math.abs(targetTime - imageTime);
              const matches = timeDiff < 60000;
              console.log(`Checking image ${segment.id}: ${imageTime.toISOString()}, targetTime: ${targetTime.toISOString()}, diff: ${timeDiff}ms, matches: ${matches}`);
              return matches;
            });
            console.log('Found by time:', targetImage?.id);
          }
          
          if (!targetImage && segments.length > 0) {
            targetImage = segments[0];
            console.log('Using first image:', targetImage.id);
          }
          
          console.log('Final targetImage:', targetImage?.id, typeof targetImage?.id);
          
          if (targetImage) {
            setCurrentImage(targetImage);
            await handleImageSelect(targetImage);
            console.log('handleImageSelect called with:', targetImage.id);
          }
        }
        
        if (isMounted) {
          setHasProcessedURLParams(true);
        }
        
      } catch (err) {
        console.error('Direct navigation error:', err);
        if (isMounted) {
          setHasProcessedURLParams(true);
        }
      }
    };
    
    handleDirectNavigation();
    
    return () => {
      isMounted = false;
    };
  }, [hasDirectNavParams, isInitialized, selectedCollectorId, urlParams.collector_id, urlParams.file_type, urlParams.datetime, urlParams.detector_id, urlParams.file_id, cameraId, hasProcessedURLParams]);
  
  // Fetch timeline summary for the current date and hour
  useEffect(() => {
    let isMounted = true;
    const fetchTimelineSummary = async () => {
      console.log('=== Fetch Timeline Summary DEBUG ===');
      console.log('currentDate:', currentDate, typeof currentDate);
      console.log('currentHour:', currentHour, typeof currentHour);
      console.log('cameraId:', cameraId);
      console.log('isInitialized:', isInitialized);
      console.log('viewMode:', viewMode);
      console.log('selectedCollectorId:', selectedCollectorId);
      
      // ✅ currentDate と currentHour の検証を追加
      if (!currentDate || !currentDate.trim()) {
        console.log('Skipping: currentDate is empty');
        return;
      }
      
      if (typeof currentHour !== 'number' || isNaN(currentHour)) {
        console.log('Skipping: currentHour is not a valid number');
        return;
      }
      
      if (!cameraId || !isInitialized || viewMode === 'live' || !selectedCollectorId) {
        console.log('Skipping: missing required parameters');
        return;
      }
      
      try {
        const extracted = extractMonthAndDay(currentDate);
        console.log('extractMonthAndDay result:', extracted);
        if (!extracted) {
          console.warn('Failed to extract month and day from currentDate:', currentDate);
          return;
        }
        
        const { month, day } = extracted;
        const year = new Date().getFullYear();
        const hour = currentHour.toString().padStart(2, '0');
        
        console.log('Date components:', { year, month, day, hour });
        
        // JST時刻をUTC時刻に変換してAPI送信用のフォーマットにする
        const dateTimePrefix = convertLocalToUTCForAPI(year, month, day, hour);
        console.log('dateTimePrefix (UTC):', dateTimePrefix);
        
        const fileType = viewMode === 'video' ? 'video' : 'image';
        
        const summaryData = await getFilesSummaryByHour(cameraId, dateTimePrefix, selectedCollectorId, fileType, true, selectedDetector !== 'none' ? selectedDetectorId : null);
        if (!isMounted) return;
        
        setTimelineSummary(summaryData.summary || []);
        console.log('Timeline summary fetched:', summaryData.summary?.length || 0, 'items');
      } catch (err) {
        console.error('Error fetching timeline summary:', err);
        if (!isMounted) return;
        setTimelineSummary([]);
      }
    };
    
    fetchTimelineSummary();
    
    return () => {
      isMounted = false;
    };
  }, [cameraId, currentDate, currentHour, isInitialized, viewMode, selectedCollectorId, selectedDetector, selectedDetectorId]);
  
  // Fetch video segments for the current date and hour
  useEffect(() => {
    let isMounted = true;
    const fetchSegments = async () => {
      console.log('=== Fetch Segments DEBUG ===');
      console.log('currentDate:', currentDate, typeof currentDate);
      console.log('currentHour:', currentHour, typeof currentHour);
      
      // ✅ currentDate と currentHour の検証を追加
      if (!currentDate || !currentDate.trim()) {
        console.log('Skipping: currentDate is empty');
        return;
      }
      
      if (typeof currentHour !== 'number' || isNaN(currentHour)) {
        console.log('Skipping: currentHour is not a valid number');
        return;
      }
      
      if (!cameraId || !isInitialized || viewMode === 'live' || !selectedCollectorId) return;
      
      if (hasDirectNavParams && !hasProcessedURLParams) {
        return;
      }
      
      setVideoSegments([]);
      setImageSegments([]);
      
      // URL直接遷移の処理中のみcurrentImageをリセット
      if (hasDirectNavParams && !hasProcessedURLParams) {
        setCurrentImage(null);
      }
      
      try {
        const extracted = extractMonthAndDay(currentDate);
        console.log('extractMonthAndDay result:', extracted);
        if (!extracted) return;
        
        const { month, day } = extracted;
        const year = new Date().getFullYear();
        const hour = currentHour.toString().padStart(2, '0');
        
        if (viewMode === 'video') {
          // JST時刻をUTC時刻に変換してAPI送信用のフォーマットにする
          const dateTimePrefix = convertLocalToUTCForAPI(year, month, day, hour);
          
          const filesData = await getFilesByDateTime(cameraId, dateTimePrefix, selectedCollectorId, 'video', true, true, selectedDetector !== 'none' ? selectedDetectorId : null);
          if (!isMounted) return;
          
          const segments = filesData.files.map(file => ({
            id: file.file_id,
            startTime: file.start_time,
            endTime: file.end_time,
            url: file.s3path,
            presigned_url: file.presigned_url,
            url_detect: file.s3path_detect,
            presigned_url_detect: file.presigned_url_detect,
            has_detect: file.has_detect || false
          }));
          
          setVideoSegments(segments);
          
          if (shouldAutoSelectOnSwitch && preservedTimeOnSwitch && segments.length > 0) {
            const targetSegment = findSegmentByTime(segments, preservedTimeOnSwitch);
            if (targetSegment) {
              await playSegment(targetSegment);
            }
            setShouldAutoSelectOnSwitch(false);
            setPreservedTimeOnSwitch(null);
          }
        } else if (viewMode === 'image') {
          let targetMinute;
          
          if (shouldAutoSelectOnSwitch && preservedTimeOnSwitch) {
            const [timeHour, timeMinute] = preservedTimeOnSwitch.split(':').map(Number);
            targetMinute = timeMinute.toString().padStart(2, '0');
          } else if (currentTime && currentTime.includes(':')) {
            const [timeHour, timeMinute] = currentTime.split(':').map(Number);
            if (timeHour === currentHour) {
              targetMinute = timeMinute.toString().padStart(2, '0');
            } else {
              targetMinute = new Date().getMinutes().toString().padStart(2, '0');
            }
          } else {
            targetMinute = new Date().getMinutes().toString().padStart(2, '0');
          }
          
          // JST時刻をUTC時刻に変換してAPI送信用のフォーマットにする（分付き）
          const dateTimePrefix = convertLocalToUTCForAPI(year, month, day, hour, targetMinute);
          
          const filesData = await getFilesByDateTime(cameraId, dateTimePrefix, selectedCollectorId, 'image', true, true, selectedDetector !== 'none' ? selectedDetectorId : null);
          if (!isMounted) return;
          
          const segments = filesData.files.map(file => ({
            id: file.file_id,
            startTime: file.start_time,
            endTime: file.end_time,
            url: file.s3path,
            presigned_url: file.presigned_url,
            url_detect: file.s3path_detect,
            presigned_url_detect: file.presigned_url_detect,
            has_detect: file.has_detect || false
          }));
          
          setImageSegments(segments);
          
          let shouldUpdateCurrentImage = true;
          if (currentImage && segments.length > 0) {
            const currentImageStillExists = segments.some(segment => segment.id === currentImage.id);
            if (currentImageStillExists) {
              shouldUpdateCurrentImage = false;
            }
          }
          
          if (shouldUpdateCurrentImage && segments.length > 0) {
            const firstImage = segments[0];
            setCurrentImage(firstImage);
            if (firstImage.startTime) {
              const time = new Date(firstImage.startTime);
              const hh = time.getHours().toString().padStart(2, '0');
              const mm = time.getMinutes().toString().padStart(2, '0');
              const ss = time.getSeconds().toString().padStart(2, '0');
              setCurrentTime(`${hh}:${mm}:${ss}`);
            }
          } else if (shouldUpdateCurrentImage && segments.length === 0) {
            setCurrentImage(null);
          }
          
          if (shouldAutoSelectOnSwitch && preservedTimeOnSwitch && segments.length > 0) {
            const targetImage = findImageByTime(segments, preservedTimeOnSwitch);
            if (targetImage) {
              await handleImageSelect(targetImage);
            }
            setShouldAutoSelectOnSwitch(false);
            setPreservedTimeOnSwitch(null);
          }
        }
      } catch (err) {
        console.error('Error fetching segments:', err);
        if (!isMounted) return;
        if (viewMode === 'video') {
          setVideoSegments([]);
        } else if (viewMode === 'image') {
          setImageSegments([]);
          setCurrentImage(null);
        }
        
        if (shouldAutoSelectOnSwitch) {
          setShouldAutoSelectOnSwitch(false);
          setPreservedTimeOnSwitch(null);
        }
      }
    };
    
    fetchSegments();
    
    return () => {
      isMounted = false;
    };
  }, [cameraId, currentDate, currentHour, isInitialized, viewMode, selectedCollectorId, selectedDetector, selectedDetectorId, hasDirectNavParams, hasProcessedURLParams]);
  
  const handleDateChange = (newDate) => {
    setCurrentDate(newDate);
  };
  
  const handleHourChange = (newHour) => {
    setCurrentHour(newHour);
  };
  
  const findNextSegment = (currentSegmentId) => {
    if (!videoSegments.length) return null;
    const currentIndex = videoSegments.findIndex(segment => segment.id === currentSegmentId);
    if (currentIndex === -1 || currentIndex === videoSegments.length - 1) {
      return null;
    }
    return videoSegments[currentIndex + 1];
  };
  
  const findSegmentByTime = (segments, timeString) => {
    if (!timeString || !segments.length) return null;
    
    try {
      const [hours, minutes, seconds] = timeString.split(':').map(Number);
      const targetTime = new Date(2000, 0, 1, hours, minutes, seconds);
      
      for (const segment of segments) {
        if (!segment.startTime || !segment.endTime) continue;
        
        const startTime = new Date(segment.startTime);
        const endTime = new Date(segment.endTime);
        const segmentStart = new Date(2000, 0, 1, startTime.getHours(), startTime.getMinutes(), startTime.getSeconds());
        const segmentEnd = new Date(2000, 0, 1, endTime.getHours(), endTime.getMinutes(), endTime.getSeconds());
        
        if (targetTime >= segmentStart && targetTime <= segmentEnd) {
          return segment;
        }
      }
      
      let closestSegment = null;
      let minDiff = Infinity;
      
      for (const segment of segments) {
        if (!segment.startTime) continue;
        
        const startTime = new Date(segment.startTime);
        const segmentStart = new Date(2000, 0, 1, startTime.getHours(), startTime.getMinutes(), startTime.getSeconds());
        const diff = Math.abs(targetTime - segmentStart);
        
        if (diff < minDiff) {
          minDiff = diff;
          closestSegment = segment;
        }
      }
      
      return closestSegment;
    } catch (error) {
      console.error('Error finding segment by time:', error);
      return null;
    }
  };
  
  const findImageByTime = (images, timeString) => {
    if (!timeString || !images.length) return null;
    
    try {
      const [hours, minutes, seconds] = timeString.split(':').map(Number);
      const targetTime = new Date(2000, 0, 1, hours, minutes, seconds);
      
      let closestImage = null;
      let minDiff = Infinity;
      
      for (const image of images) {
        if (!image.startTime) continue;
        
        const imageTime = new Date(image.startTime);
        const imageCompareTime = new Date(2000, 0, 1, imageTime.getHours(), imageTime.getMinutes(), imageTime.getSeconds());
        const diff = Math.abs(targetTime - imageCompareTime);
        
        if (diff < minDiff) {
          minDiff = diff;
          closestImage = image;
        }
      }
      
      return closestImage;
    } catch (error) {
      console.error('Error finding image by time:', error);
      return null;
    }
  };
  
  const handleVideoEnded = () => {
    if (!currentSegment) return;
    
    const nextSegment = findNextSegment(currentSegment.id);
    
    if (nextSegment) {
      playSegment(nextSegment);
    }
  };
  
  // HLSセッション期限切れ時の自動再取得
  const handleHlsSessionExpired = async () => {
    console.log('HLS session expired, refreshing URL...');
    try {
      const hlsUrlData = await hlsRecUrl(cameraId);
      console.log('HLS URL refreshed successfully');
      setHlsUrl(hlsUrlData.url);
    } catch (hlsError) {
      console.error('Error refreshing HLS URL:', hlsError);
      setHlsUrl('');
    }
  };
  
  const playSegment = async (segment) => {
    if (!segment || !segment.id) return;
    try {
      setCurrentSegment(segment);
      const startTime = segment.startTime ? formatUTCWithTimezone(segment.startTime, 'HH:mm:ss') : '';
      const endTime = segment.endTime ? formatUTCWithTimezone(segment.endTime, 'HH:mm:ss') : '';
      setVideoTimeInfo(`${startTime} - ${endTime}`);
      
      const downloadData = await downloadFile(segment.id);
      if (downloadData && downloadData.presigned_url) {
        setVideoUrl(downloadData.presigned_url);
      } else if (segment.url) {
        setVideoUrl(segment.url);
      }
    } catch (err) {
      console.error('Error downloading file:', err);
      if (segment.url) {
        setVideoUrl(segment.url);
      }
    }
  };
  
  const handleImageSelect = async (image) => {
    setCurrentImage(image);
    
    if (image.startTime) {
      // UTC時刻をユーザー設定のタイムゾーンに変換
      const timeString = formatUTCWithTimezone(image.startTime, 'HH:mm:ss');
      setCurrentTime(timeString);
    }
  };
  
  const handleTimelineSelection = async (segment) => {
    if (viewMode === 'image') {
      if (segment.id) {
        await handleImageSelect(segment);
      } else if (segment.time) {
        setCurrentTime(segment.time);
        setCurrentImage(null);
        setDetectLogs([]);
        
        const [hour, minute] = segment.time.split(':').map(Number);
        const extracted = extractMonthAndDay(currentDate);
        
        if (extracted && selectedCollectorId) {
          const { month, day } = extracted;
          const year = new Date().getFullYear();
          const hourStr = hour.toString().padStart(2, '0');
          const minuteStr = minute.toString().padStart(2, '0');
          
          // JST時刻をUTC時刻に変換してAPI送信用のフォーマットにする（分付き）
          const dateTimePrefix = convertLocalToUTCForAPI(year, month, day, hourStr, minuteStr);
          
          try {
            const filesData = await getFilesByDateTime(cameraId, dateTimePrefix, selectedCollectorId, 'image', true, true, selectedDetector !== 'none' ? selectedDetectorId : null);
            
            const segments = filesData.files.map(file => ({
              id: file.file_id,
              startTime: file.start_time,
              endTime: file.end_time,
              url: file.s3path,
              presigned_url: file.presigned_url,
              url_detect: file.s3path_detect,
              presigned_url_detect: file.presigned_url_detect,
              has_detect: file.has_detect || false
            }));
            
            setImageSegments(segments);
            
            if (segments.length > 0) {
              const firstImage = segments[0];
              await handleImageSelect(firstImage);
            } else {
              setCurrentImage(null);
              setDetectLogs([]);
            }
          } catch (err) {
            console.error('Error fetching images for minute:', err);
            setImageSegments([]);
            setCurrentImage(null);
            setDetectLogs([]);
          }
        }
      }
    } else {
      if (segment.id) {
        if (segment.selectedTime) {
          setCurrentTime(segment.selectedTime);
        } else if (segment.startTime) {
          // UTC時刻をユーザー設定のタイムゾーンに変換
          const formattedTime = formatUTCWithTimezone(segment.startTime, 'HH:mm:ss');
          setCurrentTime(formattedTime);
        }
        playSegment(segment);
      } else if (segment.time) {
        setCurrentTime(segment.time);
        setCurrentSegment(null);
        setVideoUrl('');
        setVideoTimeInfo(t('pages:cameraView.noVideo'));
      }
    }
  };
  
  const handleTimeUpdate = (currentSeconds) => {
    if (currentSegment && currentSegment.startTime) {
      // UTC時刻として解釈
      const startUTC = new Date(currentSegment.startTime.endsWith('Z') ? currentSegment.startTime : currentSegment.startTime + 'Z');
      const nowUTC = new Date(startUTC.getTime() + currentSeconds * 1000);
      // ユーザー設定のタイムゾーンでフォーマット
      const timeString = formatUTCWithTimezone(nowUTC.toISOString().replace('Z', ''), 'HH:mm:ss');
      setCurrentTime(timeString);
    }
  };
  
  const handleViewModeChange = (_, newMode) => {
    if (newMode) {
      if (viewMode === 'live' && hlsPlayer) {
        hlsPlayer.pause();
      } else if ((viewMode === 'video' || viewMode === 'image') && videoPlayer) {
        videoPlayer.pause();
      }

      if ((viewMode === 'video' || viewMode === 'image') && 
          (newMode === 'video' || newMode === 'image') && 
          currentTime) {
        setPreservedTimeOnSwitch(currentTime);
        setShouldAutoSelectOnSwitch(true);
      } else {
        setPreservedTimeOnSwitch(null);
        setShouldAutoSelectOnSwitch(false);
      }

      setViewMode(newMode);
      setVideoUrl('');
      setCurrentSegment(null);
      setVideoTimeInfo(null);
      setCurrentImage(null);
      
      if (newMode === 'live') {
        if (camera?.type === 'kinesis') {
          const fetchHlsUrl = async () => {
            try {
              const hlsUrlData = await hlsRecUrl(cameraId);
              setHlsUrl(hlsUrlData.url);
            } catch (hlsError) {
              console.error('Error fetching HLS URL:', hlsError);
              setHlsUrl('');
            }
          };
          fetchHlsUrl();
        } else if (camera?.type === 'vsaas') {
          setHlsUrl('');
        }
      }
    }
  };
  
  const handleCollectorChange = (event) => {
    setSelectedCollectorId(event.target.value);
  };

  const getAvailableCollectors = () => {
    if (viewMode === 'video') {
      return Array.isArray(collectors.video) ? collectors.video : [];
    } else if (viewMode === 'image') {
      return Array.isArray(collectors.image) ? collectors.image : [];
    }
    return [];
  };
  
  const handleDetectorChange = (event) => {
    const detectorId = event.target.value;
    const available = getAvailableDetectors();
    const detector = available.find(d => d.id === detectorId);
    
    if (detector) {
      setSelectedDetector(detector.name);
      setSelectedDetectorId(detector.id);
    }
  };

  const getAvailableDetectors = () => {
    const result = [{ id: 'none', name: 'none', displayName: 'none' }];
    
    if (Array.isArray(detectors)) {
      const nameCount = {};
      detectors.forEach(d => {
        const detectorName = typeof d === 'string' ? d : (d && typeof d === 'object' && d.detector) ? d.detector : null;
        if (detectorName) {
          nameCount[detectorName] = (nameCount[detectorName] || 0) + 1;
        }
      });
      
      const nameIndex = {};
      detectors.forEach(d => {
        if (typeof d === 'string') {
          const index = (nameIndex[d] || 0) + 1;
          nameIndex[d] = index;
          const displayName = nameCount[d] > 1 ? `${d}(${index})` : d;
          result.push({ id: d, name: d, displayName });
        } else if (d && typeof d === 'object' && d.detector && d.detector_id) {
          const detectorName = d.detector;
          const index = (nameIndex[detectorName] || 0) + 1;
          nameIndex[detectorName] = index;
          const displayName = nameCount[detectorName] > 1 ? `${detectorName}(${index})` : detectorName;
          result.push({ 
            id: d.detector_id, 
            name: detectorName, 
            displayName 
          });
        }
      });
    }
    return result;
  };
  
  const handleNotifyToggle = async (detectLogId, notifyFlg) => {
    try {
      await updateDetectLogNotify(detectLogId, notifyFlg);
      
      setDetectLogs(prevLogs => 
        prevLogs.map(log => 
          log.detect_log_id === detectLogId 
            ? { ...log, detect_notify_flg: notifyFlg }
            : log
        )
      );
    } catch (err) {
      console.error('Error updating notify flag:', err);
    }
  };
  
  const handleRefresh = async () => {
    // Timeline、Segments、Thumbnailを再取得
    if (viewMode === 'live' || !currentDate || !selectedCollectorId) return;
    
    try {
      const extracted = extractMonthAndDay(currentDate);
      if (!extracted) return;
      
      const { month, day } = extracted;
      const year = new Date().getFullYear();
      const hour = currentHour.toString().padStart(2, '0');
      const dateTimePrefix = convertLocalToUTCForAPI(year, month, day, hour);
      const fileType = viewMode === 'video' ? 'video' : 'image';
      
      // Timeline Summaryを再取得
      const summaryData = await getFilesSummaryByHour(
        cameraId, 
        dateTimePrefix, 
        selectedCollectorId, 
        fileType, 
        true, 
        selectedDetector !== 'none' ? selectedDetectorId : null
      );
      setTimelineSummary(summaryData.summary || []);
      
      // Segmentsを再取得
      if (viewMode === 'video') {
        const filesData = await getFilesByDateTime(
          cameraId, 
          dateTimePrefix, 
          selectedCollectorId, 
          'video', 
          true, 
          true, 
          selectedDetector !== 'none' ? selectedDetectorId : null
        );
        
        const segments = filesData.files.map(file => ({
          id: file.file_id,
          startTime: file.start_time,
          endTime: file.end_time,
          url: file.s3path,
          presigned_url: file.presigned_url,
          url_detect: file.s3path_detect,
          presigned_url_detect: file.presigned_url_detect,
          has_detect: file.has_detect || false
        }));
        
        setVideoSegments(segments);
      } else if (viewMode === 'image') {
        let targetMinute;
        
        if (currentTime && currentTime.includes(':')) {
          const [timeHour, timeMinute] = currentTime.split(':').map(Number);
          if (timeHour === currentHour) {
            targetMinute = timeMinute.toString().padStart(2, '0');
          } else {
            targetMinute = new Date().getMinutes().toString().padStart(2, '0');
          }
        } else {
          targetMinute = new Date().getMinutes().toString().padStart(2, '0');
        }
        
        const imageDataTimePrefix = convertLocalToUTCForAPI(year, month, day, hour, targetMinute);
        
        const filesData = await getFilesByDateTime(
          cameraId, 
          imageDataTimePrefix, 
          selectedCollectorId, 
          'image', 
          true, 
          true, 
          selectedDetector !== 'none' ? selectedDetectorId : null
        );
        
        const segments = filesData.files.map(file => ({
          id: file.file_id,
          startTime: file.start_time,
          endTime: file.end_time,
          url: file.s3path,
          presigned_url: file.presigned_url,
          url_detect: file.s3path_detect,
          presigned_url_detect: file.presigned_url_detect,
          has_detect: file.has_detect || false
        }));
        
        setImageSegments(segments);
        
        // 現在の画像が更新後も存在するか確認
        if (currentImage && segments.length > 0) {
          const currentImageStillExists = segments.some(segment => segment.id === currentImage.id);
          if (!currentImageStillExists && segments.length > 0) {
            setCurrentImage(segments[0]);
            if (segments[0].startTime) {
              const time = new Date(segments[0].startTime);
              const hh = time.getHours().toString().padStart(2, '0');
              const mm = time.getMinutes().toString().padStart(2, '0');
              const ss = time.getSeconds().toString().padStart(2, '0');
              setCurrentTime(`${hh}:${mm}:${ss}`);
            }
          }
        }
      }
      
      console.log('Refresh completed successfully');
    } catch (err) {
      console.error('Error refreshing data:', err);
    }
  };
  
  return (
    <>
      <Header />
      
      <Box
        sx={{
          display: 'flex',
          minHeight: '100vh',
          width: '100%',
        }}
      >
        {/* Left side: All fixed and scrollable content */}
        <Box
          sx={{
            width: sidebarOpen ? `calc(100% - ${SIDEBAR_WIDTH}px)` : '100%',
            transition: 'width 0.3s ease',
            position: 'relative',
            flexShrink: 0,
          }}
        >
          {/* TitleArea - Fixed below Header */}
          <Paper
            elevation={2}
            sx={{
              position: 'fixed',
              top: `${HEADER_HEIGHT}px`,
              left: 0,
              right: sidebarOpen ? `${SIDEBAR_WIDTH}px` : 0,
              height: `${TITLE_AREA_HEIGHT}px`,
              zIndex: 1090,
              backgroundColor: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              px: 3,
              transition: 'right 0.3s ease',
            }}
          >
            {/* 左側: 戻るボタン + カメラ名 + タブ */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <IconButton
                component={Link}
                to="/"
                size="medium"
              >
                <ArrowBack />
              </IconButton>
              <Typography variant="h5" component="h1">
                {camera?.name || 'カメラ'}
              </Typography>
              <ToggleButtonGroup
                value={viewMode}
                exclusive
                onChange={handleViewModeChange}
                size="small"
              >
                {camera?.type !== 's3' && (
                  <ToggleButton value="live">{t('pages:cameraView.live')}</ToggleButton>
                )}
                <ToggleButton value="image">{t('pages:cameraView.image')}</ToggleButton>
                <ToggleButton value="video">{t('pages:cameraView.video')}</ToggleButton>
              </ToggleButtonGroup>
            </Box>
            
            {/* 右側: 検出画像切り替え + Bookmarkボタン + 検知結果ボタン */}
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              {/* 検出画像切り替えトグル（画像モード + presigned_url_detect が存在する場合のみ表示） */}
              {viewMode === 'image' && currentImage?.presigned_url_detect && (
                <ToggleButtonGroup
                  value={showDetectImage ? 'detect' : 'original'}
                  exclusive
                  onChange={(_, value) => value && setShowDetectImage(value === 'detect')}
                  size="small"
                >
                  <ToggleButton value="original">{t('pages:cameraView.originalImage')}</ToggleButton>
                  <ToggleButton value="detect">{t('pages:cameraView.detectImage')}</ToggleButton>
                </ToggleButtonGroup>
              )}
              
              {((viewMode === 'video' && currentSegment) || (viewMode === 'image' && currentImage)) && (
                <BookmarkButton
                  fileId={viewMode === 'video' ? currentSegment.id : currentImage.id}
                  fileType={viewMode}
                  collector={(() => {
                    const collectors = getAvailableCollectors();
                    const collector = collectors.find(c => c.collector_id === selectedCollectorId);
                    return collector ? collector.collector : '';
                  })()}
                  collectorId={selectedCollectorId}
                  detector={selectedDetector}
                  detectorId={selectedDetectorId}
                  datetime={urlParams.datetime || (() => {
                    const extracted = extractMonthAndDay(currentDate);
                    if (extracted && currentTime) {
                      const { month, day } = extracted;
                      const year = new Date().getFullYear();
                      const [hours, minutes] = currentTime.split(':');
                      return `${year}${month}${day}${hours}${minutes}`;
                    }
                    return '';
                  })()}
                  cameraId={cameraId}
                  cameraName={camera?.name}
                  placeId={camera?.place_id}
                  disabled={!selectedCollectorId || (!currentSegment && !currentImage)}
                  buttonProps={{
                    variant: 'outlined',
                    color: 'warning',
                    size: 'small',
                    sx: {
                      minWidth: 120,
                    }
                  }}
                />
              )}
              
              {viewMode !== 'live' && selectedDetector !== 'none' && (
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => setSidebarOpen(!sidebarOpen)}
                  endIcon={sidebarOpen ? <ChevronRight /> : <ChevronLeft />}
                  sx={{ minWidth: 120 }}
                >
                  {t('common:detectionResult')}
                </Button>
              )}
            </Box>
          </Paper>

          {/* Main content area - Scrollable */}
          <Box
            sx={{
              marginTop: `${HEADER_HEIGHT + TITLE_AREA_HEIGHT}px`,
              marginBottom: viewMode === 'live' ? 0 : `${thumbnailAreaHeight + controlAreaHeight}px`,
              overflow: 'hidden',
              height: viewMode === 'live' 
                ? `calc(100vh - ${HEADER_HEIGHT + TITLE_AREA_HEIGHT}px)`
                : `calc(100vh - ${HEADER_HEIGHT + TITLE_AREA_HEIGHT + thumbnailAreaHeight + controlAreaHeight}px)`,
              display: 'flex',
              flexDirection: 'column',
              width: '100%',
              maxWidth: '100%',
            }}
          >
          <Box sx={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', my: 4 }}>
                <CircularProgress />
              </Box>
            ) : error ? (
              <Typography color="error">{error}</Typography>
            ) : (
              <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
                {/* Player area */}
                {viewMode === 'live' ? (
                  <>
                    <Paper elevation={2} sx={{ overflow: 'hidden', width: '100%', height: '100%', flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' }}>
                      <div className="video-container" style={{ width: '100%', height: '100%', aspectRatio: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {camera?.type === 'vsaas' ? (
                          camera?.vsaas_apikey && camera?.vsaas_device_id ? (
                            <VSaaSPlayer
                              key={`vsaas-${cameraId}`}
                              apiKey={camera.vsaas_apikey}
                              deviceId={camera.vsaas_device_id}
                              autoPlay={true}
                              onError={(e) => {
                                console.error('VSaaS player error:', e);
                              }}
                              onPlayerReady={(player) => setHlsPlayer(player)}
                            />
                          ) : (
                            <Alert severity="error" sx={{ m: 2 }}>
                              VSaaS API KeyまたはDevice IDが設定されていません
                            </Alert>
                          )
                        ) : camera?.type === 'kinesis' ? (
                          hlsUrl ? (
                            <HlsPlayer 
                              key={`hls-${cameraId}-${hlsUrl}`}
                              src={hlsUrl} 
                              autoPlay={true}
                              controls={true}
                              muted={true}
                              liveMode={true}
                              style={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'contain'
                              }}
                              onEnded={handleVideoEnded}
                              hlsConfig={{
                                enableWorker: true,
                                lowLatencyMode: true,
                                backBufferLength: 90
                              }}
                              onError={(e) => {
                                console.error('HLS player error:', e);
                              }}
                              onPlayerReady={(player) => setHlsPlayer(player)}
                              onSessionExpired={handleHlsSessionExpired}
                            />
                          ) : (
                            <Alert severity="warning" sx={{ m: 2 }}>
                              HLS URLを取得中...
                            </Alert>
                          )
                        ) : (
                          <Alert severity="error" sx={{ m: 2 }}>
                            サポートされていないカメラタイプです: {camera?.type}
                          </Alert>
                        )}
                      </div>
                    </Paper>
                  </>
                ) : viewMode === 'video' ? (
                  <>
                    <Paper elevation={2} sx={{ overflow: 'hidden', width: '100%', height: '100%', flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' }}>
                      <div className="video-container" style={{ width: '100%', height: '100%', aspectRatio: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {videoUrl && (
                          <VideoPlayer 
                            key={`mp4-${currentSegment?.id || 'none'}`}
                            src={videoUrl} 
                            autoPlay={true}
                            controls={true}
                            muted={false}
                            onEnded={handleVideoEnded}
                            isHls={false}
                            onError={(e) => {
                              console.error('Video player error:', e);
                            }}
                            onPlayerReady={(player) => setVideoPlayer(player)}
                            onTimeUpdate={handleTimeUpdate}
                          />
                        )}
                      </div>
                    </Paper>
                    {videoTimeInfo && (
                      <Box sx={{ mt: 1, textAlign: 'center' }}>
                        <Typography variant="subtitle2" color="text.secondary">
                          {videoTimeInfo}
                        </Typography>
                      </Box>
                    )}
                  </>
                ) : viewMode === 'image' ? (
                  <Box sx={{ width: '100%', height: '100%', flexGrow: 1, display: 'flex', overflow: 'hidden', backgroundColor: '#000' }}>
                    <ImageViewer
                      images={displayImageSegments}
                      selectedImage={displayCurrentImage}
                      onImageSelect={handleImageSelect}
                      currentTime={currentTime}
                      showThumbnails={false}
                      detectArea={detectAreaForDisplay}
                      videoWidth={1280}
                      videoHeight={720}
                    />
                  </Box>
                ) : null}
              </Box>
            )}
          </Box>
          </Box>

          {/* Thumbnail Area - Fixed above ControlArea (画像モードのみ) */}
          {viewMode === 'image' && displayImageSegments.length > 0 && !loading && !error && (
            <Paper
              ref={thumbnailAreaRef}
              elevation={3}
              sx={{
                position: 'fixed',
                bottom: `${controlAreaHeight}px`,
                left: 0,
                right: sidebarOpen ? `${SIDEBAR_WIDTH}px` : 0,
                zIndex: 1030,
                backgroundColor: 'white',
                boxShadow: '0 -2px 10px rgba(0,0,0,0.1)',
                padding: 1,
                maxHeight: '150px',
                overflow: 'auto',
                transition: 'right 0.3s ease',
              }}
            >
              <Box sx={{ display: 'flex', gap: 1, overflowX: 'auto', px: 1 }}>
                {displayImageSegments.map((image, index) => {
                  const isSelected = currentImage?.id === image.id;
                  // handleImageSelectには元のimageSegmentsのオブジェクトを渡す
                  const originalImage = imageSegments[index];
                  return (
                    <Box
                      key={image.id || index}
                      onClick={() => handleImageSelect(originalImage)}
                      sx={{
                        width: 100,
                        height: 100,
                        cursor: 'pointer',
                        border: isSelected ? '3px solid #e67e22' : '2px solid transparent',
                        borderRadius: 1,
                        overflow: 'hidden',
                        backgroundColor: image.has_detect ? 'rgba(255, 193, 7, 0.15)' : '#f5f5f5',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        position: 'relative',
                        transform: isSelected ? 'scale(1.05)' : 'scale(1)',
                        transition: 'all 0.2s ease',
                        boxShadow: isSelected ? '0 4px 8px rgba(230, 126, 34, 0.3)' : 'none',
                        flexShrink: 0,
                        '&:hover': {
                          border: isSelected ? '3px solid #e67e22' : '2px solid #ccc',
                          transform: 'scale(1.05)',
                        }
                      }}
                    >
                      {image.presigned_url || image.url ? (
                        <img
                          src={image.presigned_url || image.url}
                          alt={`Thumbnail ${index + 1}`}
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            opacity: image.has_detect ? 0.85 : 1.0
                          }}
                        />
                      ) : (
                        <CircularProgress size={20} />
                      )}
                      <Box
                        sx={{
                          position: 'absolute',
                          bottom: 0,
                          left: 0,
                          right: 0,
                          backgroundColor: image.has_detect 
                            ? 'rgba(255, 193, 7, 0.9)' 
                            : 'rgba(0, 0, 0, 0.7)',
                          color: 'white',
                          fontSize: '0.7rem',
                          textAlign: 'center',
                          py: 0.25
                        }}
                      >
                        {image.startTime ? (() => {
                          // UTC文字列をユーザー設定のタイムゾーンで表示
                          const formatted = formatUTCWithTimezone(image.startTime, 'HH:mm:ss');
                          return formatted;
                        })() : ''}
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            </Paper>
          )}

          {/* Control area - Fixed at bottom */}
          {!loading && !error && viewMode !== 'live' && (
            <Paper
              ref={controlAreaRef}
              elevation={3}
              sx={{
                position: 'fixed',
                bottom: 0,
                left: 0,
                right: sidebarOpen ? `${SIDEBAR_WIDTH}px` : 0,
                backgroundColor: 'white',
                boxShadow: '0 -2px 10px rgba(0,0,0,0.1)',
                zIndex: 1020,
                transition: 'right 0.3s ease',
                padding: 2,
                maxHeight: '350px',
                overflow: 'auto',
              }}
            >
              
              {/* Collector and Detector selection */}
              <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                {collectorError ? (
                  <Alert severity="warning" sx={{ flex: 1 }}>
                    {collectorError}
                  </Alert>
                ) : (
                  <>
                    <FormControl sx={{ minWidth: 200 }}>
                      <InputLabel>{t('pages:cameraView.collector')}</InputLabel>
                      <Select
                        value={selectedCollectorId}
                        label={t('pages:cameraView.collector')}
                        onChange={handleCollectorChange}
                        size="small"
                      >
                        {getAvailableCollectors().map((collector) => (
                          <MenuItem key={collector.collector_id} value={collector.collector_id}>
                            {collector.collector}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    
                    <FormControl sx={{ minWidth: 200 }}>
                      <InputLabel>{t('pages:cameraView.detectorShort')}</InputLabel>
                      <Select
                        value={selectedDetectorId || 'none'}
                        label={t('pages:cameraView.detectorShort')}
                        onChange={handleDetectorChange}
                        disabled={!selectedCollectorId || detectorError !== ''}
                        size="small"
                      >
                        {getAvailableDetectors().map((detector) => (
                          <MenuItem key={detector.id} value={detector.id}>
                            {detector.displayName}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    
                    <IconButton
                      onClick={handleRefresh}
                      color="primary"
                      sx={{ mt: 1, ml: 'auto' }}
                      title={t('common:refresh') || '更新'}
                    >
                      <Refresh />
                    </IconButton>
                  </>
                )}
              </Box>
              
              {detectorError && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  {detectorError}
                </Alert>
              )}
              
              <DateSelector 
                selectedDate={currentDate}
                onDateChange={handleDateChange}
              />
              <HourSelector 
                currentHour={currentHour}
                onHourChange={handleHourChange}
              />
              <Timeline 
                currentHour={currentHour}
                mediaSegments={viewMode === 'video' ? videoSegments : imageSegments}
                minuteSummary={timelineSummary}
                onTimeSelected={handleTimelineSelection}
                currentTime={currentTime}
                currentSegmentId={viewMode === 'video' ? currentSegment?.id : currentImage?.id}
              />
            </Paper>
          )}
        </Box>

        {/* Right sidebar for detection results */}
        <Drawer
          anchor="right"
          variant="persistent"
          open={sidebarOpen}
          sx={{
            width: sidebarOpen ? SIDEBAR_WIDTH : 0,
            flexShrink: 0,
            '& .MuiDrawer-paper': {
              width: SIDEBAR_WIDTH,
              boxSizing: 'border-box',
              top: `${HEADER_HEIGHT}px`,
              height: `calc(100vh - ${HEADER_HEIGHT}px)`,
              overflow: 'auto',
              padding: 0,
              zIndex: 1040,
              borderLeft: '1px solid #e0e0e0',
            },
          }}
        >
          <Box sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6">{t('common:detectionResult')}</Typography>
              <IconButton onClick={() => setSidebarOpen(false)} size="small">
                <ChevronRight />
              </IconButton>
            </Box>
            
            {detectLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
                <CircularProgress />
              </Box>
            ) : (
              <Box sx={{ flexGrow: 1, overflow: 'auto' }}>
                <DetectResultViewer 
                  detectLogs={detectLogs}
                  onNotifyToggle={handleNotifyToggle}
                />
              </Box>
            )}
          </Box>
        </Drawer>
      </Box>
    </>
  );
};

export default CameraView;
