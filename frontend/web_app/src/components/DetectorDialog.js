import React, { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Button,
  Box,
  Chip,
  Typography,
  Paper,
  List,
  ListItem,
  ListItemText,
  IconButton,
  Checkbox,
  FormControlLabel,
  Divider,
  Alert
} from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon, CloudDownload as LoadIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import TagSelectionDialog from './TagSelectionDialog';
import TagCategorySelectionDialog from './TagCategorySelectionDialog';
import { loadFromTagCategory, getTriggerEvents } from '../services/api';

// コレクターモードから利用可能なファイルタイプを取得
const FILE_TYPE_BY_COLLECTOR_MODE = {
  image: ['image'],
  video: ['video'],
  image_and_video: ['image', 'video'],
};

// ファイルタイプの翻訳キー
const FILE_TYPE_LABEL_KEYS = {
  image: 'common:image',
  video: 'common:video',
};

// 利用可能なファイルタイプを取得
const getAvailableFileTypes = (collectorMode) => {
  return FILE_TYPE_BY_COLLECTOR_MODE[collectorMode] || ['image', 'video'];
};

// デフォルトのファイルタイプを取得
const getDefaultFileType = (collectorMode) => {
  const types = getAvailableFileTypes(collectorMode);
  return types[0] || 'image';
};

/**
 * トリガーイベントごとに利用可能なファイルタイプを定義
 * - 配列に含まれるファイルタイプでのみ表示される
 * - 未定義の場合は全てのファイルタイプで表示（安全側倒れ）
 */
const TRIGGER_EVENT_FILE_TYPES = {
  'SaveImageEvent': ['image'],      // 画像ファイルタイプのみ
  'SaveVideoEvent': ['video'],      // 動画ファイルタイプのみ
  'AreaDetectEvent': ['image'],     // 画像ファイルタイプのみ
  'ClassDetectEvent': ['image'],    // 画像ファイルタイプのみ
  // 将来追加されるイベント例:
  // 'MotionDetectEvent': ['image', 'video'],  // 両方で利用可能
};

/**
 * ファイルタイプに基づいてトリガーイベントをフィルタリング
 * @param {Array} events - APIから取得したトリガーイベント配列
 * @param {string} fileType - 選択されたファイルタイプ ('image' | 'video')
 * @returns {Array} フィルタリングされたトリガーイベント配列
 */
const filterTriggerEventsByFileType = (events, fileType) => {
  return events.filter(event => {
    const allowedFileTypes = TRIGGER_EVENT_FILE_TYPES[event.value];
    
    // マッピングが未定義の場合は全て許可（安全側倒れ）
    if (!allowedFileTypes || allowedFileTypes.length === 0) {
      return true;
    }
    
    // 指定されたファイルタイプが許可リストに含まれているか
    return allowedFileTypes.includes(fileType);
  });
};

/**
 * ファイルタイプに基づいてデフォルトのトリガーイベントを取得
 * @param {string} fileType - ファイルタイプ ('image' | 'video')
 * @returns {string} デフォルトのトリガーイベント
 */
const getDefaultTriggerEvent = (fileType) => {
  if (fileType === 'video') {
    return 'SaveVideoEvent';
  }
  return 'SaveImageEvent';
};

