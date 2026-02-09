import React, { useState, useEffect } from 'react';
import {
  Container,
  Typography,
  Box,
  Paper,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Grid,
  Card,
  CardMedia,
  CardContent,
  CardActions,
  Button,
  Alert,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Chip,
  ToggleButton,
  ToggleButtonGroup,
  Divider,
  Tooltip
} from '@mui/material';
import {
  Delete as DeleteIcon, 
  Bookmark as BookmarkIcon,
  PlayArrow as PlayIcon,
  Image as ImageIcon,
  ViewModule as ViewModuleIcon,
  ViewList as ViewListIcon,
  CameraAlt as CameraIcon,
  ChevronLeft,
  ChevronRight,
  ViewColumn as ViewColumnIcon,
  Description as DescriptionIcon,
  Close as CloseIcon,
  ArrowForward
} from '@mui/icons-material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageLayout from '../components/PageLayout';
import TitleArea from '../components/TitleArea';
import { getUserBookmarks, deleteBookmark, deleteBookmarkDetail, getBookmarkDetails } from '../services/api';
import ReportCreate from '../components/ReportCreate';
import { HEADER_HEIGHT, TITLE_AREA_HEIGHT } from '../constants/layout';
import { formatUTCWithTimezone } from '../utils/timezone';
import { useTranslation } from 'react-i18next';

