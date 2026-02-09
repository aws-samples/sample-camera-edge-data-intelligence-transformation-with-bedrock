import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { 
  Container, 
  Typography, 
  Box, 
  Paper, 
  Card, 
  CardContent, 
  Chip, 
  Pagination, 
  CircularProgress, 
  Alert,
  Button,
  TextField,
  Autocomplete,
  Divider,
  Fade,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Slider,
  FormLabel,
  Grid,
  ToggleButtonGroup,
  ToggleButton,
  useTheme,
  useMediaQuery,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  RadioGroup,
  FormControlLabel,
  Radio
} from '@mui/material';
import { Search as SearchIcon, Clear, FilterList, CloudUpload, ArrowForward } from '@mui/icons-material';
import { Link } from 'react-router-dom';
import PageLayout from '../components/PageLayout';
import TitleArea from '../components/TitleArea';
import { searchNotifications, getDetectorTags, getSearchOptions } from '../services/api';
import BookmarkButton from '../components/BookmarkButton';
import { useTheme as useMuiTheme } from '@mui/material/styles';
import { HEADER_HEIGHT, TITLE_AREA_HEIGHT } from '../constants/layout';
import { convertLocalToUTC, formatUTCWithTimezone, convertDateToUTC, getCurrentTimezone } from '../utils/timezone';
import { useTranslation } from 'react-i18next';

