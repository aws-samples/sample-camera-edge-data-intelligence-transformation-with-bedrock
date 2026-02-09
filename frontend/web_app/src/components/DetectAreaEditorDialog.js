import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Alert,
  CircularProgress,
  IconButton
} from '@mui/material';
import { Close as CloseIcon, Undo as UndoIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import HlsPlayer from './HlsPlayer';
import VSaaSPlayer from './VSaaSPlayer';
import { hlsRecUrl } from '../services/api';

// VSaaSカメラの固定解像度
const VSAAS_VIDEO_WIDTH = 1280;
const VSAAS_VIDEO_HEIGHT = 720;

const CLOSE_THRESHOLD = 15;

const HLS_CONFIG = {
  maxBufferLength: 30,
  maxMaxBufferLength: 60,
  backBufferLength: 90
};

const DetectAreaEditorDialog = ({
  open,
  onClose,
  onSave,
  initialArea,
  camera
}) => {
  const { t } = useTranslation(['dialogs', 'common']);
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const initialAreaLoadedRef = useRef(false);

  const [points, setPoints] = useState([]);
  const [isPolygonClosed, setIsPolygonClosed] = useState(false);
  const [videoSize, setVideoSize] = useState({ width: 1280, height: 720 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hlsUrl, setHlsUrl] = useState('');
  const [playerReady, setPlayerReady] = useState(false);
  const [displayArea, setDisplayArea] = useState(null);  // 映像の実際の表示領域

  const isVSaaSCamera = camera?.type === 'vsaas';
  const cameraId = camera?.camera_id;

  // 映像の実際の表示領域を計算（アスペクト比を考慮）
  const calculateDisplayArea = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    const containerAspect = rect.width / rect.height;
    const videoAspect = videoSize.width / videoSize.height;

    let displayWidth, displayHeight, offsetX, offsetY;

    if (containerAspect > videoAspect) {
      // コンテナが横長 → 高さに合わせる（左右に余白）
      displayHeight = rect.height;
      displayWidth = displayHeight * videoAspect;
      offsetX = (rect.width - displayWidth) / 2;
      offsetY = 0;
    } else {
      // コンテナが縦長 → 幅に合わせる（上下に余白）
      displayWidth = rect.width;
      displayHeight = displayWidth / videoAspect;
      offsetX = 0;
      offsetY = (rect.height - displayHeight) / 2;
    }

    return { displayWidth, displayHeight, offsetX, offsetY, canvasWidth: rect.width, canvasHeight: rect.height };
  }, [videoSize]);

  // ダイアログ開閉時の処理
  useEffect(() => {
    if (!open) {
      setPoints([]);
      setIsPolygonClosed(false);
      setLoading(true);
      setError(null);
      setHlsUrl('');
      setPlayerReady(false);
      initialAreaLoadedRef.current = false;
      return;
    }

    if (!cameraId) {
      setLoading(false);
      return;
    }

    // VSaaSカメラの場合はHLS URLの取得は不要
    if (isVSaaSCamera) {
      // VSaaSプレイヤーの準備完了を待つ（handleVSaaSPlayerReadyでloadingをfalseにする）
      return;
    }

    const fetchUrl = async () => {
      try {
        const hlsUrlData = await hlsRecUrl(cameraId);
        setHlsUrl(hlsUrlData.url);
      } catch (err) {
        console.error('Error fetching HLS URL:', err);
        setError(t('dialogs:collector.detectAreaEditorVideoError'));
        setLoading(false);
      }
    };

    fetchUrl();
  }, [open, cameraId, isVSaaSCamera, t]);

  // HLSプレイヤー準備完了
  const handlePlayerReady = useCallback((videoElement) => {
    const width = videoElement.videoWidth || 1280;
    const height = videoElement.videoHeight || 720;
    setVideoSize({ width, height });
    setLoading(false);
    setPlayerReady(true);
    console.log('DetectAreaEditorDialog: HLS video size =', width, 'x', height);
  }, []);

  // VSaaSプレイヤー準備完了（固定解像度を使用）
  const handleVSaaSPlayerReady = useCallback(() => {
    // VSaaSカメラは固定で1280x720
    setVideoSize({ width: VSAAS_VIDEO_WIDTH, height: VSAAS_VIDEO_HEIGHT });
    setLoading(false);
    setPlayerReady(true);
    console.log('DetectAreaEditorDialog: VSaaS video size =', VSAAS_VIDEO_WIDTH, 'x', VSAAS_VIDEO_HEIGHT);
  }, []);

  const handleHlsError = useCallback((e) => {
    if (e && e.fatal) {
      console.error('HLS fatal error:', e);
    }
  }, []);

  // 初期エリア読み込み
  useEffect(() => {
    if (!open || !playerReady || initialAreaLoadedRef.current) return;
    
    const canvas = canvasRef.current;
    if (!initialArea || !canvas) {
      initialAreaLoadedRef.current = true;
      return;
    }

    // Canvasのサイズを取得
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return;
    }

    // Canvas解像度をCSS表示サイズに合わせる
    canvas.width = rect.width;
    canvas.height = rect.height;

    // 映像の実際の表示領域を計算
    const area = calculateDisplayArea();
    if (!area) {
      initialAreaLoadedRef.current = true;
      return;
    }
    setDisplayArea(area);

    try {
      const parsed = JSON.parse(initialArea);
      if (Array.isArray(parsed) && parsed.length >= 3) {
        // 映像座標 → Canvas座標に変換（映像領域内）
        const scaleX = area.displayWidth / videoSize.width;
        const scaleY = area.displayHeight / videoSize.height;

        const canvasPoints = parsed.map(coord => ({
          x: coord[0] * scaleX + area.offsetX,
          y: coord[1] * scaleY + area.offsetY
        }));

        setPoints(canvasPoints);
        setIsPolygonClosed(true);
      }
    } catch (e) {
      console.log('No valid initial area');
    }
    
    initialAreaLoadedRef.current = true;
  }, [open, playerReady, initialArea, videoSize, calculateDisplayArea]);

  // Canvas描画
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    // Canvas解像度を更新
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    }

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (points.length === 0) return;

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }

    if (isPolygonClosed) {
      ctx.closePath();
      ctx.fillStyle = 'rgba(0, 150, 255, 0.3)';
      ctx.fill();
    }

    ctx.strokeStyle = '#00BFFF';
    ctx.lineWidth = 2;
    ctx.stroke();

    points.forEach((point, index) => {
      ctx.beginPath();
      ctx.arc(point.x, point.y, index === 0 ? 6 : 4, 0, Math.PI * 2);
      ctx.fillStyle = index === 0 ? '#FF6B6B' : '#00BFFF';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.stroke();
    });
  }, [points, isPolygonClosed]);

  // クリック判定
  const isNearFirstPoint = useCallback((x, y) => {
    if (points.length < 3) return false;
    const first = points[0];
    const distance = Math.sqrt(Math.pow(x - first.x, 2) + Math.pow(y - first.y, 2));
    return distance < CLOSE_THRESHOLD;
  }, [points]);

  // Canvasクリック
  const handleCanvasClick = useCallback((e) => {
    if (isPolygonClosed || loading) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    
    // Canvas解像度を更新
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    }

    // 映像の実際の表示領域を計算
    const area = calculateDisplayArea();
    if (!area) return;
    setDisplayArea(area);

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // 映像領域外のクリックは無視
    if (x < area.offsetX || 
        y < area.offsetY || 
        x > area.offsetX + area.displayWidth || 
        y > area.offsetY + area.displayHeight) {
      console.log('Click outside video area, ignoring');
      return;
    }

    if (isNearFirstPoint(x, y)) {
      setIsPolygonClosed(true);
      return;
    }

    setPoints(prev => [...prev, { x, y }]);
  }, [isPolygonClosed, loading, isNearFirstPoint, calculateDisplayArea]);

  const handleClear = useCallback(() => {
    setPoints([]);
    setIsPolygonClosed(false);
  }, []);

  const handleUndo = useCallback(() => {
    if (isPolygonClosed) {
      setIsPolygonClosed(false);
      return;
    }
    setPoints(prev => prev.slice(0, -1));
  }, [isPolygonClosed]);

  const handleSave = useCallback(() => {
    if (!isPolygonClosed || points.length < 3) return;

    // 映像の実際の表示領域を計算
    const area = calculateDisplayArea();
    if (!area) return;

    // Canvas座標 → 映像座標に変換
    const scaleX = videoSize.width / area.displayWidth;
    const scaleY = videoSize.height / area.displayHeight;

    const videoCoords = points.map(point => [
      Math.round((point.x - area.offsetX) * scaleX),
      Math.round((point.y - area.offsetY) * scaleY)
    ]);

    console.log('Saving video coordinates:', videoCoords);
    onSave(JSON.stringify(videoCoords));
  }, [isPolygonClosed, points, videoSize, onSave, calculateDisplayArea]);

  if (!cameraId) {
    return (
      <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
        <DialogTitle>{t('dialogs:collector.detectAreaEditorTitle')}</DialogTitle>
        <DialogContent>
          <Alert severity="warning">{t('dialogs:collector.detectAreaEditorNoCameraId')}</Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('common:close')}</Button>
        </DialogActions>
      </Dialog>
    );
  }

  // VSaaSカメラで必要な情報が設定されていない場合
  if (isVSaaSCamera && (!camera?.vsaas_apikey || !camera?.vsaas_device_id)) {
    return (
      <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
        <DialogTitle>{t('dialogs:collector.detectAreaEditorTitle')}</DialogTitle>
        <DialogContent>
          <Alert severity="warning">{t('dialogs:collector.detectAreaEditorNoVSaaSConfig')}</Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('common:close')}</Button>
        </DialogActions>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth PaperProps={{ sx: { height: '90vh' } }}>
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {t('dialogs:collector.detectAreaEditorTitle')}
        <IconButton onClick={onClose} size="small"><CloseIcon /></IconButton>
      </DialogTitle>
      
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', p: 2 }}>
        <Alert severity="info" sx={{ mb: 2 }}>{t('dialogs:collector.detectAreaEditorInstructions')}</Alert>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Box ref={containerRef} sx={{ position: 'relative', flex: 1, minHeight: 400, backgroundColor: '#000', borderRadius: 1, overflow: 'hidden' }}>
          {loading && (
            <Box sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
              <CircularProgress color="primary" />
              <Typography color="white">{t('dialogs:collector.detectAreaEditorLoadingVideo')}</Typography>
            </Box>
          )}

          {/* HLSカメラの場合 */}
          {!isVSaaSCamera && hlsUrl && (
            <HlsPlayer
              key={`detect-area-hls-${cameraId}`}
              src={hlsUrl}
              autoPlay={true}
              controls={false}
              muted={true}
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              hlsConfig={HLS_CONFIG}
              onPlayerReady={handlePlayerReady}
              onError={handleHlsError}
            />
          )}

          {/* VSaaSカメラの場合 */}
          {isVSaaSCamera && camera?.vsaas_apikey && camera?.vsaas_device_id && (
            <VSaaSPlayer
              key={`detect-area-vsaas-${cameraId}`}
              apiKey={camera.vsaas_apikey}
              deviceId={camera.vsaas_device_id}
              autoPlay={true}
              width="100%"
              height="100%"
              style={{ objectFit: 'contain' }}
              onPlayerReady={handleVSaaSPlayerReady}
              onError={(err) => {
                console.error('VSaaS player error:', err);
                setError(t('dialogs:collector.detectAreaEditorVideoError'));
              }}
            />
          )}

          <canvas
            ref={canvasRef}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              cursor: isPolygonClosed ? 'default' : 'crosshair',
              pointerEvents: loading ? 'none' : 'auto'
            }}
            onClick={handleCanvasClick}
          />
        </Box>

        <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Typography variant="body2">{t('dialogs:collector.detectAreaEditorPointCount', { count: points.length })}</Typography>
            <Typography variant="body2" color={isPolygonClosed ? 'success.main' : 'warning.main'}>
              {isPolygonClosed ? t('dialogs:collector.detectAreaEditorPolygonClosed') : t('dialogs:collector.detectAreaEditorPolygonOpen')}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button variant="outlined" size="small" startIcon={<UndoIcon />} onClick={handleUndo} disabled={points.length === 0 && !isPolygonClosed}>
              {t('dialogs:collector.detectAreaEditorUndo')}
            </Button>
            <Button variant="outlined" size="small" color="warning" onClick={handleClear}>
              {t('dialogs:collector.detectAreaEditorClear')}
            </Button>
          </Box>
        </Box>

        <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
          {t('dialogs:collector.detectAreaEditorVideoSize', { width: videoSize.width, height: videoSize.height })}
        </Typography>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>{t('dialogs:collector.detectAreaEditorCancel')}</Button>
        <Button variant="contained" onClick={handleSave} disabled={!isPolygonClosed || points.length < 3}>
          {isPolygonClosed ? t('dialogs:collector.detectAreaEditorSave') : t('dialogs:collector.detectAreaEditorSaveDisabled')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default DetectAreaEditorDialog;