const DetectorDialog = ({ open, data, isEdit, tags, onSave, onClose }) => {
  const { t } = useTranslation(['dialogs', 'common']);
  const [formData, setFormData] = useState({});
  const [tagPromptList, setTagPromptList] = useState([]);
  const [tagSelectionOpen, setTagSelectionOpen] = useState(false);
  const [categorySelectionOpen, setCategorySelectionOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [validationError, setValidationError] = useState('');
  const [availableTriggerEvents, setAvailableTriggerEvents] = useState([
    { value: 'SaveImageEvent', label: 'SaveImageEvent（画像保存時）' },
    { value: 'SaveVideoEvent', label: 'SaveVideoEvent（動画保存時）' }
  ]);

  useEffect(() => {
    if (data) {
      // 編集モード（detector が存在する場合）
      if (data.detector) {
        setFormData({ ...data });
        
        // tag_prompt_listから tagPromptList を復元
        if (data.tag_prompt_list && Array.isArray(data.tag_prompt_list)) {
          setTagPromptList(data.tag_prompt_list);
        } else if (data.tag_prompt_list && typeof data.tag_prompt_list === 'object') {
          // Setの場合は配列に変換
          setTagPromptList(Object.values(data.tag_prompt_list));
        } else {
          setTagPromptList([]);
        }
      } else {
        // 新規作成モード（コレクター情報のみ渡された場合）
        const collectorMode = data.collector_mode || 'image';
        const defaultFileType = getDefaultFileType(collectorMode);
        const defaultModel = defaultFileType === 'video' 
          ? 'apac.amazon.nova-pro-v1:0' 
          : 'global.anthropic.claude-sonnet-4-20250514-v1:0';
        const defaultTriggerEvent = getDefaultTriggerEvent(defaultFileType);
        
        setFormData({
          ...data,  // camera_id, collector_id, collector_name, collector_mode
          file_type: defaultFileType,
          detector: 'bedrock',
          model: defaultModel,
          max_tokens: 4000,
          temperature: '',  // 任意項目（空欄許容）
          top_p: '',        // 任意項目（空欄許容）
          detect_interval: 5000,
          trigger_event: defaultTriggerEvent,
          system_prompt: '',
          detect_prompt: ''
        });
        setTagPromptList([]);
      }
    } else {
      // data が null の場合（通常は発生しない）
      setFormData({});
      setTagPromptList([]);
    }
    setValidationError('');
  }, [data]);

  // collector_idに基づいてトリガーイベントリストを取得
  useEffect(() => {
    const fetchTriggerEvents = async () => {
      if (formData.collector_id) {
        try {
          const response = await getTriggerEvents(formData.collector_id);
          if (response && response.trigger_events) {
            setAvailableTriggerEvents(response.trigger_events);
          }
        } catch (error) {
          console.error('Error fetching trigger events:', error);
          // エラー時はデフォルトの基本イベントのみ
          setAvailableTriggerEvents([
            { value: 'SaveImageEvent', label: 'SaveImageEvent（画像保存時）' },
            { value: 'SaveVideoEvent', label: 'SaveVideoEvent（動画保存時）' }
          ]);
        }
      }
    };

    fetchTriggerEvents();
  }, [formData.collector_id]);

  // モデルのデフォルト値を取得する関数
  const getDefaultModel = (fileType) => {
    if (fileType === 'video') {
      return 'apac.amazon.nova-pro-v1:0';
    }
    // 画像の場合
    return 'global.anthropic.claude-sonnet-4-20250514-v1:0';
  };

  const handleChange = (field, value) => {
    setFormData(prev => {
      const newData = {
      ...prev,
      [field]: value
      };
      
      // file_typeが変更された場合、モデルとトリガーイベントを更新
      if (field === 'file_type') {
        newData.model = getDefaultModel(value);
        
        // トリガーイベントのリセット（新しいファイルタイプで利用不可の場合）
        const currentTriggerEvent = prev.trigger_event;
        const allowedFileTypes = TRIGGER_EVENT_FILE_TYPES[currentTriggerEvent];
        
        // 現在選択中のトリガーイベントが新しいファイルタイプで利用不可の場合
        if (allowedFileTypes && allowedFileTypes.length > 0 && !allowedFileTypes.includes(value)) {
          newData.trigger_event = getDefaultTriggerEvent(value);
        }
      }
      
      return newData;
    });
    
    // バリデーションエラーをクリア
    if (validationError) {
      setValidationError('');
    }
    
    // Detectorレベルのcompare_file_flgが変更された場合の処理
    if (field === 'compare_file_flg') {
      if (!value) {
        // OFFにした場合、全てのタグのcompare_file_flgをOFFにする
        setTagPromptList(prev => 
          prev.map(item => ({ ...item, compare_file_flg: false }))
        );
      }
    }
  };

  // タグカテゴリからのロード
  const handleLoadFromCategory = async (selectedCategory) => {
    try {
      setLoading(true);
      const loadedData = await loadFromTagCategory(selectedCategory.tagcategory_id);
      
      // フォームデータを更新
      setFormData(prev => ({
        ...prev,
        system_prompt: loadedData.system_prompt || '',
        detect_prompt: loadedData.detect_prompt || ''
      }));
      
      // タグリストを更新
      if (loadedData.tag_prompt_list) {
        setTagPromptList(Object.values(loadedData.tag_prompt_list));
      }
      
      console.log(`タグカテゴリ「${loadedData.category_name}」から${loadedData.tags_count}個のタグをロードしました`);
    } catch (error) {
      console.error('Error loading from category:', error);
      // エラーハンドリング（必要に応じてアラート表示など）
    } finally {
      setLoading(false);
    }
  };

  // タグ追加
  const handleTagAdd = (selectedTag) => {
    const newTagItem = {
      tag_id: selectedTag.tag_id,
      tag_name: selectedTag.tag_name,
      tag_prompt: selectedTag.tag_prompt || '',
      notify_flg: false,
      compare_file_flg: false  // デフォルトOFF
    };
    
    // 重複チェック
    const exists = tagPromptList.some(item => item.tag_id === selectedTag.tag_id);
    if (!exists) {
      setTagPromptList(prev => [...prev, newTagItem]);
    }
  };

  // タグ削除
  const handleTagRemove = (index) => {
    setTagPromptList(prev => prev.filter((_, i) => i !== index));
  };

  // タグ項目の更新
  const handleTagPromptChange = (index, field, value) => {
    setTagPromptList(prev => 
      prev.map((item, i) => 
        i === index ? { ...item, [field]: value } : item
      )
    );
  };

  const handleSubmit = () => {
    // バリデーション
    if (!isEdit) {
      // 新規作成時のバリデーション
      if (!formData.collector_id) {
        setValidationError(t('dialogs:detector.errorCollectorId'));
        return;
      }
      if (!formData.file_type) {
        setValidationError(t('dialogs:detector.errorFileType'));
        return;
      }
      if (!formData.detector) {
        setValidationError(t('dialogs:detector.errorDetector'));
        return;
      }
      // Custom Detector選択時: Lambda ARNが必須
      if (formData.detector === 'custom' && !formData.lambda_endpoint_arn) {
        setValidationError(t('dialogs:detector.errorLambdaArn'));
        return;
      }
      if (!formData.model) {
        setValidationError(t('dialogs:detector.errorModel'));
        return;
      }
    }

    // tag_prompt_list をセット形式で送信用に変換
    const tagPromptListForSave = tagPromptList.reduce((acc, item, index) => {
      acc[index] = item;
      return acc;
    }, {});

    // tag_list を生成（パイプ区切り）
    const tagList = tagPromptList.map(item => item.tag_name).join('|');

    const saveData = {
      ...formData,
      tag_prompt_list: tagPromptListForSave, // Set形式
      tag_list: tagList // パイプ区切り文字列
    };
    
    // temperature/top_pが空文字の場合はnullに変換（任意項目）
    if (saveData.temperature === '' || saveData.temperature === undefined) {
      saveData.temperature = null;
    }
    if (saveData.top_p === '' || saveData.top_p === undefined) {
      saveData.top_p = null;
    }
    
    // collector_nameは送信しない（表示用のみ）
    delete saveData.collector_name;

    console.log('送信するデータ:', saveData);
    onSave(saveData);
  };

  // 編集時はコレクター・ファイルタイプ・Detectorを編集不可
  const readOnly = isEdit;

  return (
    <>
      <Dialog 
        open={open} 
        onClose={onClose} 
        maxWidth="xl" 
        fullWidth
        sx={{ '& .MuiDialog-paper': { height: '90vh', maxHeight: '90vh' } }}
      >
        <DialogTitle>
          {isEdit ? t('dialogs:detector.editTitle') : t('dialogs:detector.addTitle')}
        </DialogTitle>
        <DialogContent sx={{ overflow: 'auto' }}>
          {validationError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {validationError}
            </Alert>
          )}
          <Grid container spacing={2} sx={{ mt: 1 }}>
            {/* 検知IDの表示（編集モードのみ） */}
            {isEdit && formData.detector_id && (
              <Grid item xs={12}>
                <Box sx={{ p: 2, backgroundColor: '#f9f9f9', borderRadius: 1, border: '1px solid #e0e0e0' }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
                    {t('dialogs:detector.detectorId')}
                  </Typography>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', color: 'text.primary' }}>
                    {formData.detector_id}
                  </Typography>
                </Box>
              </Grid>
            )}
            
            <Grid item xs={12}>
              <Box sx={{ p: 2, bgcolor: 'grey.100', borderRadius: 1 }}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  {t('dialogs:detector.collector')}
                </Typography>
                <Typography variant="body1" sx={{ fontWeight: 'medium' }}>
                  {formData.collector_name || 'N/A'}
                </Typography>
              </Box>
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth required>
                <InputLabel>{t('dialogs:detector.fileType')}</InputLabel>
                <Select
                  value={formData.file_type || ''}
                  onChange={(e) => handleChange('file_type', e.target.value)}
                  label={t('dialogs:detector.fileType')}
                  disabled={readOnly}
                  error={!isEdit && !formData.file_type && !!validationError}
                >
                  {getAvailableFileTypes(formData.collector_mode).map((fileType) => (
                    <MenuItem key={fileType} value={fileType}>
                      {t(FILE_TYPE_LABEL_KEYS[fileType])}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth required>
                <InputLabel>{t('dialogs:detector.detector')}</InputLabel>
                <Select
                  value={formData.detector || ''}
                  onChange={(e) => handleChange('detector', e.target.value)}
                  label={t('dialogs:detector.detector')}
                  disabled={readOnly || formData.detector === 'collector-internal'}
                  error={!isEdit && !formData.detector && !!validationError}
                >
                  <MenuItem value="bedrock">bedrock</MenuItem>
                  <MenuItem value="custom">custom</MenuItem>
                  {formData.detector === 'collector-internal' && (
                    <MenuItem value="collector-internal">collector-internal</MenuItem>
                  )}
                </Select>
              </FormControl>
            </Grid>
            
            {/* 検出間隔 */}
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label={t('dialogs:detector.detectInterval')}
                type="number"
                value={formData.detect_interval !== undefined ? formData.detect_interval : 5000}
                onChange={(e) => handleChange('detect_interval', parseInt(e.target.value) || 5000)}
                helperText={t('dialogs:detector.detectIntervalHelp')}
                inputProps={{ min: 100, max: 60000, step: 100 }}
              />
            </Grid>
            
            {/* トリガーイベント */}
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>{t('dialogs:detector.triggerEvent')}</InputLabel>
                <Select
                  value={formData.trigger_event || getDefaultTriggerEvent(formData.file_type)}
                  onChange={(e) => handleChange('trigger_event', e.target.value)}
                  label={t('dialogs:detector.triggerEvent')}
                >
                  {filterTriggerEventsByFileType(availableTriggerEvents, formData.file_type).map((event) => (
                    <MenuItem key={event.value} value={event.value}>
                      {event.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            
            {/* Lambda ARN入力欄（常時表示、custom以外は入力不可） */}
            <Grid item xs={12}>
              <TextField
                fullWidth
                label={t('dialogs:detector.lambdaArn')}
                value={formData.lambda_endpoint_arn || ''}
                onChange={(e) => handleChange('lambda_endpoint_arn', e.target.value)}
                required={formData.detector === 'custom'}
                disabled={formData.detector !== 'custom'}
                error={!isEdit && formData.detector === 'custom' && !formData.lambda_endpoint_arn && !!validationError}
                helperText={
                  formData.detector === 'bedrock' 
                    ? t('dialogs:detector.lambdaArnHelpBedrock')
                    : formData.detector === 'custom'
                    ? t('dialogs:detector.lambdaArnHelpCustom')
                    : t('dialogs:detector.lambdaArnHelpDefault')
                }
                placeholder={t('dialogs:detector.lambdaArnPlaceholder')}
              />
            </Grid>
            
            {/* Bedrock専用設定（bedrockモード時のみ表示） */}
            {formData.detector === 'bedrock' && (
              <>
                <Grid item xs={12}>
                  <Divider sx={{ my: 2 }}>
                    <Chip label={t('dialogs:detector.bedrockSettings')} color="primary" />
                  </Divider>
                </Grid>

                <Grid item xs={12}>
                  <Box sx={{ 
                    p: 3, 
                    borderRadius: 2, 
                    border: '2px solid #2196f3'
                  }}>
                    <Grid container spacing={2}>
                      <Grid item xs={12} md={6}>
                        <TextField
                          fullWidth
                          label={t('dialogs:detector.model')}
                          value={formData.model || ''}
                          onChange={(e) => handleChange('model', e.target.value)}
                          required
                          error={!isEdit && !formData.model && !!validationError}
                          helperText={t('dialogs:detector.modelSizeWarning')}
                          FormHelperTextProps={{
                            sx: { color: 'warning.main', fontWeight: 'bold' }
                          }}
                        />
                      </Grid>

                      {/* AIモデルパラメータ設定 */}
                      <Grid item xs={12} md={4}>
                        <TextField
                          fullWidth
                          label={t('dialogs:detector.maxTokens')}
                          type="number"
                          value={formData.max_tokens !== undefined ? formData.max_tokens : 4000}
                          onChange={(e) => handleChange('max_tokens', e.target.value)}
                          helperText={t('dialogs:detector.maxTokensHelp')}
                          inputProps={{ min: 1, max: 8000 }}
                        />
                      </Grid>
                      <Grid item xs={12} md={4}>
                        <TextField
                          fullWidth
                          label={t('dialogs:detector.temperature')}
                          type="number"
                          value={formData.temperature ?? ''}
                          onChange={(e) => handleChange('temperature', e.target.value)}
                          helperText={t('dialogs:detector.temperatureHelp')}
                          inputProps={{ min: 0, max: 1, step: 0.1 }}
                          placeholder="0.0 - 1.0（空欄可）"
                        />
                      </Grid>
                      <Grid item xs={12} md={4}>
                        <TextField
                          fullWidth
                          label={t('dialogs:detector.topP')}
                          type="number"
                          value={formData.top_p ?? ''}
                          onChange={(e) => handleChange('top_p', e.target.value)}
                          helperText={t('dialogs:detector.topPHelp')}
                          inputProps={{ min: 0, max: 1, step: 0.05 }}
                          placeholder="0.0 - 1.0（空欄可）"
                        />
                      </Grid>

                      {/* タグカテゴリからのロードボタンとファイル比較フラグ */}
                      <Grid item xs={12}>
                        <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 2, my: 2 }}>
                          <FormControlLabel
                            control={
                              <Checkbox
                                checked={formData.compare_file_flg || false}
                                onChange={(e) => handleChange('compare_file_flg', e.target.checked)}
                              />
                            }
                            label={t('dialogs:detector.compareFile')}
                          />
                          <Button
                            variant="outlined"
                            startIcon={<LoadIcon />}
                            onClick={() => setCategorySelectionOpen(true)}
                            disabled={loading}
                            size="large"
                          >
                            {t('dialogs:detector.loadFromCategory')}
                          </Button>
                        </Box>
                        <Divider sx={{ my: 2 }} />
                      </Grid>

                      <Grid item xs={12}>
                        <TextField
                          fullWidth
                          multiline
                          rows={3}
                          label={t('dialogs:detector.systemPrompt')}
                          value={formData.system_prompt || ''}
                          onChange={(e) => handleChange('system_prompt', e.target.value)}
                        />
                      </Grid>
                      <Grid item xs={12}>
                        <TextField
                          fullWidth
                          multiline
                          rows={3}
                          label={t('dialogs:detector.detectPrompt')}
                          value={formData.detect_prompt || ''}
                          onChange={(e) => handleChange('detect_prompt', e.target.value)}
                        />
                      </Grid>

                      {/* タグとタグ出力判定基準セクション */}
                      <Grid item xs={12}>
                        <Paper sx={{ p: 2, mt: 2 }}>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                            <Typography variant="h6">
                              {t('dialogs:detector.tagSettings')}
                            </Typography>
                            <Button
                              variant="contained"
                              startIcon={<AddIcon />}
                              onClick={() => setTagSelectionOpen(true)}
                            >
                              {t('dialogs:detector.addTag')}
                            </Button>
                          </Box>

                          {tagPromptList.length === 0 ? (
                            <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
                              {t('dialogs:detector.noTags')}
                            </Typography>
                          ) : (
                            <List>
                              {tagPromptList.map((tagItem, index) => (
                                <ListItem key={`${tagItem.tag_id}-${index}`} sx={{ border: 1, borderColor: 'divider', borderRadius: 1, mb: 1 }}>
                                  <Grid container spacing={2} alignItems="center" sx={{ width: '100%' }}>
                                    <Grid item xs={12} sm={2}>
                                      <Chip 
                                        label={tagItem.tag_name} 
                                        color="primary" 
                                        variant="outlined"
                                      />
                                    </Grid>
                                    <Grid item xs={12} sm={5}>
                                      <TextField
                                        fullWidth
                                        multiline
                                        rows={2}
                                        label={t('dialogs:detector.outputCriteria')}
                                        value={tagItem.tag_prompt}
                                        onChange={(e) => handleTagPromptChange(index, 'tag_prompt', e.target.value)}
                                        size="small"
                                      />
                                    </Grid>
                                    <Grid item xs={12} sm={2}>
                                      <FormControlLabel
                                        control={
                                          <Checkbox
                                            checked={tagItem.notify_flg || false}
                                            onChange={(e) => handleTagPromptChange(index, 'notify_flg', e.target.checked)}
                                          />
                                        }
                                        label={t('dialogs:detector.notify')}
                                      />
                                    </Grid>
                                    <Grid item xs={12} sm={2}>
                                      <FormControlLabel
                                        control={
                                          <Checkbox
                                            checked={tagItem.compare_file_flg || false}
                                            onChange={(e) => handleTagPromptChange(index, 'compare_file_flg', e.target.checked)}
                                            disabled={!formData.compare_file_flg}
                                          />
                                        }
                                        label={t('dialogs:detector.compareFileShort')}
                                      />
                                    </Grid>
                                    <Grid item xs={12} sm={1}>
                                      <IconButton
                                        color="error"
                                        onClick={() => handleTagRemove(index)}
                                      >
                                        <DeleteIcon />
                                      </IconButton>
                                    </Grid>
                                  </Grid>
                                </ListItem>
                              ))}
                            </List>
                          )}
                        </Paper>
                      </Grid>
                    </Grid>
                  </Box>
                </Grid>
              </>
            )}
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('dialogs:detector.cancel')}</Button>
          <Button onClick={handleSubmit} variant="contained">
            {t('dialogs:detector.save')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* タグ選択ダイアログ */}
      <TagSelectionDialog
        open={tagSelectionOpen}
        onClose={() => setTagSelectionOpen(false)}
        onTagSelect={handleTagAdd}
      />

      {/* タグカテゴリ選択ダイアログ */}
      <TagCategorySelectionDialog
        open={categorySelectionOpen}
        onClose={() => setCategorySelectionOpen(false)}
        onCategorySelect={handleLoadFromCategory}
      />
    </>
  );
};

export default DetectorDialog; 