// ✅ SearchFormComponentを外部に移動
const SearchFormComponent = ({ 
  searchText, 
  setSearchText, 
  selectedTags, 
  setSelectedTags,
  availableTags,
  tagSearchMode,
  setTagSearchMode,
  selectedPlace,
  setSelectedPlace,
  selectedCamera,
  setSelectedCamera,
  selectedCollector,
  setSelectedCollector,
  selectedFileType,
  setSelectedFileType,
  selectedDetector,
  setSelectedDetector,
  detectNotifyFlg,
  setDetectNotifyFlg,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  searchOptions,
  filteredCameras,
  handleSearch,
  handleClearSearch,
  isSearching,
  hasSearched,
  isMobile,
  theme,
  t
}) => (
  <Paper sx={{ 
    p: 3, 
    border: '1px solid #e0e0e0',
    height: 'fit-content',
    position: isMobile ? 'static' : 'sticky',
    top: isMobile ? 'auto' : theme.spacing(2)
  }}>
    <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <FilterList />
      {t('pages:search.searchConditions')}
    </Typography>
    
    <Grid container spacing={2}>
      {/* 基本検索 */}
      <Grid item xs={12}>
        <Divider sx={{ my: 1 }} />
        <Typography variant="subtitle2" gutterBottom>
          {t('pages:search.basicSearch')}
        </Typography>
      </Grid>
      
      <Grid item xs={12}>
        <TextField
          fullWidth
          size="small"
          label={t('pages:search.searchKeyword')}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder={t('pages:search.keywordPlaceholder')}
          onKeyPress={(e) => {
            if (e.key === 'Enter') {
              handleSearch();
            }
          }}
        />
      </Grid>
      
      <Grid item xs={12}>
        <Typography variant="caption" color="text.secondary" gutterBottom component="div">
          {t('pages:search.tagSearchMode')}
        </Typography>
        <ToggleButtonGroup
          value={tagSearchMode}
          exclusive
          onChange={(e, value) => value && setTagSearchMode(value)}
          size="small"
          sx={{ mb: 1 }}
        >
          <ToggleButton value="AND">AND</ToggleButton>
          <ToggleButton value="OR">OR</ToggleButton>
        </ToggleButtonGroup>
        
        <Typography variant="caption" color="text.secondary" gutterBottom component="div">
          {t('pages:search.filterByTags', { count: availableTags.length })}
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
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
      </Grid>

      <Grid item xs={12}>
        <Divider sx={{ my: 1 }} />
        <Typography variant="subtitle2" gutterBottom>
          {t('pages:search.advancedSearch')}
        </Typography>
      </Grid>

      <Grid item xs={12}>
        <FormControl fullWidth size="small">
          <InputLabel>{t('common:place')}</InputLabel>
          <Select
            value={selectedPlace}
            label={t('common:place')}
            onChange={(e) => {
              setSelectedPlace(e.target.value);
              setSelectedCamera(''); // 場所が変更されたらカメラをリセット
            }}
          >
            <MenuItem value="">{t('common:all')}</MenuItem>
            {searchOptions.places.map((place) => (
              <MenuItem key={place.place_id} value={place.place_id}>
                {place.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Grid>

      <Grid item xs={12}>
        <FormControl fullWidth size="small">
          <InputLabel>{t('common:camera')}</InputLabel>
          <Select
            value={selectedCamera}
            label={t('common:camera')}
            onChange={(e) => setSelectedCamera(e.target.value)}
          >
            <MenuItem value="">{t('common:all')}</MenuItem>
            {filteredCameras.map((camera) => (
              <MenuItem key={camera.camera_id} value={camera.camera_id}>
                {camera.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Grid>

      <Grid item xs={12}>
        <FormControl fullWidth size="small">
          <InputLabel>{t('common:collector')}</InputLabel>
          <Select
            value={selectedCollector}
            label={t('common:collector')}
            onChange={(e) => setSelectedCollector(e.target.value)}
          >
            <MenuItem value="">{t('common:all')}</MenuItem>
            {searchOptions.collectors.map((collector) => (
              <MenuItem key={collector} value={collector}>
                {collector}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Grid>

      <Grid item xs={12}>
        <FormControl fullWidth size="small">
          <InputLabel>{t('common:fileType')}</InputLabel>
          <Select
            value={selectedFileType}
            label={t('common:fileType')}
            onChange={(e) => setSelectedFileType(e.target.value)}
          >
            <MenuItem value="">{t('common:all')}</MenuItem>
            <MenuItem value="image">{t('common:image')}</MenuItem>
            <MenuItem value="video">{t('common:video')}</MenuItem>
          </Select>
        </FormControl>
      </Grid>

      <Grid item xs={12}>
        <FormControl fullWidth size="small">
          <InputLabel>{t('pages:search.notifyFlag')}</InputLabel>
          <Select
            value={detectNotifyFlg}
            label={t('pages:search.notifyFlag')}
            onChange={(e) => setDetectNotifyFlg(e.target.value)}
          >
            <MenuItem value="">{t('common:all')}</MenuItem>
            <MenuItem value="true">{t('pages:search.notified')}</MenuItem>
            <MenuItem value="false">{t('pages:search.notNotified')}</MenuItem>
          </Select>
        </FormControl>
      </Grid>

      <Grid item xs={12}>
        <FormControl fullWidth size="small">
          <InputLabel>{t('common:detector')}</InputLabel>
          <Select
            value={selectedDetector}
            label={t('common:detector')}
            onChange={(e) => setSelectedDetector(e.target.value)}
          >
            <MenuItem value="">{t('common:all')}</MenuItem>
            {searchOptions.detectors.map((detector) => (
              <MenuItem key={detector} value={detector}>
                {detector}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Grid>

      <Grid item xs={12}>
        <TextField
          fullWidth
          size="small"
          label={t('pages:search.startDateTime')}
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          placeholder={t('pages:search.dateTimePlaceholder')}
          helperText={t('pages:search.dateTimeFormat')}
        />
      </Grid>

      <Grid item xs={12}>
        <TextField
          fullWidth
          size="small"
          label={t('pages:search.endDateTime')}
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          placeholder={t('pages:search.dateTimePlaceholder')}
          helperText={t('pages:search.dateTimeFormat')}
        />
      </Grid>

      {/* 検索ボタン */}
      <Grid item xs={12}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Button
            variant="contained"
            startIcon={<SearchIcon />}
            onClick={handleSearch}
            disabled={isSearching}
            fullWidth
          >
            {t('pages:search.searchButton')}
          </Button>
          
          {hasSearched && (
            <Fade in={hasSearched}>
              <Button
                variant="outlined"
                startIcon={<Clear />}
                onClick={handleClearSearch}
                fullWidth
                sx={{ 
                  bgcolor: 'warning.light', 
                  color: 'warning.contrastText',
                  '&:hover': { bgcolor: 'warning.main' }
                }}
              >
                {t('pages:search.clear')}
              </Button>
            </Fade>
          )}
        </Box>
      </Grid>
    </Grid>
  </Paper>
);

// MediaDisplayComponent を追加（SearchResultsComponent の前に）
const MediaDisplayComponent = ({ notification }) => {
  const { t } = useTranslation(['pages', 'common']);
  if (!notification.presigned_url) {
    return (
      <Box sx={{ 
        p: 2, 
        border: '1px dashed #ccc', 
        borderRadius: 1, 
        textAlign: 'center',
        color: 'text.secondary'
      }}>
        <Typography variant="body2">
          {t('pages:search.mediaUnavailable')}
        </Typography>
      </Box>
    );
  }

  if (notification.file_type === 'image') {
    return (
      <Box sx={{ mb: 2 }}>
        <img
          src={notification.presigned_url}
          alt={`${notification.camera_name} - ${notification.start_time}`}
          style={{
            width: '100%',
            maxWidth: '400px',
            height: 'auto',
            borderRadius: '8px',
            border: '1px solid #e0e0e0'
          }}
          onError={(e) => {
            e.target.style.display = 'none';
            e.target.nextSibling.style.display = 'block';
          }}
        />
        <Box sx={{ display: 'none', p: 2, border: '1px dashed #ccc', borderRadius: 1, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            {t('pages:search.imageLoadFailed')}
          </Typography>
        </Box>
      </Box>
    );
  }

  if (notification.file_type === 'video') {
    return (
      <Box sx={{ mb: 2 }}>
        <video
          controls
          style={{
            width: '100%',
            maxWidth: '400px',
            height: 'auto',
            borderRadius: '8px',
            border: '1px solid #e0e0e0'
          }}
          onError={(e) => {
            e.target.style.display = 'none';
            e.target.nextSibling.style.display = 'block';
          }}
        >
          <source src={notification.presigned_url} type="video/mp4" />
          {t('pages:search.videoNotSupported')}
        </video>
        <Box sx={{ display: 'none', p: 2, border: '1px dashed #ccc', borderRadius: 1, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            {t('pages:search.videoLoadFailed')}
          </Typography>
        </Box>
      </Box>
    );
  }

  return null;
};

// ✅ SearchResultsComponentも外部に移動
const SearchResultsComponent = ({
  hasSearched,
  searchText,
  selectedTags,
  selectedPlace,
  selectedCamera,
  selectedCollector,
  selectedFileType,
  selectedDetector,
  detectNotifyFlg,
  startDate,
  endDate,
  searchOptions,
  pagination,
  isSearching,
  error,
  notifications,
  generateNotificationUrl,
  handlePageChange,
  formatDateTime,
  handleExportClick
}) => {
  const { t } = useTranslation(['pages', 'common']);
  const navigate = useNavigate();
  const theme = useMuiTheme();

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

  return (
    <Box>
      {/* 検索結果の表示 */}
      {hasSearched && (
        <Alert severity="info" sx={{ mb: 2 }}>
          <Typography variant="body2">
            {t('pages:search.searchExecuted')}: 
            {searchText && ` ${t('pages:search.keyword')}「${searchText}」`}
            {selectedTags.length > 0 && ` ${t('pages:search.tags')}「${selectedTags.join(', ')}」`}
            {selectedPlace && ` ${t('pages:search.place')}「${searchOptions.places.find(p => p.place_id === selectedPlace)?.name}」`}
            {selectedCamera && ` ${t('pages:search.camera')}「${searchOptions.cameras.find(c => c.camera_id === selectedCamera)?.name}」`}
            {selectedCollector && ` ${t('pages:search.collector')}「${selectedCollector}」`}
            {selectedFileType && ` ${t('pages:search.type')}「${selectedFileType}」`}
            {selectedDetector && ` ${t('pages:search.detector')}「${selectedDetector}」`}
            {detectNotifyFlg && ` ${t('pages:search.notifyFlagLabel')}「${detectNotifyFlg === 'true' ? t('pages:search.notifiedLabel') : t('pages:search.notNotifiedLabel')}」`}
            {(startDate || endDate) && ` ${t('pages:search.period')}「${startDate || t('pages:search.startNone')} ～ ${endDate || t('pages:search.endNone')}」`}
          </Typography>
        </Alert>
      )}
      
      {pagination.total_count !== undefined && (
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="body2" color="text.secondary">
            {t('pages:search.resultsCount', { count: pagination.total_count })}
          </Typography>
          {pagination.total_count > 0 && (
            <Button
              variant="contained"
              startIcon={<CloudUpload />}
              onClick={handleExportClick}
              sx={{ 
                bgcolor: 'success.light',
                color: 'success.contrastText',
                '&:hover': { 
                  bgcolor: 'success.main',
                  color: 'white'
                }
              }}
            >
              {t('pages:search.exportToS3')}
            </Button>
          )}
        </Box>
      )}

      {isSearching ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
          <Typography variant="body2" sx={{ ml: 2, alignSelf: 'center' }}>
            {t('pages:search.searching')}
          </Typography>
        </Box>
      ) : error ? (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      ) : !hasSearched ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="h6" color="text.secondary">
            {t('pages:search.setConditions')}
          </Typography>
        </Paper>
      ) : notifications.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="h6" color="text.secondary">
            {t('pages:search.noResults')}
          </Typography>
        </Paper>
      ) : (
        <>
          <Box sx={{ mb: 3 }}>
            {notifications.map((notification, index) => (
              <Card 
                key={notification.detect_log_id || index}
                sx={{ 
                  mb: 3, 
                  border: '1px solid #e0e0e0',
                  borderRadius: 2,
                  position: 'relative',
                  '&:hover': {
                    boxShadow: 6,
                    borderColor: 'primary.main'
                  }
                }}
              >
                <CardContent
                  sx={{
                    textDecoration: 'none',
                    color: 'inherit',
                    display: 'block',
                    pb: 2
                  }}
                >
                  {/* ヘッダー部分 */}
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                        {notification.place_name}
                      </Typography>
                      <Typography variant="body1" color="text.secondary">
                        {notification.camera_name}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5 }}>
                      <Typography variant="body2" color="text.secondary">
                        {t('pages:search.startLabel')}: {formatDateTime(notification.start_time)}
                      </Typography>
                      {notification.end_time && (
                        <Typography variant="body2" color="text.secondary">
                          {t('pages:search.endLabel')}: {formatDateTime(notification.end_time)}
                        </Typography>
                      )}
                      {notification._score && (
                        <Typography variant="caption" color="primary">
                          {t('pages:search.relevance')}: {notification._score.toFixed(2)}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                  
                  {/* ID情報 */}
                  <Grid container spacing={1} sx={{ mb: 2 }}>
                    <Grid item xs={12} sm={6}>
                      <Typography variant="caption" color="text.secondary">
                        {t('pages:search.detectLogId')}: {notification.detect_log_id}
                      </Typography>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <Typography variant="caption" color="text.secondary">
                        {t('pages:search.fileId')}: {notification.file_id}
                      </Typography>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <Typography variant="caption" color="text.secondary">
                        {t('pages:search.detectorId')}: {notification.detector_id}
                      </Typography>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <Typography variant="caption" color="text.secondary">
                        {t('pages:search.placeId')}: {notification.place_id}
                      </Typography>
                    </Grid>
                  </Grid>

                  {/* 検出結果と通知理由 */}
                  {notification.detect_result && (
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="subtitle2" color="text.secondary">
                        {t('pages:search.detectionResult')}:
                      </Typography>
                      <Typography variant="body2" sx={{ ml: 1 }}>
                        {notification.detect_result}
                      </Typography>
                    </Box>
                  )}

                  {notification.detect_notify_reason && (
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="subtitle2" color="text.secondary">
                        {t('pages:search.notifyReason')}:
                      </Typography>
                      <Typography variant="body2" sx={{ ml: 1 }}>
                        {notification.detect_notify_reason}
                      </Typography>
                    </Box>
                  )}

                  {/* S3パス情報 */}
                  {notification.s3path && (
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="caption" color="text.secondary">
                        {t('pages:search.s3Path')}: 
                      </Typography>
                      <Typography variant="caption" sx={{ wordBreak: 'break-all', ml: 1 }}>
                        {notification.s3path}
                      </Typography>
                    </Box>
                  )}
                  
                  {/* ステータスとタグ */}
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                    <Chip 
                      label={notification.detector} 
                      size="small" 
                      variant="outlined" 
                      color="primary"
                    />
                    <Chip 
                      label={notification.file_type} 
                      size="small" 
                      variant="outlined"
                    />
                    <Chip 
                      label={notification.collector} 
                      size="small" 
                      variant="outlined"
                      color="secondary"
                    />
                    <Chip 
                      label={notification.detect_notify_flg === 'true' ? t('pages:search.notifiedLabel') : t('pages:search.notNotifiedLabel')} 
                      size="small" 
                      variant="filled"
                      color={notification.detect_notify_flg === 'true' ? 'success' : 'warning'}
                    />
                    {notification.detect_tag && notification.detect_tag.map((tag, tagIndex) => (
                      <Chip 
                        key={tagIndex}
                        label={tag} 
                        size="small" 
                        variant="filled"
                        color="info"
                      />
                    ))}
                  </Box>

                  {/* デバッグ情報（旧スキーマフィールドは削除） */}

                  {/* メディア表示を追加 */}
                  <MediaDisplayComponent notification={notification} />

                  {/* 右下にボタン2つ並べる */}
                  <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 2 }}>
                    <BookmarkButton
                      bookmarkData={{
                        ...notification,
                        datetime: notification.datetime || notification.start_time || undefined
                      }}
                      variant="button"
                      tooltip={t('pages:search.bookmark')}
                      buttonProps={{
                        variant: 'outlined',
                        color: 'warning',
                        size: 'small',
                        sx: {
                          backgroundColor: 'white',
                          color: theme.palette.warning.main,
                          borderColor: theme.palette.warning.main,
                          minWidth: 150,
                          width: 150,
                          justifyContent: 'center',
                          '&:hover': {
                            backgroundColor: theme.palette.warning.light,
                            borderColor: theme.palette.warning.main,
                            color: theme.palette.warning.main
                          }
                        }
                      }}
                    >
                      {t('pages:search.bookmark')}
                    </BookmarkButton>
                    <Button
                      variant="outlined"
                      color="warning"
                      size="small"
                      startIcon={<ArrowForward />}
                      onClick={() => navigate(generateNotificationUrl(notification))}
                      sx={{
                        backgroundColor: 'white',
                        color: theme.palette.warning.main,
                        borderColor: theme.palette.warning.main,
                        minWidth: 150,
                        width: 150,
                        justifyContent: 'center',
                        '&:hover': {
                          backgroundColor: theme.palette.warning.light,
                          borderColor: theme.palette.warning.main,
                          color: theme.palette.warning.main
                        }
                      }}
                    >
                      {t('pages:search.detail')}
                    </Button>
                  </Box>
                </CardContent>
              </Card>
            ))}
          </Box>

          {/* ページネーション */}
          {pagination.total_pages > 1 && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
              <Pagination
                count={pagination.total_pages}
                page={pagination.current_page}
                onChange={handlePageChange}
                color="primary"
                size="large"
                showFirstButton
                showLastButton
              />
            </Box>
          )}
        </>
      )}
    </Box>
  );
};

// ExportDialogComponent を追加
const ExportDialogComponent = ({ 
  open, 
  onClose, 
  exportPath, 
  setExportPath,
  exportFormat,
  setExportFormat,
  notificationEmail,
  setNotificationEmail,
  handleExport,
  totalCount,
  t
}) => (
  <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
    <DialogTitle>
      {t('pages:search.exportDialog.title')}
    </DialogTitle>
    <DialogContent>
      <Box sx={{ pt: 1 }}>
        <Alert severity="info" sx={{ mb: 3 }}>
          {t('pages:search.exportDialog.exportCount', { count: totalCount })}
        </Alert>
        
        <TextField
          fullWidth
          label={t('pages:search.exportDialog.s3PathLabel')}
          value={exportPath}
          onChange={(e) => setExportPath(e.target.value)}
          placeholder={t('pages:search.exportDialog.s3PathPlaceholder')}
          helperText={t('pages:search.exportDialog.s3PathHelp')}
          sx={{ mb: 3 }}
        />

        <FormControl fullWidth sx={{ mb: 3 }}>
          <FormLabel component="legend">{t('pages:search.exportDialog.formatLabel')}</FormLabel>
          <RadioGroup
            value={exportFormat}
            onChange={(e) => setExportFormat(e.target.value)}
          >
            <FormControlLabel value="YOLO" control={<Radio />} label="YOLO" />
            <FormControlLabel value="COCO" control={<Radio />} label="COCO" />
            <FormControlLabel value="VoTT_CSV" control={<Radio />} label="VoTT CSV" />
            <FormControlLabel value="TFRecord" control={<Radio />} label="TFRecord" />
          </RadioGroup>
        </FormControl>

        <TextField
          fullWidth
          label={t('pages:search.exportDialog.emailLabel')}
          value={notificationEmail}
          onChange={(e) => setNotificationEmail(e.target.value)}
          placeholder={t('pages:search.exportDialog.emailPlaceholder')}
          helperText={t('pages:search.exportDialog.emailHelp')}
          type="email"
        />
      </Box>
    </DialogContent>
    <DialogActions>
      <Button onClick={onClose}>
        {t('common:cancel')}
      </Button>
      <Button 
        onClick={handleExport} 
        variant="contained" 
        startIcon={<CloudUpload />}
        disabled={!exportPath || !exportFormat || !notificationEmail}
      >
        {t('pages:search.exportDialog.exportButton')}
      </Button>
    </DialogActions>
  </Dialog>
);

const Search = () => {
  const { t } = useTranslation(['pages', 'common']);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [searchParams, setSearchParams] = useSearchParams();
  const [notifications, setNotifications] = useState([]);
  const [pagination, setPagination] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // 検索フォーム関連のstate
  const [searchText, setSearchText] = useState('');
  const [selectedTags, setSelectedTags] = useState([]);
  const [availableTags, setAvailableTags] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [tagSearchMode, setTagSearchMode] = useState('AND');

  // 高度な検索条件
  const [selectedPlace, setSelectedPlace] = useState('');
  const [selectedCamera, setSelectedCamera] = useState('');
  const [selectedCollector, setSelectedCollector] = useState('');
  const [selectedFileType, setSelectedFileType] = useState('');
  const [selectedDetector, setSelectedDetector] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [detectNotifyFlg, setDetectNotifyFlg] = useState('');

  // エクスポート関連のstate
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportPath, setExportPath] = useState('');
  const [exportFormat, setExportFormat] = useState('YOLO');
  const [notificationEmail, setNotificationEmail] = useState('');

  // 検索オプション
  const [searchOptions, setSearchOptions] = useState({
    places: [],
    cameras: [],
    collectors: [],
    detectors: [],
    file_types: []
  });

  // URLパラメータからページ番号を取得
  const currentPage = parseInt(searchParams.get('page')) || 1;

  // カメラのフィルタリング（選択された場所に基づく）
  const filteredCameras = selectedPlace 
    ? searchOptions.cameras.filter(camera => camera.place_id === selectedPlace)
    : searchOptions.cameras;

  // 利用可能なタグを取得
  const fetchAvailableTags = useCallback(async () => {
    try {
      console.log('Fetching available tags...');
      const data = await getDetectorTags(); // 新しいAPIを使用
      console.log('Available tags received:', data.tags);
      setAvailableTags(data.tags || []);
    } catch (err) {
      console.error('Error fetching available tags:', err);
    }
  }, []);

  // 検索オプションを取得
  const fetchSearchOptions = useCallback(async () => {
    try {
      console.log('Fetching search options...');
      const data = await getSearchOptions();
      console.log('Search options received:', data);
      setSearchOptions(data);
    } catch (err) {
      console.error('Error fetching search options:', err);
    }
  }, []);

  // 初期化
  useEffect(() => {
    fetchAvailableTags();
    fetchSearchOptions();
  }, [fetchAvailableTags, fetchSearchOptions]);

  // 検索実行
  const executeSearch = async (page = 1) => {
    setIsSearching(true);
    setError(null);
    
    try {
      const searchParamsObj = {
        query: searchText,
        tags: selectedTags,
        tag_search_mode: tagSearchMode,
        page,
        limit: 20,
        place_id: selectedPlace || null,
        camera_id: selectedCamera || null,
        collector: selectedCollector || null,
        file_type: selectedFileType || null,
        detector: selectedDetector || null,
        detect_notify_flg: detectNotifyFlg || null,
        start_date: startDate || null,
        end_date: endDate || null
      };

      console.log('Executing search with params:', searchParamsObj);
      const data = await searchNotifications(searchParamsObj);
      console.log('Search results received:', data);
      setNotifications(data.results || []);
      setPagination(data.pagination || {});
      setHasSearched(true);
    } catch (err) {
      console.error('Error executing search:', err);
      setError('検索の実行に失敗しました');
      setNotifications([]);
      setPagination({});
    } finally {
      setIsSearching(false);
    }
  };

  // ページが変更された時の処理
  useEffect(() => {
    if (hasSearched) {
      executeSearch(currentPage);
    }
  }, [currentPage]);

  // ページネーション変更時の処理
  const handlePageChange = (event, value) => {
    setSearchParams({ page: value.toString() });
  };

  // 検索実行
  const handleSearch = () => {
    setSearchParams({ page: '1' });
    executeSearch(1);
  };

  // 検索リセット
  const handleClearSearch = () => {
    setSearchText('');
    setSelectedTags([]);
    setTagSearchMode('AND');
    setSelectedPlace('');
    setSelectedCamera('');
    setSelectedCollector('');
    setSelectedFileType('');
    setSelectedDetector('');
    setDetectNotifyFlg('');
    setStartDate('');
    setEndDate('');
    setNotifications([]);
    setPagination({});
    setHasSearched(false);
    setSearchParams({ page: '1' });
  };

  // エクスポート関連のハンドラー
  const handleExportClick = () => {
    setExportDialogOpen(true);
  };

  const handleExportDialogClose = () => {
    setExportDialogOpen(false);
  };

  const handleExport = () => {
    // TODO: 実際のエクスポート処理を実装
    console.log('Export started with params:', {
      path: exportPath,
      format: exportFormat,
      email: notificationEmail,
      searchParams: {
        query: searchText,
        tags: selectedTags,
        tag_search_mode: tagSearchMode,
        place_id: selectedPlace || null,
        camera_id: selectedCamera || null,
        collector: selectedCollector || null,
        file_type: selectedFileType || null,
        detector: selectedDetector || null,
        detect_notify_flg: detectNotifyFlg || null,
        start_date: startDate || null,
        end_date: endDate || null
      }
    });
    
    // ダイアログを閉じる
    setExportDialogOpen(false);
    
    // フィールドをリセット
    setExportPath('');
    setExportFormat('YOLO');
    setNotificationEmail('');
    
    // TODO: 成功メッセージを表示
    alert('エクスポートを開始しました。完了時にメールで通知されます。');
  };

  // 時刻をフォーマット
  const formatDateTime = (utcIsoString) => {
    if (!utcIsoString) return '';
    // UTCをユーザーのタイムゾーンに変換して表示
    const formatted = formatUTCWithTimezone(utcIsoString, 'YYYY-MM-DD HH:mm:ss');
    return formatted || utcIsoString;
  };

  // 通知URL生成処理
  const generateNotificationUrl = (notification) => {
    console.log('=== generateNotificationUrl DEBUG ===');
    console.log('Full notification object:', notification);
    
    const { camera_id, file_id, detector_id, file_type, collector_id, start_time } = notification;
    
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
      console.warn('❌ Missing required notification data, using simple navigation');
      console.warn('Missing fields:', {
        camera_id: !camera_id ? 'MISSING' : 'OK',
        file_id: !file_id ? 'MISSING' : 'OK',
        detector_id: !detector_id ? 'MISSING' : 'OK',
        file_type: !file_type ? 'MISSING' : 'OK',
        collector_id: !collector_id ? 'MISSING' : 'OK',
        start_time: !start_time ? 'MISSING' : 'OK'
      });
      if (notification.camera_id) {
        return `/camera/${notification.camera_id}`;
      }
      return '#'; // fallback
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

  return (
    <PageLayout>
      {/* TitleArea */}
      <TitleArea
        title={t('pages:search.title')}
        backTo="/"
        rightContent={
          <>
            <Button
              variant="outlined"
              startIcon={<Clear />}
              onClick={handleClearSearch}
              disabled={!hasSearched}
              size="small"
            >
              {t('pages:search.clear')}
            </Button>
            <Button
              variant="contained"
              startIcon={<SearchIcon />}
              onClick={handleSearch}
              disabled={isSearching}
              size="small"
            >
              {isSearching ? t('pages:search.searching') : t('pages:search.searchButton')}
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
        <Container maxWidth={false} sx={{ py: 3, maxWidth: "2000px", mx: "auto" }}>
        {/* レスポンシブレイアウト */}
        <Grid container spacing={3}>
          {/* 検索フォーム */}
          <Grid item xs={12} md={3}>
            <SearchFormComponent
              searchText={searchText}
              setSearchText={setSearchText}
              selectedTags={selectedTags}
              setSelectedTags={setSelectedTags}
              availableTags={availableTags}
              tagSearchMode={tagSearchMode}
              setTagSearchMode={setTagSearchMode}
              selectedPlace={selectedPlace}
              setSelectedPlace={setSelectedPlace}
              selectedCamera={selectedCamera}
              setSelectedCamera={setSelectedCamera}
              selectedCollector={selectedCollector}
              setSelectedCollector={setSelectedCollector}
              selectedFileType={selectedFileType}
              setSelectedFileType={setSelectedFileType}
              selectedDetector={selectedDetector}
              setSelectedDetector={setSelectedDetector}
              detectNotifyFlg={detectNotifyFlg}
              setDetectNotifyFlg={setDetectNotifyFlg}
              startDate={startDate}
              setStartDate={setStartDate}
              endDate={endDate}
              setEndDate={setEndDate}
              searchOptions={searchOptions}
              filteredCameras={filteredCameras}
              handleSearch={handleSearch}
              handleClearSearch={handleClearSearch}
              isSearching={isSearching}
              hasSearched={hasSearched}
              isMobile={isMobile}
              theme={theme}
              t={t}
            />
          </Grid>
          
          {/* 検索結果 */}
          <Grid item xs={12} md={9}>
            <SearchResultsComponent
              hasSearched={hasSearched}
              searchText={searchText}
              selectedTags={selectedTags}
              selectedPlace={selectedPlace}
              selectedCamera={selectedCamera}
              selectedCollector={selectedCollector}
              selectedFileType={selectedFileType}
              selectedDetector={selectedDetector}
              detectNotifyFlg={detectNotifyFlg}
              startDate={startDate}
              endDate={endDate}
              searchOptions={searchOptions}
              pagination={pagination}
              isSearching={isSearching}
              error={error}
              notifications={notifications}
              generateNotificationUrl={generateNotificationUrl}
              handlePageChange={handlePageChange}
              formatDateTime={formatDateTime}
              handleExportClick={handleExportClick}
            />
          </Grid>
        </Grid>
        
        {/* エクスポートダイアログ */}
        <ExportDialogComponent
          open={exportDialogOpen}
          onClose={handleExportDialogClose}
          exportPath={exportPath}
          setExportPath={setExportPath}
          exportFormat={exportFormat}
          setExportFormat={setExportFormat}
          notificationEmail={notificationEmail}
          setNotificationEmail={setNotificationEmail}
          handleExport={handleExport}
          totalCount={pagination.total_count || 0}
          t={t}
        />
        </Container>
      </Box>
    </PageLayout>
  );
};

export default Search; 