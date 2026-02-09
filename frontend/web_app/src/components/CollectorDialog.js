import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Grid,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  Box,
  Typography,
  Chip,
  IconButton,
  CircularProgress,
  Alert,
  Divider
} from '@mui/material';
import { Refresh as RefreshIcon, Edit as EditIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { checkCameraCollectorDeployStatus, deleteCameraCollector } from '../services/api';
import DetectAreaEditorDialog from './DetectAreaEditorDialog';

// コレクタータイプごとに利用可能なモードを定義
const COLLECTOR_MODE_OPTIONS = {
  hlsRec: ['image', 'video', 'image_and_video'],
  hlsYolo: ['image'],  // hlsYoloは画像のみ
  s3Rec: ['image', 'video', 'image_and_video'],
  s3Yolo: ['image'],  // s3Yoloは画像のみ
};

// モード値から翻訳キーへのマッピング
const MODE_LABEL_KEYS = {
  image: 'common:image',
  video: 'common:video',
  image_and_video: 'common:imageAndVideo',
};

// デフォルトモードを取得
const getDefaultMode = (collector) => {
  const modes = COLLECTOR_MODE_OPTIONS[collector];
  return modes ? modes[0] : 'image';
};

// 指定されたコレクターで利用可能なモードを取得
const getAvailableModes = (collector) => {
  return COLLECTOR_MODE_OPTIONS[collector] || ['image', 'video', 'image_and_video'];
};

const CollectorDialog = ({ open, data, isEdit, onSave, onClose, onDelete, camera }) => {
  const { t } = useTranslation(['dialogs', 'common']);
  const [formData, setFormData] = useState({});
  const [deployStatus, setDeployStatus] = useState(null);
  const [deployLoading, setDeployLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletionStatus, setDeletionStatus] = useState(null);
  const [validationErrors, setValidationErrors] = useState([]);
  const [detectAreaEditorOpen, setDetectAreaEditorOpen] = useState(false);

  useEffect(() => {
    if (data) {
      // デフォルト値を設定
      const formDataWithDefaults = {
        ...data,
        capture_track_image_flg: data.capture_track_image_flg !== undefined 
          ? data.capture_track_image_flg 
          : true,
        capture_track_image_counter: data.capture_track_image_counter || 25,
        model_path: data.model_path || 'v9-s',
        confidence: data.confidence !== undefined ? data.confidence : 0.5
      };
      
      // hlsYoloの場合、area_detect_iou_thresholdがnull/undefinedならデフォルト値を設定
      if (data.collector === 'hlsYolo') {
        if (formDataWithDefaults.area_detect_iou_threshold === undefined || formDataWithDefaults.area_detect_iou_threshold === null) {
          formDataWithDefaults.area_detect_iou_threshold = 0.5;
        }
      }
      
      setFormData(formDataWithDefaults);
      // 編集モードでダイアログが開かれた場合は自動でデプロイ状況をチェック
      if (open && isEdit && data.camera_id && data.collector) {
        // dataを直接使用してデプロイ状況をチェック
        checkDeployStatusWithData(data);
      }
    } else {
      // 新規作成の場合 - 最小限のデフォルト値のみ
      setFormData({});
    }
    // ダイアログが閉じられた時に削除状態とバリデーションエラーをリセット
    if (!open) {
      setDeleting(false);
      setDeletionStatus(null);
      setValidationErrors([]);
    }
  }, [data, open, isEdit]);

  const checkDeployStatus = async () => {
    if (!formData.collector_id) return;
    
    try {
      setDeployLoading(true);
      // collector_idを使用
      const response = await checkCameraCollectorDeployStatus(formData.collector_id);
      setDeployStatus(response);
    } catch (error) {
      console.error('デプロイ状況の取得に失敗:', error);
      setDeployStatus({
        status: 'ERROR',
        message: 'ステータス取得エラー',
        stack_name: null
      });
    } finally {
      setDeployLoading(false);
    }
  };

  const checkDeployStatusWithData = async (targetData) => {
    if (!targetData.collector_id) return;
    
    try {
      setDeployLoading(true);
      // collector_idを使用
      const response = await checkCameraCollectorDeployStatus(targetData.collector_id);
      setDeployStatus(response);
    } catch (error) {
      console.error('デプロイ状況の取得に失敗:', error);
      setDeployStatus({
        status: 'ERROR',
        message: 'ステータス取得エラー',
        stack_name: null
      });
    } finally {
      setDeployLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(t('dialogs:collector.deleteConfirm', { name: formData.collector }))) {
      return;
    }

    try {
      setDeleting(true);
      setDeletionStatus({ status: 'DELETING', message: t('dialogs:collector.deleting') });

      // コレクター削除API呼び出し（collector_idを使用）
      await deleteCameraCollector(formData.collector_id);
      
      setDeletionStatus({ status: 'MONITORING', message: t('dialogs:collector.monitoringDeletion') });

      // スタック削除状況を監視
      await monitorStackDeletion();

      setDeletionStatus({ status: 'COMPLETED', message: t('dialogs:collector.deletionComplete') });

      // 3秒後にダイアログを閉じて親コンポーネントに通知
      setTimeout(() => {
        onDelete && onDelete(formData);
        onClose();
      }, 3000);

    } catch (error) {
      console.error('削除エラー:', error);
      
      // バックエンドからの詳細なエラーメッセージを取得
      let errorMessage = t('dialogs:collector.deletionFailed');
      
      if (error.response && error.response.data) {
        // FastAPIからのエラーレスポンス（detail フィールド）
        if (error.response.data.detail) {
          errorMessage = error.response.data.detail;
        }
        // その他のエラーレスポンス（message フィールド）
        else if (error.response.data.message) {
          errorMessage = error.response.data.message;
        }
      }
      // ネットワークエラーの場合
      else if (error.message) {
        errorMessage = `${t('dialogs:collector.error')}: ${error.message}`;
      }
      
      setDeletionStatus({ status: 'FAILED', message: errorMessage });
    } finally {
      setDeleting(false);
    }
  };

  const monitorStackDeletion = async () => {
    const maxAttempts = 60; // 最大10分間監視
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        console.log(`Stack deletion monitoring attempt ${attempts + 1}`);
        
        // collector_idを使用
        const response = await checkCameraCollectorDeployStatus(formData.collector_id);
        
        console.log('Stack status:', response);

        // スタックが見つからない場合は削除完了
        if (response.status === 'NOT_FOUND' || 
            response.message?.includes('スタックが存在しません')) {
          console.log('Stack deletion completed');
          break;
        }

        // 削除失敗の場合
        if (response.status === 'FAILED') {
          throw new Error('Stack deletion failed');
        }

        // 10秒待機
        await new Promise(resolve => setTimeout(resolve, 10000));
        attempts++;

      } catch (error) {
        // 404エラーはコレクターが削除されたことを意味するので正常終了
        if (error.response?.status === 404 || error.code === 'ERR_BAD_REQUEST') {
          console.log('Collector deleted (404 response) - deletion completed');
          break;
        }
        console.error('Stack monitoring error:', error);
        throw error;
      }
    }

    if (attempts >= maxAttempts) {
      throw new Error('Stack deletion monitoring timeout');
    }
  };

  const validateForm = (data) => {
    const errors = [];

    // s3Yoloの場合のバリデーション
    if (data.collector === 's3Yolo') {
      if (!data.collect_class || data.collect_class.trim() === '') {
        errors.push(t('dialogs:collector.errorCollectClass'));
      }

      if (data.confidence === undefined || data.confidence === null || data.confidence === '') {
        errors.push(t('dialogs:collector.errorConfidence'));
      } else {
        const conf = parseFloat(data.confidence);
        if (isNaN(conf) || conf < 0.1 || conf > 1.0) {
          errors.push(t('dialogs:collector.errorConfidenceRange'));
        }
      }
    }

    // hlsYoloの場合のみバリデーション
    if (data.collector === 'hlsYolo') {
      // 必須フィールドのチェック
      if (!data.capture_track_interval) {
        errors.push(t('dialogs:collector.errorTrackingFrequency'));
      }

      if (!data.collect_class || data.collect_class.trim() === '') {
        errors.push(t('dialogs:collector.errorCollectClass'));
      }

      if (data.confidence === undefined || data.confidence === null || data.confidence === '') {
        errors.push(t('dialogs:collector.errorConfidence'));
      } else {
        // 範囲チェック
        const conf = parseFloat(data.confidence);
        if (isNaN(conf) || conf < 0.1 || conf > 1.0) {
          errors.push(t('dialogs:collector.errorConfidenceRange'));
        }
      }

      // track_eventtypeがarea_detectの場合の追加チェック
      if (data.track_eventtype === 'area_detect') {
        if (!data.area_detect_type || data.area_detect_type === '') {
          errors.push(t('dialogs:collector.errorAreaDetectType'));
        }

        // area_detect_method は必須
        if (!data.area_detect_method || data.area_detect_method === '') {
          errors.push(t('dialogs:collector.errorAreaDetectMethod'));
        }

        if (!data.detect_area || data.detect_area.trim() === '') {
          errors.push(t('dialogs:collector.errorDetectArea'));
        } else {
          // JSON形式の検証
          try {
            const parsed = JSON.parse(data.detect_area);
            if (!Array.isArray(parsed) || parsed.length < 3) {
              errors.push(t('dialogs:collector.errorDetectAreaPoints'));
            }
          } catch (e) {
            errors.push(t('dialogs:collector.errorDetectAreaFormat'));
          }
        }
      }
    }

    return errors;
  };

  const handleChange = (field, value) => {
    let newData = {
      ...formData,
      [field]: value
    };

    // collectorが変更された場合、そのcollector固有のデフォルト値を設定
    if (field === 'collector') {
      // コレクターモードをリセット（選択されたコレクターで利用可能なモードでない場合）
      const availableModes = getAvailableModes(value);
      if (!availableModes.includes(newData.collector_mode)) {
        newData.collector_mode = getDefaultMode(value);
      }
      
      if (value === 'hlsYolo') {
        // hlsYolo固有のデフォルト値
        newData = {
          ...newData,
          capture_track_image_flg: newData.capture_track_image_flg !== undefined ? newData.capture_track_image_flg : true,
          capture_track_image_counter: newData.capture_track_image_counter || 25,
          model_path: newData.model_path || 'v9-s',
          confidence: newData.confidence !== undefined ? newData.confidence : 0.5,
          capture_track_interval: newData.capture_track_interval || 200,
          collect_class: newData.collect_class || 'person',
          track_eventtype: newData.track_eventtype || 'class_detect',
          area_detect_type: newData.area_detect_type || 'center',
          area_detect_iou_threshold: newData.area_detect_iou_threshold !== undefined ? newData.area_detect_iou_threshold : 0.5,
          area_detect_method: newData.area_detect_method || ''
        };
      }
      if (value === 's3Yolo') {
        // s3Yolo固有のデフォルト値
        newData = {
          ...newData,
          model_path: newData.model_path || 'v9-s',
          confidence: newData.confidence !== undefined ? newData.confidence : 0.5,
          collect_class: newData.collect_class || 'person',
        };
      }
      // 他のcollectorの場合は追加のデフォルト値は不要
    }

    // area_detect_typeが変更された場合、area_detect_iou_thresholdにデフォルト値を設定
    if (field === 'area_detect_type' && formData.collector === 'hlsYolo') {
      if (newData.area_detect_iou_threshold === undefined || newData.area_detect_iou_threshold === null) {
        newData.area_detect_iou_threshold = 0.5;
      }
    }

    setFormData(newData);
    
    // フィールド変更時にバリデーションエラーをクリア
    if (validationErrors.length > 0) {
      setValidationErrors([]);
    }
  };

  const handleSubmit = () => {
    // バリデーション実行
    const errors = validateForm(formData);
    
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }
    
    // バリデーションエラーをクリア
    setValidationErrors([]);
    
    // 保存前にhlsYoloの場合、area_detect_iou_thresholdがnull/undefinedならデフォルト値を設定
    let dataToSave = { ...formData };
    if (dataToSave.collector === 'hlsYolo') {
      if (dataToSave.area_detect_iou_threshold === undefined || dataToSave.area_detect_iou_threshold === null) {
        dataToSave.area_detect_iou_threshold = 0.5;
      }
    }
    
    // 保存処理
    onSave(dataToSave);
  };

  const getStatusChipProps = (status) => {
    switch (status) {
      case 'SUCCESS':
        return { color: 'success', label: t('dialogs:collector.deployComplete') };
      case 'IN_PROGRESS':
        return { color: 'info', label: t('dialogs:collector.inProgress') };
      case 'FAILED':
        return { color: 'error', label: t('dialogs:collector.failed') };
      case 'NOT_FOUND':
        return { color: 'warning', label: t('dialogs:collector.notFound') };
      case 'ERROR':
        return { color: 'error', label: t('dialogs:collector.error') };
      default:
        return { color: 'default', label: t('dialogs:collector.unknown') };
    }
  };

  // collector/collector_modeによる表示制御
  const isS3Rec = formData.collector === 's3Rec';
  const isS3Yolo = formData.collector === 's3Yolo';
  const isHlsRec = formData.collector === 'hlsRec';
  const isHlsYolo = formData.collector === 'hlsYolo';
  const mode = formData.collector_mode;

  // カメラタイプによる制御
  const cameraType = camera?.type || '';
  const isS3Camera = cameraType === 's3';

  // 既存コレクターは閲覧専用
  const readOnly = isEdit;

  return (
    <>
    <Dialog 
      open={open} 
      onClose={deleting ? undefined : onClose} 
      disableEscapeKeyDown={deleting}
      maxWidth="md" 
      fullWidth
    >
      <DialogTitle>
        {isEdit ? t('dialogs:collector.editTitle') : t('dialogs:collector.addTitle')}
      </DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 1 }}>
          {/* バリデーションエラー表示 */}
          {validationErrors.length > 0 && (
            <Grid item xs={12}>
              <Alert severity="error" sx={{ mb: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
                  {t('dialogs:collector.validationError')}
                </Typography>
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  {validationErrors.map((error, index) => (
                    <li key={index}><Typography variant="body2">{error}</Typography></li>
                  ))}
                </ul>
              </Alert>
            </Grid>
          )}
          
          {/* コレクターIDの表示（編集モードのみ） */}
          {isEdit && formData.collector_id && (
            <Grid item xs={12}>
              <Box sx={{ p: 2, backgroundColor: '#f9f9f9', borderRadius: 1, border: '1px solid #e0e0e0' }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
                  {t('dialogs:collector.collectorId')}
                </Typography>
                <Typography variant="body2" sx={{ fontFamily: 'monospace', color: 'text.primary' }}>
                  {formData.collector_id}
                </Typography>
              </Box>
            </Grid>
          )}
          
          <Grid item xs={12} md={6}>
            <FormControl fullWidth required>
              <InputLabel>{t('dialogs:collector.collector')}</InputLabel>
              <Select
                value={formData.collector || ''}
                onChange={(e) => handleChange('collector', e.target.value)}
                label={t('dialogs:collector.collector')}
                disabled={readOnly || isEdit}
              >
                <MenuItem value="hlsRec" disabled={isS3Camera}>
                  {t('dialogs:collector.hlsMedia')}
                  {isS3Camera && ` ${t('dialogs:collector.notAvailableForS3')}`}
                </MenuItem>
                <MenuItem value="hlsYolo" disabled={isS3Camera}>
                  {t('dialogs:collector.hlsMediaYolo')}
                  {isS3Camera && ` ${t('dialogs:collector.notAvailableForS3')}`}
                </MenuItem>
                <MenuItem value="s3Rec" disabled={!isS3Camera}>
                  {t('dialogs:collector.s3Media')}
                  {!isS3Camera && ` ${t('dialogs:collector.onlyForS3')}`}
                </MenuItem>
                <MenuItem value="s3Yolo" disabled={!isS3Camera}>
                  {t('dialogs:collector.s3Yolo')}
                  {!isS3Camera && ` ${t('dialogs:collector.onlyForS3')}`}
                </MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={6}>
            <FormControl fullWidth required>
              <InputLabel>{t('dialogs:collector.collectorMode')}</InputLabel>
              <Select
                value={formData.collector_mode || ''}
                onChange={(e) => handleChange('collector_mode', e.target.value)}
                label={t('dialogs:collector.collectorMode')}
                disabled={readOnly}
              >
                {getAvailableModes(formData.collector).map((mode) => (
                  <MenuItem key={mode} value={mode}>
                    {t(MODE_LABEL_KEYS[mode])}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          
          {/* CloudFormationのデプロイ状況 */}
          {isEdit && formData.camera_id && formData.collector && (
            <Grid item xs={12}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2, backgroundColor: '#f5f5f5', borderRadius: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                  {t('dialogs:collector.deployStatus')}:
                </Typography>
                {deployLoading ? (
                  <CircularProgress size={20} />
                ) : deployStatus ? (
                  <>
                    <Chip 
                      {...getStatusChipProps(deployStatus.status)}
                      variant="filled"
                      sx={{ borderRadius: 4 }}
                    />
                    <Typography variant="body2" color="text.secondary">
                      {deployStatus.message}
                    </Typography>
                  </>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {t('dialogs:collector.statusNotFetched')}
                  </Typography>
                )}
                <IconButton 
                  onClick={checkDeployStatus}
                  disabled={deployLoading}
                  size="small"
                  color="primary"
                >
                  <RefreshIcon />
                </IconButton>
              </Box>
              {deployStatus && deployStatus.stack_name && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                  {t('dialogs:collector.stackName')}: {deployStatus.stack_name}
                </Typography>
              )}
            </Grid>
          )}
          
          {/* 削除状況表示 */}
          {deletionStatus && (
            <Grid item xs={12}>
              <Alert 
                severity={
                  deletionStatus.status === 'COMPLETED' ? 'success' :
                  deletionStatus.status === 'FAILED' ? 'error' : 'info'
                }
                sx={{ mb: 2 }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {(deletionStatus.status === 'DELETING' || deletionStatus.status === 'MONITORING') && (
                    <CircularProgress size={16} />
                  )}
                  <Typography variant="body2">
                    {deletionStatus.message}
                  </Typography>
                </Box>
              </Alert>
            </Grid>
          )}

          {/* CloudFormation Stack名の表示（編集モードのみ） */}
          {isEdit && formData.cloudformation_stack && (
            <Grid item xs={12}>
              <Box sx={{ p: 2, backgroundColor: '#f9f9f9', borderRadius: 1, border: '1px solid #e0e0e0' }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
                  {t('dialogs:collector.cloudformationStack')}
                </Typography>
                <Typography variant="body2" sx={{ fontFamily: 'monospace', color: 'text.primary' }}>
                  {formData.cloudformation_stack}
                </Typography>
              </Box>
            </Grid>
          )}
          {/* s3Recの場合は下記項目を非表示 */}
          {!isS3Rec && isHlsRec && (
            <>
              {(mode === 'image' || mode === 'image_and_video') && (
                <Grid item xs={12} md={4}>
                  <TextField
                    fullWidth
                    label={t('dialogs:collector.imageInterval')}
                    type="number"
                    value={formData.capture_image_interval || ''}
                    onChange={(e) => handleChange('capture_image_interval', parseInt(e.target.value))}
                    disabled={readOnly}
                  />
                </Grid>
              )}
              {(mode === 'video' || mode === 'image_and_video') && (
                <Grid item xs={12} md={4}>
                  <TextField
                    fullWidth
                    label={t('dialogs:collector.videoDuration')}
                    type="number"
                    value={formData.capture_video_duration || ''}
                    onChange={(e) => handleChange('capture_video_duration', parseInt(e.target.value))}
                    disabled={readOnly}
                  />
                </Grid>
              )}
            </>
          )}
          
          {/* hlsYolo専用設定 */}
          {isHlsYolo && (
            <>
              <Grid item xs={12}>
                <Divider sx={{ my: 2 }}>
                  <Chip label={t('dialogs:collector.yoloTrackingSettings')} color="primary" />
                </Divider>
              </Grid>
              
              {/* トラッキング頻度 */}
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  required
                  label={t('dialogs:collector.trackingFrequency')}
                  type="number"
                  value={formData.capture_track_interval || ''}
                  onChange={(e) => handleChange('capture_track_interval', parseInt(e.target.value) || '')}
                  disabled={false}
                  helperText={t('dialogs:collector.trackingFrequencyHelp')}
                  error={validationErrors.some(e => e.includes(t('dialogs:collector.errorTrackingFrequency')))}
                />
              </Grid>
              
              {/* Confidence閾値 */}
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  required
                  label={t('dialogs:collector.confidenceThreshold')}
                  type="number"
                  value={formData.confidence !== undefined ? formData.confidence : ''}
                  onChange={(e) => {
                    const value = parseFloat(e.target.value);
                    handleChange('confidence', isNaN(value) ? '' : value);
                  }}
                  disabled={false}
                  inputProps={{ min: 0.1, max: 1.0, step: 0.05 }}
                  helperText={t('dialogs:collector.confidenceHelp')}
                  error={validationErrors.some(e => e.includes(t('dialogs:collector.errorConfidence')) || e.includes(t('dialogs:collector.errorConfidenceRange')))}
                />
              </Grid>
              
              {/* 収集対象クラス */}
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  required
                  label={t('dialogs:collector.collectClass')}
                  value={formData.collect_class || ''}
                  onChange={(e) => handleChange('collect_class', e.target.value)}
                  disabled={false}
                  helperText={t('dialogs:collector.collectClassHelp')}
                  placeholder={t('dialogs:collector.collectClassPlaceholder')}
                  error={validationErrors.some(e => e.includes(t('dialogs:collector.errorCollectClass')))}
                />
              </Grid>
              
              {/* イベント発生条件 */}
              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                  <InputLabel id="track-eventtype-label">{t('dialogs:collector.eventCondition')}</InputLabel>
                  <Select
                    labelId="track-eventtype-label"
                    value={formData.track_eventtype || ''}
                    onChange={(e) => handleChange('track_eventtype', e.target.value)}
                    label={t('dialogs:collector.eventCondition')}
                    disabled={false}
                  >
                    <MenuItem value="">{t('dialogs:collector.eventConditionNone')}</MenuItem>
                    <MenuItem value="class_detect">{t('dialogs:collector.eventConditionClassDetect')}</MenuItem>
                    <MenuItem value="area_detect">{t('dialogs:collector.eventConditionAreaDetect')}</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              
              {/* エリア判定方法 */}
              <Grid item xs={12} md={6}>
                <FormControl 
                  fullWidth
                  required={formData.track_eventtype === 'area_detect'}
                  error={validationErrors.some(e => e.includes(t('dialogs:collector.errorAreaDetectType')))}
                >
                  <InputLabel id="area-detect-type-label">
                    {formData.track_eventtype === 'area_detect' ? t('dialogs:collector.areaDetectTypeRequired') : t('dialogs:collector.areaDetectType')}
                  </InputLabel>
                  <Select
                    labelId="area-detect-type-label"
                    value={formData.area_detect_type || ''}
                    onChange={(e) => handleChange('area_detect_type', e.target.value)}
                    label={formData.track_eventtype === 'area_detect' ? t('dialogs:collector.areaDetectTypeRequired') : t('dialogs:collector.areaDetectType')}
                    disabled={false}
                  >
                    <MenuItem value="">{t('dialogs:collector.areaDetectTypeNone')}</MenuItem>
                    <MenuItem value="center">{t('dialogs:collector.areaDetectTypeCenter')}</MenuItem>
                    <MenuItem value="intersects">{t('dialogs:collector.areaDetectTypeBbox')}</MenuItem>
                    <MenuItem value="iou">{t('dialogs:collector.areaDetectTypeIou')}</MenuItem>
                  </Select>
                  {formData.track_eventtype === 'area_detect' && (
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, ml: 1.75 }}>
                      {t('dialogs:collector.areaDetectTypeHelp')}
                    </Typography>
                  )}
                </FormControl>
              </Grid>
              
              {/* IoU閾値（IoU判定の場合のみ表示） */}
              {formData.area_detect_type === 'iou' && (
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label={t('dialogs:collector.iouThreshold')}
                    type="number"
                    value={formData.area_detect_iou_threshold || ''}
                    onChange={(e) => handleChange('area_detect_iou_threshold', parseFloat(e.target.value) || '')}
                    disabled={false}
                    inputProps={{ min: 0, max: 1, step: 0.1 }}
                    helperText={t('dialogs:collector.iouThresholdHelp')}
                  />
                </Grid>
              )}
              
              {/* エリア検出判定方法（area_detect時のみ表示・必須） */}
              {formData.track_eventtype === 'area_detect' && (
                <Grid item xs={12} md={6}>
                  <FormControl 
                    fullWidth
                    required
                    error={validationErrors.some(e => e.includes(t('dialogs:collector.errorAreaDetectMethod')))}
                  >
                    <InputLabel id="area-detect-method-label">
                      {t('dialogs:collector.areaDetectMethodRequired')}
                    </InputLabel>
                    <Select
                      labelId="area-detect-method-label"
                      value={formData.area_detect_method || ''}
                      onChange={(e) => handleChange('area_detect_method', e.target.value)}
                      label={t('dialogs:collector.areaDetectMethodRequired')}
                      disabled={false}
                    >
                      <MenuItem value="">{t('dialogs:collector.areaDetectMethodNone')}</MenuItem>
                      <MenuItem value="track_ids_change">
                        {t('dialogs:collector.areaDetectMethodTrackIds')}
                      </MenuItem>
                      <MenuItem value="class_count_change">
                        {t('dialogs:collector.areaDetectMethodCount')}
                      </MenuItem>
                    </Select>
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, ml: 1.75 }}>
                      {t('dialogs:collector.areaDetectMethodHelp')}
                    </Typography>
                  </FormControl>
                </Grid>
              )}
              
              {/* 検出エリア座標 */}
              <Grid item xs={12}>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                  <TextField
                    fullWidth
                    required={formData.track_eventtype === 'area_detect'}
                    multiline
                    rows={4}
                    label={t('dialogs:collector.detectArea')}
                    value={formData.detect_area || ''}
                    onChange={(e) => handleChange('detect_area', e.target.value)}
                    disabled={false}
                    helperText={
                      formData.track_eventtype === 'area_detect'
                        ? t('dialogs:collector.detectAreaRequired')
                        : t('dialogs:collector.detectAreaHelp')
                    }
                    placeholder={t('dialogs:collector.detectAreaPlaceholder')}
                    error={validationErrors.some(e => e.includes(t('dialogs:collector.errorDetectArea')))}
                  />
                  <Button
                    variant="outlined"
                    startIcon={<EditIcon />}
                    onClick={() => setDetectAreaEditorOpen(true)}
                    sx={{ mt: 1, minWidth: 140, whiteSpace: 'nowrap' }}
                    disabled={!camera?.camera_id}
                  >
                    {t('dialogs:collector.editArea')}
                  </Button>
                </Box>
              </Grid>
              
              {/* 画像保存設定 */}
              <Grid item xs={12}>
                <Divider sx={{ my: 2 }}>
                  <Chip label={t('dialogs:collector.periodicImageSettings')} color="secondary" />
                </Divider>
              </Grid>
              
              {/* 定期画像保存フラグ */}
              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                  <InputLabel id="capture-track-image-flg-label">{t('dialogs:collector.periodicImageSave')}</InputLabel>
                  <Select
                    labelId="capture-track-image-flg-label"
                    value={formData.capture_track_image_flg !== undefined ? formData.capture_track_image_flg : true}
                    onChange={(e) => handleChange('capture_track_image_flg', e.target.value)}
                    label={t('dialogs:collector.periodicImageSave')}
                    disabled={false}
                  >
                    <MenuItem value={true}>{t('dialogs:collector.enabled')}</MenuItem>
                    <MenuItem value={false}>{t('dialogs:collector.disabled')}</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              
              {/* 画像保存頻度 */}
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label={t('dialogs:collector.imageSaveFrequency')}
                  type="number"
                  value={formData.capture_track_image_counter || ''}
                  onChange={(e) => handleChange('capture_track_image_counter', parseInt(e.target.value) || '')}
                  disabled={false}
                  helperText={t('dialogs:collector.imageSaveFrequencyHelp')}
                  inputProps={{ min: 1 }}
                />
              </Grid>
              
              {/* YOLOモデルパス */}
              <Grid item xs={12}>
                <Divider sx={{ my: 2 }}>
                  <Chip label={t('dialogs:collector.yoloModelSettings')} color="secondary" />
                </Divider>
              </Grid>
              
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label={t('dialogs:collector.yoloModelPath')}
                  value={formData.model_path || ''}
                  onChange={(e) => handleChange('model_path', e.target.value)}
                  disabled={false}
                  helperText={t('dialogs:collector.yoloModelPathHelp')}
                  placeholder={t('dialogs:collector.yoloModelPathPlaceholder')}
                />
              </Grid>
            </>
          )}
          
          {/* s3Yolo専用設定 */}
          {isS3Yolo && (
            <>
              <Grid item xs={12}>
                <Divider sx={{ my: 2 }}>
                  <Chip label={t('dialogs:collector.yoloDetectionSettings')} color="primary" />
                </Divider>
              </Grid>
              
              {/* Confidence閾値 */}
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  required
                  label={t('dialogs:collector.confidenceThreshold')}
                  type="number"
                  value={formData.confidence !== undefined ? formData.confidence : ''}
                  onChange={(e) => {
                    const value = parseFloat(e.target.value);
                    handleChange('confidence', isNaN(value) ? '' : value);
                  }}
                  inputProps={{ min: 0.1, max: 1.0, step: 0.05 }}
                  helperText={t('dialogs:collector.confidenceHelp')}
                  error={validationErrors.some(e => e.includes(t('dialogs:collector.errorConfidence')) || e.includes(t('dialogs:collector.errorConfidenceRange')))}
                />
              </Grid>
              
              {/* 収集対象クラス */}
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  required
                  label={t('dialogs:collector.collectClass')}
                  value={formData.collect_class || ''}
                  onChange={(e) => handleChange('collect_class', e.target.value)}
                  helperText={t('dialogs:collector.collectClassHelp')}
                  placeholder={t('dialogs:collector.collectClassPlaceholder')}
                  error={validationErrors.some(e => e.includes(t('dialogs:collector.errorCollectClass')))}
                />
              </Grid>
              
              {/* YOLOモデルパス */}
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  label={t('dialogs:collector.yoloModelPath')}
                  value={formData.model_path || ''}
                  onChange={(e) => handleChange('model_path', e.target.value)}
                  helperText={t('dialogs:collector.yoloModelPathHelp')}
                  placeholder={t('dialogs:collector.yoloModelPathPlaceholder')}
                />
              </Grid>
            </>
          )}
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={deleting}>{t('dialogs:collector.close')}</Button>
        {isEdit && (
          <Button 
            onClick={handleDelete} 
            color="error" 
            variant="outlined"
            disabled={deleting || (deployStatus && deployStatus.status === 'IN_PROGRESS')}
          >
            {deleting ? <CircularProgress size={20} /> : t('dialogs:collector.delete')}
          </Button>
        )}
        <Button 
          onClick={handleSubmit} 
          variant="contained"
          disabled={deleting}
        >
          {t('dialogs:collector.save')}
        </Button>
      </DialogActions>
    </Dialog>

    {/* 検出エリア編集ダイアログ - メインダイアログの外に配置 */}
    <DetectAreaEditorDialog
      open={detectAreaEditorOpen}
      onClose={() => setDetectAreaEditorOpen(false)}
      onSave={(polygonJson) => {
        handleChange('detect_area', polygonJson);
        setDetectAreaEditorOpen(false);
      }}
      initialArea={formData.detect_area}
      camera={camera}
    />
  </>
  );
};

export default CollectorDialog; 