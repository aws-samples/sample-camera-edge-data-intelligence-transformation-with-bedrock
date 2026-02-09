import React, { useState, useEffect } from 'react';
import {
  Container,
  Typography,
  Box,
  Paper,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  Grid,
  Alert,
  Tabs,
  Tab,
  Card,
  CardContent,
  CardActions,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Chip,
  Autocomplete,
  IconButton,
  Tooltip,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Divider,
  CircularProgress,
  LinearProgress
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  Save as SaveIcon,
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import { useParams, useNavigate } from 'react-router-dom';
import PageLayout from '../components/PageLayout';
import TitleArea from '../components/TitleArea';
import DetectorDialog from '../components/DetectorDialog';
import CollectorDialog from '../components/CollectorDialog';
import { HEADER_HEIGHT, TITLE_AREA_HEIGHT } from '../constants/layout';
import {
  getCamera,
  createCamera,
  updateCamera,
  getCameraDeployStatus,
  getPlaces,
  getCameraCollectors,
  createCameraCollector,
  updateCameraCollector,
  getCameraDetectors,
  createDetector,
  updateDetector,
  deleteDetector,
  getTags,
  deleteCamera,
} from '../services/api';
import { requiredEnvVar } from '../utils/env';
import { Auth } from 'aws-amplify';
import { useTranslation } from 'react-i18next';

// Helper function to get auth headers
const getAuthHeaders = async () => {
  try {
    console.log('Getting auth headers...');
    const session = await Auth.currentSession();
    console.log('Current session:', session);
    const token = session.getIdToken().getJwtToken();
    console.log('JWT Token:', token.substring(0, 50) + '...');
    const headers = {
      Authorization: `Bearer ${token}`
    };
    console.log('Auth headers:', headers);
    return headers;
  } catch (error) {
    console.error('Error getting auth token:', error);
    return {};
  }
};

const CameraEdit = () => {
  const { t } = useTranslation(['pages', 'common']);
  const { cameraId } = useParams();
  const navigate = useNavigate();
  const isNewCamera = !cameraId || cameraId === 'new';

  // 基本状態管理
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState(0);
  const [deployingRtsp, setDeployingRtsp] = useState(false);

  // カメラ情報
  const [camera, setCamera] = useState({
    camera_id: '',
    name: '',
    place_id: '',
    type: 'kinesis',
    vsaas_device_id: '',
    vsaas_apikey: '',
    kinesis_streamarn: '',
    s3path: '',
    aws_access_key: '',
    aws_secret_access_key: '',
    aws_region: '',
    // RTSP エンドポイント関連
    camera_endpoint: '',
    camera_endpoint_cloudformation_stack: '',
    rtsp_url: '',
    // RTSP デプロイ用一時フィールド（新規作成時のみ）
    retention_period: '24',
    fragment_duration: '500',
    storage_size: '512'
  });

  // マスタデータ
  const [places, setPlaces] = useState([]);
  const [collectors, setCollectors] = useState([]);
  const [tags, setTags] = useState([]);

  // ダイアログ状態
  const [collectorDialog, setCollectorDialog] = useState({ open: false, data: null, isEdit: false });
  const [detectorDialog, setDetectorDialog] = useState({ open: false, data: null, isEdit: false });
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // 初期化
  useEffect(() => {
    const initializeData = async () => {
      try {
        setLoading(true);
        console.log('CameraEdit - Initializing data for camera:', cameraId, 'isNew:', isNewCamera);
        // マスタデータを並行取得
        const [placesData, tagsData] = await Promise.all([
          getPlaces(),
          getTags()
        ]);
        setPlaces(placesData);
        setTags(tagsData);
        if (!isNewCamera) {
          // 既存カメラのデータ取得
          const [cameraData, collectorsData] = await Promise.all([
            getCamera(cameraId),
            getCameraCollectors(cameraId)
          ]);
          setCamera(cameraData);
          
          // 各コレクターごとにDetectorを取得してネスト
          const collectorsWithDetectors = await Promise.all(
            collectorsData.map(async (collector) => {
              try {
                const detectorsData = await getCameraDetectors(
                  cameraId, 
                  collector.collector_id,
                  null
                );
                return {
                  ...collector,
                  detectors: detectorsData.detectors || []
                };
              } catch (err) {
                console.warn("Detectors fetch failed for %s:", collector.collector, err);
                return {
                  ...collector,
                  detectors: []
                };
              }
            })
          );
          
          setCollectors(collectorsWithDetectors);
        }
      } catch (err) {
        console.error('Error initializing data:', err);
        if (!isNewCamera) setError(t('pages:cameraEdit.dataFetchFailed'));
      } finally {
        setLoading(false);
      }
    };
    initializeData();
  }, [cameraId, isNewCamera]);

  // カメラ情報の変更ハンドラー
  const handleCameraChange = (field, value) => {
    setCamera(prev => ({
      ...prev,
      [field]: value
    }));
  };

  // カメラエンドポイント変更ハンドラー
  const handleEndpointChange = (endpoint) => {
    if (endpoint === 'rtsp') {
      // RTSPが選択された場合、typeをkinesisに自動設定
      setCamera(prev => ({
        ...prev,
        camera_endpoint: endpoint,
        type: 'kinesis'
      }));
    } else if (endpoint === 'rtmp') {
      // RTMPが選択された場合、typeをkinesisに自動設定
      setCamera(prev => ({
        ...prev,
        camera_endpoint: endpoint,
        type: 'kinesis',
        rtsp_url: ''
      }));
    } else {
      // RTSP/RTMP以外が選択された場合
      setCamera(prev => ({
        ...prev,
        camera_endpoint: endpoint,
        rtsp_url: ''
      }));
    }
  };

  // AWSキーのバリデーション
  const validateAwsKeys = () => {
    const { aws_access_key, aws_secret_access_key, aws_region, type } = camera;
    
    // kinesis以外は検証不要
    if (type !== 'kinesis') {
      return true;
    }
    
    // 両方空または両方入力済みならOK
    const hasAccessKey = aws_access_key && aws_access_key.trim() !== '';
    const hasSecretKey = aws_secret_access_key && aws_secret_access_key.trim() !== '';
    
    if (hasAccessKey && hasSecretKey) {
      return true; // 両方入力済み
    }
    
    if (!hasAccessKey && !hasSecretKey) {
      return true; // 両方未入力
    }
    
    return false; // 片方のみ入力
  };

  // VSaaSフィールドのバリデーション
  const validateVSaaSFields = () => {
    if (camera.type === 'vsaas') {
      if (!camera.vsaas_device_id || camera.vsaas_device_id.trim() === '') {
        return 'VSaaS Device IDを入力してください。';
      }
      if (!camera.vsaas_apikey || camera.vsaas_apikey.trim() === '') {
        return 'VSaaS API Keyを入力してください。';
      }
    }
    return null;
  };

  // Kinesis Streamのバリデーション
  const validateKinesisStream = () => {
    if (camera.type === 'kinesis') {
      const endpoint = camera.camera_endpoint;
      // camera_endpointがnone（または空）の場合、kinesis_streamarnが必須
      if (!endpoint || endpoint.trim() === '' || endpoint === 'none') {
        if (!camera.kinesis_streamarn || camera.kinesis_streamarn.trim() === '') {
          return 'カメラエンドポイントが未設定の場合、Kinesis Stream ARNは必須です。';
        }
      }
    }
    return null;
  };

  // RTSPエンドポイントのバリデーション
  const validateRtspFields = () => {
    if (camera.camera_endpoint === 'rtsp') {
      if (!camera.rtsp_url || camera.rtsp_url.trim() === '') {
        return 'RTSP URLを入力してください。';
      }
      if (!camera.rtsp_url.startsWith('rtsp://')) {
        return 'RTSP URLは rtsp:// で始まる必要があります。';
      }
    }
    return null;
  };

  // カメラ保存
  const handleSaveCamera = async () => {
    try {
      setSaving(true);
      
      // VSaaSフィールドのバリデーション
      const vsaasError = validateVSaaSFields();
      if (vsaasError) {
        setError(vsaasError);
        return;
      }
      
      // Kinesis Streamのバリデーション
      const kinesisError = validateKinesisStream();
      if (kinesisError) {
        setError(kinesisError);
        return;
      }
      
      // RTSPフィールドのバリデーション
      const rtspError = validateRtspFields();
      if (rtspError) {
        setError(rtspError);
        return;
      }
      
      // AWSキーのバリデーション
      if (!validateAwsKeys()) {
        setError('AWSアクセスキーとシークレットキーは両方とも入力するか、両方とも空にしてください。');
        return;
      }
      
      if (isNewCamera) {
        // 新規時はカメラIDを送信しない
        const cameraToSend = { ...camera };
        delete cameraToSend.camera_id;
        
        // RTSPエンドポイントの場合、バリデーション
        if (camera.camera_endpoint === 'rtsp') {
          if (!camera.rtsp_url) {
            setError('RTSP URLは必須です');
            setSaving(false);
            return;
          }
          setDeployingRtsp(true);
        }
        
        // RTMPエンドポイントの場合、デプロイ中状態を表示
        if (camera.camera_endpoint === 'rtmp') {
          setDeployingRtsp(true);
        }
        
        // カメラ作成API呼び出し
        const result = await createCamera(cameraToSend);
        const newCameraId = result.camera_id;
        
        // カメラ作成を開始メッセージ
        setError(`カメラを作成中です（ID: ${newCameraId}）...`);
        
        // ポーリング開始
        const pollInterval = setInterval(async () => {
          try {
            const statusData = await getCameraDeployStatus(newCameraId);
            
            if (statusData.status === 'deployed') {
              // デプロイ完了
              clearInterval(pollInterval);
              setDeployingRtsp(false);
              setSaving(false);
              setError(null);
              
              // カメラ編集画面に遷移
              navigate(`/camera/${newCameraId}/edit`);
            } else if (statusData.status === 'failed') {
              // デプロイ失敗
              clearInterval(pollInterval);
              setDeployingRtsp(false);
              setSaving(false);
              setError(`デプロイに失敗しました: ${statusData.deploy_error || '不明なエラー'}`);
            } else if (statusData.status === 'deleted') {
              // スタック削除済み
              clearInterval(pollInterval);
              setDeployingRtsp(false);
              setSaving(false);
              setError('CloudFormationスタックが削除されています');
            } else {
              // deploying または pending の場合は引き続きポーリング
              setError(`カメラを作成中です（ID: ${newCameraId}）。ステータス: ${statusData.status}`);
            }
          } catch (pollError) {
            console.error('Polling error:', pollError);
            clearInterval(pollInterval);
            setDeployingRtsp(false);
            setSaving(false);
            setError(`カメラ作成状況の確認に失敗しました: ${pollError.message}`);
          }
        }, 5000); // 5秒ごとにポーリング
      } else {
        const updatedCamera = await updateCamera(cameraId, camera);
        setCamera(updatedCamera);
        // 更新の場合はエラーをクリアして保存状態を解除
        setError(null);
        setSaving(false);
      }
      // 新規作成の場合はポーリング中のため、ここではエラーをクリアしない
    } catch (err) {
      console.error('Error saving camera:', err);
      setDeployingRtsp(false);
      
      // エラーメッセージの詳細化
      let errorMessage = 'カメラの保存に失敗しました。';
      
      if (err.response?.data?.detail) {
        errorMessage = err.response.data.detail;
      } else if (err.message) {
        errorMessage = err.message;
      }
      
      setError(errorMessage);
      setSaving(false);
    }
  };

  // コレクター編集
  const handleCollectorEdit = (collector = null) => {
    setCollectorDialog({
      open: true,
      data: collector || {
        camera_id: cameraId,
        collector: '',
        collector_mode: 'image',
        cloudformation_stack: '',
        capture_cron: '0 * * * *',
        capture_image_interval: 5,
        capture_video_duration: 60
      },
      isEdit: !!collector
    });
  };

  const handleCollectorSave = async (collectorData) => {
    try {
      if (collectorDialog.isEdit) {
        // collector_idを使用
        await updateCameraCollector(
          collectorData.collector_id,
          collectorData
        );
      } else {
        await createCameraCollector(collectorData);
      }
      
      // コレクター一覧を再取得（Detectorをネストして）
      const collectorsData = await getCameraCollectors(cameraId);
      const collectorsWithDetectors = await Promise.all(
        collectorsData.map(async (collector) => {
          try {
            const detectorsData = await getCameraDetectors(cameraId, collector.collector_id, null);
            return {
              ...collector,
              detectors: detectorsData.detectors || []
            };
          } catch (err) {
            console.warn("Detectors fetch failed for %s:", collector.collector, err);
            return {
              ...collector,
              detectors: []
            };
          }
        })
      );
      setCollectors(collectorsWithDetectors);
      setCollectorDialog({ open: false, data: null, isEdit: false });
      
    } catch (err) {
      console.error('Error saving collector:', err);
      setError(t('pages:cameraEdit.collectorSaveFailed'));
    }
  };

  // Detector追加ハンドラー（新規）
  const handleDetectorAdd = (collector) => {
    // コレクター情報のみ渡す（Detector のデフォルト値は DetectorDialog 内で設定）
    setDetectorDialog({
      open: true,
      data: {
        camera_id: cameraId,
        collector_id: collector.collector_id,
        collector_name: collector.collector_name || collector.collector,
        collector_mode: collector.collector_mode || 'image',
      },
      isEdit: false
    });
  };

  // Detector編集ハンドラー（修正）
  const handleDetectorEdit = (detector, collector) => {
    setDetectorDialog({
      open: true,
      data: {
        ...detector,
        collector_id: collector.collector_id,
        collector_name: collector.collector_name || collector.collector,
        collector_mode: collector.collector_mode || 'image'  // コレクターモードを渡す
      },
      isEdit: true
    });
  };

  const generateTagFields = (selectedTags) => {
    const tagList = Array.isArray(selectedTags) ? selectedTags.map(tag => tag.tag_name).join('|') : '';
    const tagPrompt = Array.isArray(selectedTags) ? selectedTags.map(tag => `${tag.tag_prompt}→${tag.tag_name}`).join('|') : '';
    const tagIdList = Array.isArray(selectedTags) ? selectedTags.map(tag => tag.tag_id) : [];
    
    return { tagList, tagPrompt, tagIdList };
  };

  const handleDetectorSave = async (detectorData) => {
    try {
      // tag_data, collector_nameを除外してAPIに送信
      const { tag_data, collector_name, ...saveData } = detectorData;
      console.log('API送信直前:', saveData);
      
      if (detectorDialog.isEdit) {
        await updateDetector(detectorData.detector_id, saveData);
      } else {
        await createDetector(saveData);
      }
      
      // コレクター一覧を再取得（Detectorをネストして）
      const collectorsData = await getCameraCollectors(cameraId);
      const collectorsWithDetectors = await Promise.all(
        collectorsData.map(async (collector) => {
          try {
            const detectorsData = await getCameraDetectors(cameraId, collector.collector_id, null);
            return {
              ...collector,
              detectors: detectorsData.detectors || []
            };
          } catch (err) {
            console.warn("Detectors fetch failed for %s:", collector.collector, err);
            return {
              ...collector,
              detectors: []
            };
          }
        })
      );
      
      setCollectors(collectorsWithDetectors);
      setDetectorDialog({ open: false, data: null, isEdit: false });
    } catch (err) {
      console.error('Error saving detector:', err);
      setError(t('pages:cameraEdit.detectorSaveFailed'));
    }
  };

  const handleDetectorDelete = async (detector, collector) => {
    if (!window.confirm(`Detector "${detector.detector}" を削除しますか？`)) {
      return;
    }
    
    try {
      await deleteDetector(detector.detector_id);
      
      // コレクター一覧を再取得（Detectorをネストして）
      const collectorsData = await getCameraCollectors(cameraId);
      const collectorsWithDetectors = await Promise.all(
        collectorsData.map(async (c) => {
          try {
            const detectorsData = await getCameraDetectors(cameraId, c.collector_id, null);
            return {
              ...c,
              detectors: detectorsData.detectors || []
            };
          } catch (err) {
            return { ...c, detectors: [] };
          }
        })
      );
      
      setCollectors(collectorsWithDetectors);
    } catch (err) {
      console.error('Error deleting detector:', err);
      setError(t('pages:cameraEdit.detectorDeleteFailed'));
    }
  };

  // カメラ削除
  const handleDeleteCamera = async () => {
    try {
      setSaving(true);
      await deleteCamera(cameraId, true); // cascade=true
      setDeleteDialogOpen(false);
      navigate('/'); // 一覧画面へ遷移
    } catch (err) {
      setError(t('pages:cameraEdit.cameraDeleteFailed'));
      setDeleteDialogOpen(false);
    } finally {
      setSaving(false);
    }
  };


  if (loading) {
    return (
      <PageLayout>
        <TitleArea
          title={isNewCamera ? t('pages:cameraEdit.newCamera') : t('pages:cameraEdit.title')}
          backTo="/"
        />
        <Box
          sx={{
            marginTop: `${HEADER_HEIGHT + TITLE_AREA_HEIGHT}px`,
            overflow: 'auto',
            height: `calc(100vh - ${HEADER_HEIGHT + TITLE_AREA_HEIGHT}px)`,
          }}
        >
          <Container maxWidth="lg" sx={{ py: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'center', my: 4 }}>
              <CircularProgress />
            </Box>
          </Container>
        </Box>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      {/* TitleArea */}
      <TitleArea
        title={isNewCamera ? t('pages:cameraEdit.newCamera') : t('pages:cameraEdit.title')}
        backTo="/"
        rightContent={
          <>
            {!isNewCamera && (
              <Button
                variant="outlined"
                color="error"
                onClick={() => setDeleteDialogOpen(true)}
                disabled={saving}
                size="small"
              >
                {t('pages:cameraEdit.delete')}
              </Button>
            )}
            <Button
              variant="contained"
              startIcon={<SaveIcon />}
              onClick={handleSaveCamera}
              disabled={saving || deployingRtsp}
              size="small"
            >
              {deployingRtsp ? t('pages:cameraEdit.deploying') : saving ? t('pages:cameraEdit.saving') : t('pages:cameraEdit.save')}
            </Button>
          </>
        }
      />

      {/* Main Content */}
      <Box
        sx={{
          marginTop: `${HEADER_HEIGHT + TITLE_AREA_HEIGHT}px`,
          overflow: 'auto',
          height: `calc(100vh - ${HEADER_HEIGHT + TITLE_AREA_HEIGHT}px)`,
        }}
      >
        <Container maxWidth="lg" sx={{ py: 3 }}>
        {/* エラー表示 */}
        {error && (
          <Alert 
            severity={deployingRtsp ? "info" : "error"} 
            sx={{ mb: 3 }}
          >
            {error}
          </Alert>
        )}

        {/* 基本情報 */}
        <CameraBasicInfoSection
          camera={camera}
          places={places}
          isNewCamera={isNewCamera}
          onChange={handleCameraChange}
          t={t}
        />
        
        {/* 接続情報 */}
        <CameraConnectionInfoSection
          camera={camera}
          isNewCamera={isNewCamera}
          onChange={handleCameraChange}
          t={t}
        />
        
        {/* カメラエンドポイント設定 - Kinesis選択時のみ表示 */}
        {camera.type === 'kinesis' && (
          <CameraEndpointSection
            camera={camera}
            isNewCamera={isNewCamera}
            onChange={handleCameraChange}
            onEndpointChange={handleEndpointChange}
            t={t}
          />
        )}
        
        {/* 既存カメラのみコレクター管理を表示 */}
        {!isNewCamera && (
          <CollectorManagement
            collectors={collectors}
            onEdit={handleCollectorEdit}
            onDetectorAdd={handleDetectorAdd}
            onDetectorEdit={handleDetectorEdit}
            onDetectorDelete={handleDetectorDelete}
            t={t}
          />
        )}
        {/* コレクター編集ダイアログ */}
        <CollectorDialog
          open={collectorDialog.open}
          data={collectorDialog.data}
          isEdit={collectorDialog.isEdit}
          camera={camera}
          onSave={handleCollectorSave}
          onDelete={async (deletedCollector) => {
            // 削除されたコレクターに紐づくDetectorDialogが開いている場合は閉じる
            if (detectorDialog.open && 
                detectorDialog.data?.collector_id === deletedCollector.collector_id) {
              setDetectorDialog({ open: false, data: null, isEdit: false });
            }
            
            // コレクター一覧を再取得（Detectorをネストして）
            const collectorsData = await getCameraCollectors(cameraId);
            const collectorsWithDetectors = await Promise.all(
              collectorsData.map(async (collector) => {
                try {
                  const detectorsData = await getCameraDetectors(cameraId, collector.collector_id, null);
                  return {
                    ...collector,
                    detectors: detectorsData.detectors || []
                  };
                } catch (err) {
                  return { ...collector, detectors: [] };
                }
              })
            );
            setCollectors(collectorsWithDetectors);
          }}
          onClose={() => setCollectorDialog({ open: false, data: null, isEdit: false })}
        />
        {/* Detector編集ダイアログ */}
        <DetectorDialog
          open={detectorDialog.open}
          data={detectorDialog.data}
          isEdit={detectorDialog.isEdit}
          tags={tags}
          onSave={handleDetectorSave}
          onClose={() => setDetectorDialog({ open: false, data: null, isEdit: false })}
        />
        {/* 削除確認ダイアログ */}
        <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
          <DialogTitle>{t('pages:cameraEdit.deleteDialogTitle')}</DialogTitle>
          <DialogContent>
            <Typography dangerouslySetInnerHTML={{ __html: t('pages:cameraEdit.deleteDialogContent') }} />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDeleteDialogOpen(false)}>{t('common:cancel')}</Button>
            <Button onClick={handleDeleteCamera} color="error" variant="contained" disabled={saving}>{t('common:delete')}</Button>
          </DialogActions>
        </Dialog>
        </Container>
      </Box>
    </PageLayout>
  );
};

// [カメラエンドポイント設定]コンポーネント
const CameraEndpointSection = ({ camera, isNewCamera, onChange, onEndpointChange, t }) => (
  <Paper sx={{ p: 3, mb: 3 }}>
    <Typography variant="h6" gutterBottom>
      {t('pages:cameraEdit.endpointSettingsTitle')}
      {isNewCamera && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t('pages:cameraEdit.createTimeOnly')}
        </Typography>
      )}
    </Typography>
    <Grid container spacing={3}>
      <Grid item xs={12} md={6}>
        <FormControl fullWidth disabled={!isNewCamera}>
          <InputLabel>{t('pages:cameraEdit.endpoint')}</InputLabel>
          <Select
            value={camera.camera_endpoint || ''}
            onChange={(e) => onEndpointChange(e.target.value)}
            label={t('pages:cameraEdit.endpoint')}
            disabled={!isNewCamera}
          >
            <MenuItem value="">{t('pages:cameraEdit.none')}</MenuItem>
            <MenuItem value="rtsp">RTSP</MenuItem>
            <MenuItem value="rtmp">RTMP</MenuItem>
          </Select>
        </FormControl>
      </Grid>
      
      {/* RTSP設定フィールド */}
      {camera.camera_endpoint === 'rtsp' && (
        <>
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label={t('pages:cameraEdit.rtspUrl')}
              value={camera.rtsp_url || ''}
              onChange={(e) => onChange('rtsp_url', e.target.value)}
              disabled={!isNewCamera}
              required
              placeholder="rtsp://192.168.1.100:554/stream"
              helperText={t('pages:cameraEdit.rtspUrlHelp')}
            />
          </Grid>
          
          {/* 詳細設定（オプション） */}
          <Grid item xs={12}>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
              {t('pages:cameraEdit.advancedSettings')}
            </Typography>
          </Grid>
          
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              label={t('pages:cameraEdit.retentionPeriod')}
              type="number"
              value={camera.retention_period || '24'}
              onChange={(e) => onChange('retention_period', e.target.value)}
              disabled={!isNewCamera}
              inputProps={{ min: 1, max: 8760 }}
              helperText={t('pages:cameraEdit.retentionHelp')}
            />
          </Grid>
          
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              label={t('pages:cameraEdit.fragmentDuration')}
              type="number"
              value={camera.fragment_duration || '500'}
              onChange={(e) => onChange('fragment_duration', e.target.value)}
              disabled={!isNewCamera}
              inputProps={{ min: 100, max: 5000 }}
              helperText={t('pages:cameraEdit.fragmentHelp')}
            />
          </Grid>
          
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              label={t('pages:cameraEdit.storageSize')}
              type="number"
              value={camera.storage_size || '512'}
              onChange={(e) => onChange('storage_size', e.target.value)}
              disabled={!isNewCamera}
              inputProps={{ min: 64, max: 2048 }}
              helperText={t('pages:cameraEdit.storageHelp')}
            />
          </Grid>
        </>
      )}
      
      {/* CloudFormation スタック情報（編集時のみ表示） */}
      {!isNewCamera && camera.camera_endpoint === 'rtsp' && camera.camera_endpoint_cloudformation_stack && (
        <Grid item xs={12}>
          <Box sx={{ mt: 2, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              {t('pages:cameraEdit.deployInfo')}
            </Typography>
            <Typography variant="body2">
              {t('pages:cameraEdit.cloudformationStack')}: {camera.camera_endpoint_cloudformation_stack}
            </Typography>
            <Box sx={{ mt: 1 }}>
              <Chip 
                label={t('pages:cameraEdit.deployComplete')} 
                color="success" 
                size="small"
                sx={{ mr: 1 }}
              />
              <Typography variant="caption" color="text.secondary">
                {t('pages:cameraEdit.rtspReceiverActive')}
              </Typography>
            </Box>
          </Box>
        </Grid>
      )}
      
      {/* RTMP設定フィールド（新規作成時） */}
      {camera.camera_endpoint === 'rtmp' && isNewCamera && (
        <>
          <Grid item xs={12}>
            <Alert severity="info">
              {t('pages:cameraEdit.rtmpAutoGenerated')}
            </Alert>
          </Grid>
          
          {/* 詳細設定（オプション） */}
          <Grid item xs={12}>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
              {t('pages:cameraEdit.advancedSettings')}
            </Typography>
          </Grid>
          
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              label={t('pages:cameraEdit.retentionPeriod')}
              type="number"
              value={camera.retention_period || '24'}
              onChange={(e) => onChange('retention_period', e.target.value)}
              disabled={!isNewCamera}
              inputProps={{ min: 1, max: 8760 }}
              helperText={t('pages:cameraEdit.retentionHelp')}
            />
          </Grid>
        </>
      )}
      
      {/* RTMP情報（デプロイ完了後のみ表示） */}
      {!isNewCamera && camera.camera_endpoint === 'rtmp' && camera.rtmp_endpoint && (
        <Grid item xs={12}>
          <Box sx={{ mt: 2, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              {t('pages:cameraEdit.rtmpInfo')}
            </Typography>
            
            {/* 接続に関する注意 */}
            <Alert severity="info" sx={{ mb: 2 }}>
              {t('pages:cameraEdit.rtmpConnectionNotice')}
            </Alert>
            
            {/* フルURL（ストリームキー込み） */}
            <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
              <strong>RTMP URL:</strong> {camera.rtmp_endpoint}
            </Typography>
            
            {/* ストリームキー指定が必要なクライアント用 */}
            <Box sx={{ mt: 2, p: 1.5, bgcolor: 'grey.100', borderRadius: 1 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                {t('pages:cameraEdit.rtmpClientWithStreamKey')}
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                <strong>RTMP URL:</strong> {camera.rtmp_endpoint.split('/live/')[0] + '/live'}
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace', mt: 0.5 }}>
                <strong>{t('pages:cameraEdit.streamKey')}:</strong> {camera.rtmp_endpoint.split('/live/')[1] || camera.rtmp_stream_key}
              </Typography>
            </Box>
            
            <Typography variant="body2" sx={{ mt: 2 }}>
              {t('pages:cameraEdit.kvsStream')}: {camera.rtmp_kvs_stream_name}
            </Typography>
            <Alert severity="warning" sx={{ mt: 2 }}>
              {t('pages:cameraEdit.streamKeyWarning')}
            </Alert>
            <Box sx={{ mt: 1 }}>
              <Chip 
                label={t('pages:cameraEdit.deployComplete')} 
                color="success" 
                size="small"
              />
            </Box>
          </Box>
        </Grid>
      )}
    </Grid>
  </Paper>
);

// [基本情報]コンポーネント
const CameraBasicInfoSection = ({ camera, places, isNewCamera, onChange, t }) => (
  <Paper sx={{ p: 3, mb: 3 }}>
    <Typography variant="h6" gutterBottom>
      {t('pages:cameraEdit.basicInfo')}
    </Typography>
    <Grid container spacing={3}>
      <Grid item xs={12} md={6}>
        <TextField
          fullWidth
          label={t('pages:cameraEdit.cameraId')}
          value={camera.camera_id}
          disabled={true}
          required
        />
      </Grid>
      <Grid item xs={12} md={6}>
        <TextField
          fullWidth
          label={t('pages:cameraEdit.cameraName')}
          value={camera.name}
          onChange={(e) => onChange('name', e.target.value)}
          required
        />
      </Grid>
      <Grid item xs={12} md={6}>
        <FormControl fullWidth required disabled={!isNewCamera ? true : false}>
          <InputLabel>{t('pages:cameraEdit.place')}</InputLabel>
          <Select
            value={camera.place_id}
            onChange={(e) => onChange('place_id', e.target.value)}
            label={t('pages:cameraEdit.place')}
            disabled={!isNewCamera}
          >
            {Array.isArray(places) ? places.map((place) => (
              <MenuItem key={place.place_id} value={place.place_id}>
                {place.name}
              </MenuItem>
            )) : []}
          </Select>
        </FormControl>
      </Grid>
    </Grid>
  </Paper>
);

// [接続情報]コンポーネント
const CameraConnectionInfoSection = ({ camera, isNewCamera, onChange, t }) => {
  // RTSP/RTMPエンドポイントが選択されている場合は非活性化
  const isDisabled = !isNewCamera || camera.camera_endpoint === 'rtsp' || camera.camera_endpoint === 'rtmp';
  
  return (
    <Paper sx={{ p: 3, mb: 3 }}>
      <Typography variant="h6" gutterBottom>
        {t('pages:cameraEdit.connectionInfoTitle')}
        {(camera.camera_endpoint === 'rtsp' || camera.camera_endpoint === 'rtmp') && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {camera.camera_endpoint === 'rtsp' ? t('pages:cameraEdit.rtspAutoSet') : t('pages:cameraEdit.rtmpAutoSet')}
          </Typography>
        )}
      </Typography>
      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <FormControl fullWidth required disabled={isDisabled}>
            <InputLabel>{t('pages:cameraEdit.type')}</InputLabel>
            <Select
              value={camera.type}
              onChange={(e) => onChange('type', e.target.value)}
              label={t('pages:cameraEdit.type')}
              disabled={isDisabled}
            >
              <MenuItem value="kinesis">Kinesis</MenuItem>
              <MenuItem value="vsaas">VSaaS</MenuItem>
              <MenuItem value="s3">S3</MenuItem>
            </Select>
          </FormControl>
        </Grid>
        {camera.type === 'vsaas' && (
          <>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label={t('pages:cameraEdit.vsaasDeviceId')}
                value={camera.vsaas_device_id}
                onChange={(e) => onChange('vsaas_device_id', e.target.value)}
                disabled={isDisabled}
                required
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label={t('pages:cameraEdit.vsaasApiKey')}
                value={camera.vsaas_apikey}
                onChange={(e) => onChange('vsaas_apikey', e.target.value)}
                type="password"
                disabled={isDisabled}
                required
              />
            </Grid>
          </>
        )}
        {camera.type === 'kinesis' && (
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label={t('pages:cameraEdit.kinesisStreamArn')}
              value={camera.kinesis_streamarn}
              onChange={(e) => onChange('kinesis_streamarn', e.target.value)}
              disabled={isDisabled}
              helperText={(camera.camera_endpoint === 'rtsp' || camera.camera_endpoint === 'rtmp') ? t('pages:cameraEdit.rtspAutoGenerated') : ''}
            />
          </Grid>
        )}
        {camera.type === 's3' && (
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label={t('pages:cameraEdit.s3PathField')}
              value={camera.s3path || ''}
              onChange={(e) => onChange('s3path', e.target.value)}
              disabled={true}
              helperText={t('pages:cameraEdit.s3PathHelp')}
            />
          </Grid>
        )}
        {camera.type === 'kinesis' && camera.camera_endpoint !== 'rtsp' && camera.camera_endpoint !== 'rtmp' && (
          <>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label={t('pages:cameraEdit.awsAccessKey')}
                value={camera.aws_access_key || ''}
                onChange={(e) => onChange('aws_access_key', e.target.value)}
                disabled={isDisabled}
                helperText={t('pages:cameraEdit.awsAccessKeyHelp')}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label={t('pages:cameraEdit.awsSecretKey')}
                value={camera.aws_secret_access_key || ''}
                onChange={(e) => onChange('aws_secret_access_key', e.target.value)}
                type="password"
                disabled={isDisabled}
                helperText={t('pages:cameraEdit.awsSecretKeyHelp')}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label={t('pages:cameraEdit.awsRegion')}
                value={camera.aws_region || ''}
                onChange={(e) => onChange('aws_region', e.target.value)}
                disabled={isDisabled}
                helperText={t('pages:cameraEdit.awsRegionHelp')}
              />
            </Grid>
          </>
        )}
      </Grid>
    </Paper>
  );
};

// コレクター管理コンポーネント
// コレクター表示名を生成する関数
const getCollectorDisplayName = (collector, t) => {
  let displayName = collector.collector;
  const details = [];
  
  // hlsYoloの場合、設定値を含める
  if (collector.collector === 'hlsYolo') {
    if (collector.collect_class) {
      details.push(collector.collect_class);
    }
    if (collector.track_eventtype) {
      const eventTypeLabel = collector.track_eventtype === 'class_detect' 
        ? t('pages:cameraEdit.alwaysDetect')
        : collector.track_eventtype === 'area_detect'
        ? t('pages:cameraEdit.areaDetect')
        : collector.track_eventtype;
      details.push(eventTypeLabel);
    }
  }
  
  // 詳細情報を追加
  if (details.length > 0) {
    displayName = `${displayName} (${details.join(', ')})`;
  }
  
  // collector_idの先頭8文字を追加（識別用）
  if (collector.collector_id) {
    displayName = `${displayName} [${collector.collector_id.substring(0, 8)}]`;
  }
  
  return displayName;
};

const CollectorManagement = ({ collectors, onEdit, onDetectorAdd, onDetectorEdit, onDetectorDelete, t }) => (
  <Paper sx={{ p: 3 }}>
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
      <Typography variant="h6">
        {t('pages:cameraEdit.collectorManagementTitle')}
      </Typography>
      <Button variant="contained" startIcon={<AddIcon />} onClick={() => onEdit()}>
        {t('pages:cameraEdit.collectorAdd')}
      </Button>
    </Box>
    
    <List>
      {Array.isArray(collectors) ? collectors.map((collector, collectorIndex) => (
        <React.Fragment key={collector.collector_id}>
          {/* コレクターのヘッダー */}
          <ListItem sx={{ bgcolor: 'grey.100', borderRadius: 1, mb: 1 }}>
            <ListItemText
              primary={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                    {getCollectorDisplayName(collector, t)}
                  </Typography>
                  <Chip 
                    label={collector.collector_mode} 
                    size="small" 
                    color="primary" 
                    variant="outlined"
                  />
                </Box>
              }
              secondary={`${t('pages:cameraEdit.stack')}: ${collector.cloudformation_stack || t('pages:cameraEdit.stackNone')}`}
            />
            <ListItemSecondaryAction>
              <IconButton onClick={() => onEdit(collector)}>
                <EditIcon />
              </IconButton>
            </ListItemSecondaryAction>
          </ListItem>
          
          {/* Detectorリスト */}
          <Box sx={{ pl: 4, pr: 2, py: 1, bgcolor: 'grey.50', borderRadius: 1, mb: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Typography variant="subtitle2" color="text.secondary">
                {t('pages:cameraEdit.aiDetectionSettings')} ({t('pages:cameraEdit.aiDetectionCount', { count: collector.detectors?.length || 0 })})
              </Typography>
              <Button
                size="small"
                variant="outlined"
                startIcon={<AddIcon />}
                onClick={() => onDetectorAdd(collector)}
              >
                {t('pages:cameraEdit.detectorAdd')}
              </Button>
            </Box>
            
            {collector.detectors && collector.detectors.length > 0 ? (
              <List dense>
                {collector.detectors.map((detector) => (
                  <ListItem 
                    key={detector.detector_id}
                    sx={{ 
                      bgcolor: 'white', 
                      mb: 0.5, 
                      borderRadius: 1,
                      border: '1px solid',
                      borderColor: 'divider'
                    }}
                  >
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                          <Chip label={detector.file_type} size="small" color="info" />
                          <Typography variant="body2">
                            {detector.detector}
                          </Typography>
                        </Box>
                      }
                      secondary={detector.model}
                    />
                    <ListItemSecondaryAction>
                      <IconButton size="small" onClick={() => onDetectorEdit(detector, collector)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton 
                        size="small" 
                        color="error"
                        onClick={() => onDetectorDelete(detector, collector)}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </ListItemSecondaryAction>
                  </ListItem>
                ))}
              </List>
            ) : (
              <Typography variant="caption" color="text.secondary" sx={{ pl: 2, display: 'block', py: 1 }}>
                {t('pages:cameraEdit.noDetectorSet')}
              </Typography>
            )}
          </Box>
          
          {collectorIndex < collectors.length - 1 && <Divider sx={{ my: 2 }} />}
        </React.Fragment>
      )) : []}
    </List>
    
    {(!Array.isArray(collectors) || collectors.length === 0) && (
      <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
        {t('pages:cameraEdit.noCollectors')}
      </Typography>
    )}
  </Paper>
);

export default CameraEdit; 