const Bookmark = () => {
  const { t } = useTranslation(['pages', 'common']);
  const [bookmarks, setBookmarks] = useState([]);
  const [selectedBookmark, setSelectedBookmark] = useState(null);
  const [bookmarkDetails, setBookmarkDetails] = useState([]);
  const [loading, setLoading] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [bookmarkToDelete, setBookmarkToDelete] = useState(null);
  const [detailDeleteDialogOpen, setDetailDeleteDialogOpen] = useState(false);
  const [detailToDelete, setDetailToDelete] = useState(null);
  const [groupByCamera, setGroupByCamera] = useState(false);  // カメラ別グループ表示
  const [showCompactView, setShowCompactView] = useState(true);  // コンパクトビュー（デフォルト有効）
  const [isBookmarkListCollapsed, setIsBookmarkListCollapsed] = useState(false);  // ブックマーク一覧の折りたたみ
  const [viewMode, setViewMode] = useState('normal');  // 表示モード: 'normal', 'two-column'
  const [isInitialized, setIsInitialized] = useState(false);  // 初期化完了フラグ
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [reportDialogOpen, setReportDialogOpen] = useState(false);

  // URLパラメータを更新
  const updateURL = (newParams) => {
    const params = new URLSearchParams(searchParams);
    Object.entries(newParams).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== '') {
        params.set(key, value.toString());
      } else {
        params.delete(key);
      }
    });
    setSearchParams(params, { replace: true });
  };

  // ブックマーク一覧を取得
  const fetchBookmarks = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getUserBookmarks();
      setBookmarks(data);
      return data;
    } catch (err) {
      console.error('Error fetching bookmarks:', err);
      setError(t('pages:bookmark.fetchListFailed'));
      return [];
    } finally {
      setLoading(false);
    }
  };

  // ブックマーク詳細を取得
  const fetchBookmarkDetails = async (bookmarkId) => {
    try {
      setDetailsLoading(true);
      setError(null);
      const data = await getBookmarkDetails(bookmarkId);
      setBookmarkDetails(data);
    } catch (err) {
      console.error('Error fetching bookmark details:', err);
      setError(t('pages:bookmark.fetchDetailsFailed'));
    } finally {
      setDetailsLoading(false);
    }
  };

  // URLパラメータから状態を初期化
  const initializeFromURL = async (bookmarksData) => {
    const bookmarkId = searchParams.get('bookmark');
    const group = searchParams.get('group') === 'true';
    const view = searchParams.get('view') || 'normal';
    const compact = searchParams.get('compact') !== 'false'; // デフォルトtrue
    const collapsed = searchParams.get('collapsed') === 'true';

    console.log('Initializing from URL:', { bookmarkId, group, view, compact, collapsed });

    // 表示設定を復帰
    setGroupByCamera(group);
    setViewMode(view);
    setShowCompactView(compact);
    setIsBookmarkListCollapsed(collapsed);

    // ブックマーク選択を復帰
    if (bookmarkId && bookmarksData.length > 0) {
      const targetBookmark = bookmarksData.find(b => b.bookmark_id === bookmarkId);
      if (targetBookmark) {
        console.log('Found target bookmark:', targetBookmark);
        setSelectedBookmark(targetBookmark);
        await fetchBookmarkDetails(targetBookmark.bookmark_id);
      } else {
        console.log('Bookmark not found, selecting first bookmark');
        // 指定されたブックマークが見つからない場合は最初のブックマークを選択
        setSelectedBookmark(bookmarksData[0]);
        await fetchBookmarkDetails(bookmarksData[0].bookmark_id);
        updateURL({ bookmark: bookmarksData[0].bookmark_id });
      }
    } else if (bookmarksData.length > 0) {
      // URLパラメータがない場合は最初のブックマークを選択
      console.log('No bookmark in URL, selecting first bookmark');
      setSelectedBookmark(bookmarksData[0]);
      await fetchBookmarkDetails(bookmarksData[0].bookmark_id);
      updateURL({ bookmark: bookmarksData[0].bookmark_id });
    }

    setIsInitialized(true);
  };

  // 初期データ読み込み
  useEffect(() => {
    const initialize = async () => {
      const bookmarksData = await fetchBookmarks();
      await initializeFromURL(bookmarksData);
    };
    initialize();
  }, []);

  // ブックマーク選択
  const handleBookmarkSelect = (bookmark) => {
    setSelectedBookmark(bookmark);
    fetchBookmarkDetails(bookmark.bookmark_id);
    updateURL({ bookmark: bookmark.bookmark_id });
  };

  // ブックマーク削除確認ダイアログを開く
  const handleDeleteClick = (bookmark) => {
    setBookmarkToDelete(bookmark);
    setDeleteDialogOpen(true);
  };

  // ブックマーク削除
  const handleDeleteConfirm = async () => {
    if (!bookmarkToDelete) return;

    try {
      setLoading(true);
      await deleteBookmark(bookmarkToDelete.bookmark_id);
      
      // ローカル状態を更新
      const updatedBookmarks = bookmarks.filter(b => b.bookmark_id !== bookmarkToDelete.bookmark_id);
      setBookmarks(updatedBookmarks);
      
              // 削除したブックマークが選択されていた場合は別のブックマークを選択
        if (selectedBookmark?.bookmark_id === bookmarkToDelete.bookmark_id) {
          if (updatedBookmarks.length > 0) {
            setSelectedBookmark(updatedBookmarks[0]);
            fetchBookmarkDetails(updatedBookmarks[0].bookmark_id);
            updateURL({ bookmark: updatedBookmarks[0].bookmark_id });
          } else {
            setSelectedBookmark(null);
            setBookmarkDetails([]);
            updateURL({ bookmark: null });
          }
        }
      
      setDeleteDialogOpen(false);
      setBookmarkToDelete(null);
    } catch (err) {
      console.error('Error deleting bookmark:', err);
      setError(t('pages:bookmark.deleteFailed'));
    } finally {
      setLoading(false);
    }
  };

  // ブックマーク詳細削除確認ダイアログを開く
  const handleDetailDeleteClick = (detail) => {
    setDetailToDelete(detail);
    setDetailDeleteDialogOpen(true);
  };

  // ブックマーク詳細削除
  const handleDetailDeleteConfirm = async () => {
    if (!detailToDelete) return;

    try {
      // detail_id は "bookmark_id-bookmark_no" 形式
      const parts = detailToDelete.detail_id.split('-');
      const bookmarkNo = parseInt(parts[parts.length - 1]);
      
      await deleteBookmarkDetail(detailToDelete.bookmark_id, bookmarkNo);
      
      // ローカル状態を更新
      setBookmarkDetails(prev => prev.filter(d => d.detail_id !== detailToDelete.detail_id));
      
      setDetailDeleteDialogOpen(false);
      setDetailToDelete(null);
    } catch (err) {
      console.error('Error deleting bookmark detail:', err);
      setError(t('pages:bookmark.deleteDetailFailed'));
      setDetailDeleteDialogOpen(false);
      setDetailToDelete(null);
    }
  };

  // ファイルの詳細表示（CameraViewに遷移）
  const handleFileView = (detail) => {
    // UTC ISO文字列 → UTC YYYYMMDDHHmm形式（タイムゾーン変換なし）
    const formattedDatetime = (() => {
      try {
        const utcDate = new Date(detail.datetime.endsWith('Z') ? detail.datetime : detail.datetime + 'Z');
        if (isNaN(utcDate.getTime())) return '';
        
        const year = utcDate.getUTCFullYear();
        const month = (utcDate.getUTCMonth() + 1).toString().padStart(2, '0');
        const day = utcDate.getUTCDate().toString().padStart(2, '0');
        const hours = utcDate.getUTCHours().toString().padStart(2, '0');
        const minutes = utcDate.getUTCMinutes().toString().padStart(2, '0');
        
        return `${year}${month}${day}${hours}${minutes}`;
      } catch (error) {
        console.error('Error converting datetime:', error);
        return '';
      }
    })();
    
    const searchParams = new URLSearchParams({
      collector_id: detail.collector_id,
      file_type: detail.file_type,
      datetime: formattedDatetime,
      detector_id: detail.detector_id,
      file_id: detail.file_id
    });
    
    // 新しいフィールドが利用可能な場合はcamera_idを使用
    const cameraId = detail.camera_id || (() => {
      // フォールバック: file_idからcamera_idを抽出
      const fileIdParts = detail.file_id.split('-');
      return fileIdParts.length >= 1 ? fileIdParts[0] : '';
    })();
    
    if (cameraId && cameraId !== 'unknown') {
      navigate(`/camera/${cameraId}?${searchParams.toString()}`);
    } else {
      setError('ファイルの詳細表示に失敗しました。カメラIDが取得できません。');
    }
  };

  // 日時をフォーマット（UTC → ユーザータイムゾーン）
  const formatDateTime = (isoString) => {
    if (!isoString) return '';
    // UTC をユーザータイムゾーンに変換して表示
    return formatUTCWithTimezone(isoString, 'MM/DD HH:mm');
  };

  // カメラ別にブックマーク詳細をグループ化
  const groupDetailsByCamera = (details) => {
    const grouped = {};
    details.forEach(detail => {
      const cameraKey = detail.camera_id || 'unknown';
      const cameraName = detail.camera_name || 'Unknown Camera';
      if (!grouped[cameraKey]) {
        grouped[cameraKey] = {
          camera_id: cameraKey,
          camera_name: cameraName,
          details: []
        };
      }
      grouped[cameraKey].details.push(detail);
    });
    return Object.values(grouped);
  };

  // ブックマーク詳細カードをレンダリング
  const renderDetailCard = (detail) => {
    // 表示モードに応じてGrid設定を決定
    let gridProps;
    if (viewMode === 'two-column') {
      gridProps = { xs: 12, sm: 6, md: 6 };  // 2列表示
    } else {
      gridProps = { xs: 12, sm: 6, md: isBookmarkListCollapsed ? 3 : 4 };  // 通常表示
    }
    
    return (
      <Grid item {...gridProps} key={`${detail.bookmark_id}-${detail.bookmark_no}`}>
      <Card sx={{ height: 'auto', position: 'relative' }}>
        {/* 画像/動画表示 */}
        {detail.signed_url && (
          <CardMedia
            sx={{ 
              height: showCompactView ? (viewMode === 'two-column' ? 500 : 250) : 200,
              position: 'relative'
            }}
          >
            {detail.file_type === 'image' ? (
              <img
                src={detail.signed_url}
                alt="Bookmark content"
                style={{
                  width: '100%',
                  height: showCompactView ? (viewMode === 'two-column' ? '500px' : '250px') : '200px',
                  objectFit: showCompactView ? 'contain' : 'cover',
                  display: 'block'
                }}
                onError={(e) => {
                  console.error('Image load error:', e);
                  e.target.style.display = 'none';
                  e.target.nextSibling.style.display = 'flex';
                }}
              />
            ) : (
              <video
                src={detail.signed_url}
                style={{
                  width: '100%',
                  height: showCompactView ? (viewMode === 'two-column' ? '500px' : '250px') : '200px',
                  objectFit: showCompactView ? 'contain' : 'cover',
                  display: 'block'
                }}
                controls={false}
                muted
                preload="metadata"
                onError={(e) => {
                  console.error('Video load error:', e);
                  e.target.style.display = 'none';
                  e.target.nextSibling.style.display = 'flex';
                }}
              />
            )}
            
            {/* エラー時のフォールバック表示 */}
            <Box
              sx={{
                display: 'none',
                alignItems: 'center',
                justifyContent: 'center',
                height: showCompactView ? (viewMode === 'two-column' ? 500 : 250) : 200,
                backgroundColor: 'grey.200',
                color: 'grey.600'
              }}
            >
              {detail.file_type === 'image' ? (
                <ImageIcon sx={{ fontSize: 48 }} />
              ) : (
                <PlayIcon sx={{ fontSize: 48 }} />
              )}
            </Box>
            
            {/* コンパクトビューの場合のオーバーレイ情報 */}
            {showCompactView && (
              <>
                {/* 左上: ファイルタイプと日時を統合したチップ */}
                <Box
                  sx={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    zIndex: 2
                  }}
                >
                  <Chip
                    icon={detail.file_type === 'image' ? <ImageIcon sx={{ color: 'white' }} /> : <PlayIcon sx={{ color: 'white' }} />}
                    label={`${detail.file_type} - ${formatDateTime(detail.datetime)}`}
                    size="small"
                    sx={{
                      backgroundColor: 'rgba(0, 0, 0, 0.7)',
                      color: 'white',
                      borderRadius: 0,
                      backdropFilter: 'blur(4px)',
                      '& .MuiChip-icon': { color: 'white' }
                    }}
                  />
                </Box>
                
                {/* 右上: 削除アイコン */}
                <Box
                  sx={{
                    position: 'absolute',
                    top: 0,
                    right: 0,
                    zIndex: 2
                  }}
                >
                  <IconButton
                    size="small"
                    onClick={() => handleDetailDeleteClick(detail)}
                    sx={{
                      color: 'white',
                      backgroundColor: 'rgba(0, 0, 0, 0.5)',
                      '&:hover': {
                        backgroundColor: 'rgba(255, 0, 0, 0.7)',
                      },
                      padding: 0.5,
                      borderRadius: 0
                    }}
                  >
                    <CloseIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                </Box>
                
                {/* 右下: 詳細ボタン */}
                <Box
                  sx={{
                    position: 'absolute',
                    bottom: 0,
                    right: 0,
                    zIndex: 2
                  }}
                >
                  <Button
                    variant="outlined"
                    color="primary"
                    size="small"
                    startIcon={<ArrowForward sx={{ color: 'white' }} />}
                    onClick={() => handleFileView(detail)}
                    sx={{
                      backgroundColor: 'rgba(0, 0, 0, 0.7)',
                      color: 'white',
                      borderRadius: 0,
                      backdropFilter: 'blur(4px)',
                      border: 'none',
                      '&:hover': {
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        color: 'white',
                        border: 'none'
                      }
                    }}
                  >
                    {t('pages:bookmark.detail')}
                  </Button>
                </Box>
              </>
            )}
          </CardMedia>
        )}
        
        {/* 署名付きURLがない場合のプレースホルダー */}
        {!detail.signed_url && (
          <CardMedia
            sx={{ 
              height: showCompactView ? (viewMode === 'two-column' ? 500 : 250) : 200,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'grey.200',
              color: 'grey.600',
              position: 'relative'
            }}
          >
            {detail.file_type === 'image' ? (
              <ImageIcon sx={{ fontSize: 48 }} />
            ) : (
              <PlayIcon sx={{ fontSize: 48 }} />
            )}
            
            {/* コンパクトビューの場合のオーバーレイ情報（プレースホルダー用） */}
            {showCompactView && (
              <>
                {/* 左上: ファイルタイプと日時を統合したチップ */}
                <Box
                  sx={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    zIndex: 2
                  }}
                >
                  <Chip
                    icon={detail.file_type === 'image' ? <ImageIcon sx={{ color: 'white' }} /> : <PlayIcon sx={{ color: 'white' }} />}
                    label={`${detail.file_type} - ${formatDateTime(detail.datetime)}`}
                    size="small"
                    sx={{
                      backgroundColor: 'rgba(0, 0, 0, 0.7)',
                      color: 'white',
                      borderRadius: 0,
                      backdropFilter: 'blur(4px)',
                      '& .MuiChip-icon': { color: 'white' }
                    }}
                  />
                </Box>
                
                {/* 右上: 削除アイコン */}
                <Box
                  sx={{
                    position: 'absolute',
                    top: 0,
                    right: 0,
                    zIndex: 2
                  }}
                >
                  <IconButton
                    size="small"
                    onClick={() => handleDetailDeleteClick(detail)}
                    sx={{
                      color: 'white',
                      backgroundColor: 'rgba(0, 0, 0, 0.5)',
                      '&:hover': {
                        backgroundColor: 'rgba(255, 0, 0, 0.7)',
                      },
                      padding: 0.5,
                      borderRadius: 0
                    }}
                  >
                    <CloseIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                </Box>
                
                {/* 右下: 詳細ボタン */}
                <Box
                  sx={{
                    position: 'absolute',
                    bottom: 0,
                    right: 0,
                    zIndex: 2
                  }}
                >
                  <Button
                    variant="outlined"
                    color="primary"
                    size="small"
                    startIcon={<ArrowForward sx={{ color: 'white' }} />}
                    onClick={() => handleFileView(detail)}
                    sx={{
                      backgroundColor: 'rgba(0, 0, 0, 0.7)',
                      color: 'white',
                      borderRadius: 0,
                      backdropFilter: 'blur(4px)',
                      border: 'none',
                      '&:hover': {
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        color: 'white',
                        border: 'none'
                      }
                    }}
                  >
                    {t('pages:bookmark.detail')}
                  </Button>
                </Box>
              </>
            )}
          </CardMedia>
        )}
        
        {/* 詳細情報（コンパクトビューでない場合のみ表示） */}
        {!showCompactView && (
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
              <Chip
                icon={detail.file_type === 'image' ? <ImageIcon sx={{ color: 'white' }} /> : <PlayIcon sx={{ color: 'white' }} />}
                label={detail.file_type}
                size="small"
                sx={{ backgroundColor: 'rgba(0, 0, 0, 0.7)', color: 'white', borderRadius: 1, '& .MuiChip-icon': { color: 'white' } }}
              />
            </Box>
            
            <Typography variant="body2" color="text.secondary" gutterBottom>
              {formatDateTime(detail.datetime)}
            </Typography>
            
            {/* カメラ別グループ表示でない場合のみ場所とカメラ情報を表示 */}
            {!groupByCamera && (
              <>
                <Typography variant="body2" color="text.primary" sx={{ fontWeight: 'medium', mb: 0.5 }}>
                  📍 {detail.place_name || 'Unknown Place'}
                </Typography>
                <Typography variant="body2" color="text.primary" sx={{ fontWeight: 'medium', mb: 1 }}>
                  📷 {detail.camera_name || 'Unknown Camera'}
                </Typography>
              </>
            )}
            
            <Typography variant="body2" color="text.secondary">
              {t('pages:cameraView.collector')}: {detail.collector}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('pages:cameraView.detectorShort')}: {detail.detector}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
              ID: {detail.file_id}
            </Typography>
          </CardContent>
        )}
        
        {/* 詳細ビューのボタン類 */}
        {!showCompactView && (
          <>
            {/* 右上: 削除アイコン */}
            <Box sx={{ position: 'absolute', top: 0, right: 0, zIndex: 2 }}>
              <IconButton
                size="small"
                onClick={() => handleDetailDeleteClick(detail)}
                sx={{
                  color: 'white',
                  backgroundColor: 'rgba(0, 0, 0, 0.5)',
                  '&:hover': {
                    backgroundColor: 'rgba(255, 0, 0, 0.7)',
                  },
                  padding: 0.5,
                  borderRadius: 0
                }}
              >
                <CloseIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Box>
            
            {/* 右下: 詳細ボタン */}
            <Box
              sx={{
                position: 'absolute',
                bottom: 0,
                right: 0,
                zIndex: 2
              }}
            >
              <Button
                variant="outlined"
                color="primary"
                size="small"
                startIcon={<ArrowForward sx={{ color: 'white' }} />}
                onClick={() => handleFileView(detail)}
                sx={{
                  backgroundColor: 'rgba(0, 0, 0, 0.7)',
                  color: 'white',
                  borderRadius: 0,
                  backdropFilter: 'blur(4px)',
                  border: 'none',
                  '&:hover': {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',  
                    color: 'white',
                    border: 'none'
                  }
                }}
              >
                詳細
              </Button>
            </Box>
          </>
        )}

      </Card>
    </Grid>
    );
  };

  return (
    <PageLayout>
      <TitleArea
        title={t('pages:bookmark.title')}
        leftContent={
          <BookmarkIcon sx={{ ml: 1 }} />
        }
        rightContent={
          <>{/* レポート作成ボタンを右上に移動・色をEXPORT TO S3と同じに */}
          {selectedBookmark && (
            <Button
              variant="contained"
              onClick={() => setReportDialogOpen(true)}
              size="small"
              startIcon={<DescriptionIcon />}
              sx={{
                bgcolor: 'success.light',
                color: 'success.contrastText',
                '&:hover': {
                  bgcolor: 'success.main',
                  color: 'white'
                },
                minWidth: 100,
                fontSize: '0.95rem',
                boxShadow: 2,
                py: 0.5,
                px: 2
              }}
            >
              {t('pages:bookmark.createReport')}
            </Button>
          )}
          </>
        }
      />

      <Box
        sx={{
          marginTop: `${HEADER_HEIGHT + TITLE_AREA_HEIGHT}px`,
          overflow: 'auto',
          height: `calc(100vh - ${HEADER_HEIGHT + TITLE_AREA_HEIGHT}px)`,
        }}
      >
        <Container maxWidth={false} sx={{ py: 3, maxWidth: "2000px", mx: "auto" }}>
        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}

        <Grid container spacing={3}>
          {/* ブックマーク一覧 */}
          {!isBookmarkListCollapsed && (
            <Grid item xs={12} md={3}>
              <Paper sx={{ minHeight: '70vh', overflow: 'auto', position: 'relative' }}>
                {/* 折りたたみボタン */}
                <Box sx={{ position: 'absolute', top: 16, right: 16, zIndex: 1 }}>
                  <Tooltip title={t('pages:bookmark.hideList')}>
                    <IconButton
                      onClick={() => {
                        setIsBookmarkListCollapsed(true);
                        updateURL({ collapsed: true });
                      }}
                      size="small"
                      sx={{ 
                        backgroundColor: 'background.paper',
                        boxShadow: 1,
                        '&:hover': {
                          boxShadow: 2
                        }
                      }}
                    >
                      <ChevronLeft />
                    </IconButton>
                  </Tooltip>
                </Box>
                
                <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
                  <Typography variant="h6">{t('pages:bookmark.bookmarkList')}</Typography>
                </Box>
                
                {loading || !isInitialized ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                    <CircularProgress />
                  </Box>
                ) : bookmarks.length === 0 ? (
                  <Box sx={{ p: 3, textAlign: 'center' }}>
                    <Typography variant="body2" color="text.secondary">
                      {t('pages:bookmark.noBookmarks')}
                    </Typography>
                  </Box>
                ) : (
                  <List>
                    {bookmarks.map((bookmark) => (
                      <ListItem key={bookmark.bookmark_id} disablePadding>
                        <ListItemButton
                          selected={selectedBookmark?.bookmark_id === bookmark.bookmark_id}
                          onClick={() => handleBookmarkSelect(bookmark)}
                        >
                          <ListItemText
                            primary={bookmark.bookmark_name}
                            secondary={`${t('pages:bookmark.updated')}: ${formatDateTime(bookmark.updatedate)}`}
                          />
                          <ListItemSecondaryAction>
                            <IconButton
                              edge="end"
                              aria-label="delete"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteClick(bookmark);
                              }}
                            >
                              <DeleteIcon />
                            </IconButton>
                          </ListItemSecondaryAction>
                        </ListItemButton>
                      </ListItem>
                    ))}
                  </List>
                )}
              </Paper>
            </Grid>
          )}

          {/* ブックマーク詳細 */}
          <Grid item xs={12} md={isBookmarkListCollapsed ? 12 : 9}>
            <Paper sx={{ minHeight: '70vh', position: 'relative' }}>
              {/* 展開ボタン（折りたたまれている場合のみ表示） */}
              {isBookmarkListCollapsed && (
                <Box sx={{ position: 'absolute', top: 16, left: 16, zIndex: 1 }}>
                  <Tooltip title={t('pages:bookmark.showList')}>
                    <IconButton
                      onClick={() => {
                        setIsBookmarkListCollapsed(false);
                        updateURL({ collapsed: false });
                      }}
                      size="small"
                      sx={{ 
                        backgroundColor: 'background.paper',
                        boxShadow: 1,
                        '&:hover': {
                          boxShadow: 2
                        }
                      }}
                    >
                      <ChevronRight />
                    </IconButton>
                  </Tooltip>
                </Box>
              )}

              <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
                <Box sx={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center', 
                  mb: 2,
                  pl: isBookmarkListCollapsed ? 5 : 0  // 折りたたみ時は左側にスペースを確保
                }}>
                  <Typography variant="h6">
                    {selectedBookmark ? `${selectedBookmark.bookmark_name} ${t('pages:bookmark.contents')}` : t('pages:bookmark.details')}
                  </Typography>
                  {/* 表示切り替えボタン */}
                  {selectedBookmark && bookmarkDetails.length > 0 && (
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      {/* カメラ別グループ表示切り替え */}
                      <ToggleButtonGroup
                        value={groupByCamera}
                        exclusive
                        onChange={(event, newValue) => {
                          setGroupByCamera(newValue);
                          updateURL({ group: newValue });
                        }}
                        aria-label="group by camera"
                        size="small"
                      >
                        <ToggleButton value={false} aria-label="normal view">
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <ViewListIcon />
                            <Typography variant="caption">{t('pages:bookmark.listView')}</Typography>
                          </Box>
                        </ToggleButton>
                        <ToggleButton value={true} aria-label="group by camera">
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <CameraIcon />
                            <Typography variant="caption">{t('pages:bookmark.groupByCamera')}</Typography>
                          </Box>
                        </ToggleButton>
                      </ToggleButtonGroup>
                      
                      {/* 表示モード切り替え */}
                      <ToggleButtonGroup
                        value={viewMode}
                        exclusive
                        onChange={(event, newValue) => {
                          setViewMode(newValue);
                          updateURL({ view: newValue });
                        }}
                        aria-label="view mode"
                        size="small"
                      >
                        <ToggleButton value="normal" aria-label="normal view">
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <ViewModuleIcon />
                            <Typography variant="caption">{t('pages:bookmark.normal')}</Typography>
                          </Box>
                        </ToggleButton>
                        <ToggleButton value="two-column" aria-label="two column view">
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <ViewColumnIcon />
                            <Typography variant="caption">{t('pages:bookmark.twoColumn')}</Typography>
                          </Box>
                        </ToggleButton>
                      </ToggleButtonGroup>
                      
                      {/* コンパクトビュー切り替え */}
                      <ToggleButtonGroup
                        value={showCompactView}
                        exclusive
                        onChange={(event, newValue) => {
                          setShowCompactView(newValue);
                          updateURL({ compact: newValue });
                        }}
                        aria-label="compact view"
                        size="small"
                      >
                        <ToggleButton value={false} aria-label="detailed view">
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <ViewListIcon />
                            <Typography variant="caption">{t('pages:bookmark.detailed')}</Typography>
                          </Box>
                        </ToggleButton>
                        <ToggleButton value={true} aria-label="compact view">
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <ImageIcon />
                            <Typography variant="caption">{t('pages:bookmark.imageOnly')}</Typography>
                          </Box>
                        </ToggleButton>
                      </ToggleButtonGroup>
                    </Box>
                  )}
                </Box>
              </Box>
              
              {!selectedBookmark || !isInitialized ? (
                <Box sx={{ p: 3, textAlign: 'center' }}>
                  <Typography variant="body2" color="text.secondary">
                    {!isInitialized ? t('common:loading') : t('pages:bookmark.selectBookmark')}
                  </Typography>
                </Box>
              ) : detailsLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                  <CircularProgress />
                </Box>
              ) : bookmarkDetails.length === 0 ? (
                <Box sx={{ p: 3, textAlign: 'center' }}>
                  <Typography variant="body2" color="text.secondary">
                    {t('pages:bookmark.noFiles')}
                  </Typography>
                </Box>
              ) : (
                <Box sx={{ p: 2 }}>
                  {groupByCamera ? (
                    // カメラ別グループ表示
                    groupDetailsByCamera(bookmarkDetails).map((group) => (
                      <Box key={group.camera_id} sx={{ mb: 3 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                          <CameraIcon sx={{ mr: 1, color: 'primary.main' }} />
                          <Typography variant="h6" color="primary.main">
                            {group.camera_name}
                          </Typography>
                          <Chip 
                            label={t('pages:bookmark.itemCount', { count: group.details.length })} 
                            size="small" 
                            sx={{ ml: 1 }}
                          />
                        </Box>
                        <Grid container spacing={2}>
                          {group.details.map((detail) => renderDetailCard(detail))}
                        </Grid>
                        <Divider sx={{ mt: 2 }} />
                      </Box>
                    ))
                  ) : (
                    // 通常の一覧表示
                    <Grid container spacing={2}>
                      {bookmarkDetails.map((detail) => renderDetailCard(detail))}
                    </Grid>
                  )}
                </Box>
              )}
            </Paper>
          </Grid>
        </Grid>

        {/* 削除確認ダイアログ */}
        <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
          <DialogTitle>{t('pages:bookmark.deleteDialogTitle')}</DialogTitle>
          <DialogContent>
            <Typography>
              {t('pages:bookmark.deleteDialogContent', { name: bookmarkToDelete?.bookmark_name })}
              <br />
              {t('pages:bookmark.deleteWarning')}
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDeleteDialogOpen(false)}>
              {t('common:cancel')}
            </Button>
            <Button onClick={handleDeleteConfirm} color="error" variant="contained">
              {t('common:delete')}
            </Button>
          </DialogActions>
        </Dialog>

        {/* 詳細削除確認ダイアログ */}
        <Dialog open={detailDeleteDialogOpen} onClose={() => setDetailDeleteDialogOpen(false)}>
          <DialogTitle>{t('pages:bookmark.deleteDetailDialogTitle')}</DialogTitle>
          <DialogContent>
            <Typography>
              {t('pages:bookmark.deleteDetailDialogContent')}
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDetailDeleteDialogOpen(false)}>
              {t('common:cancel')}
            </Button>
            <Button onClick={handleDetailDeleteConfirm} color="error" variant="contained">
              {t('common:delete')}
            </Button>
          </DialogActions>
        </Dialog>

        {/* ReportCreateダイアログ */}
        <ReportCreate
          open={reportDialogOpen}
          onClose={() => setReportDialogOpen(false)}
          bookmark={selectedBookmark}
        />
        </Container>
      </Box>
    </PageLayout>
  );
};

export default Bookmark; 