import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Container, 
  Typography, 
  Box, 
  CircularProgress, 
  TextField, 
  InputAdornment,
  Grid,
  Paper,
  Chip,
  Pagination,
  Alert,
  useTheme,
  useMediaQuery,
  Button
} from '@mui/material';
import { 
  Search as SearchIcon, 
  LocationOn, 
  Add as AddIcon, 
  Dashboard as DashboardIcon
} from '@mui/icons-material';
import CameraCard from '../components/CameraCard';
import PageLayout from '../components/PageLayout';
import TitleArea from '../components/TitleArea';
import { getFilteredCameras, getPlaces } from '../services/api';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { HEADER_HEIGHT, TITLE_AREA_HEIGHT } from '../constants/layout';
import { useTranslation } from 'react-i18next';

const Home = () => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation(['pages', 'messages', 'common']);
  
  // 状態管理
  const [cameras, setCameras] = useState([]);
  const [places, setPlaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pagination, setPagination] = useState({});

  
  // URLパラメータから初期値を設定
  const [searchTerm, setSearchTerm] = useState(searchParams.get('search') || '');
  const [selectedPlaces, setSelectedPlaces] = useState(() => {
    const placesParam = searchParams.get('places');
    return placesParam ? placesParam.split(',').filter(Boolean) : [];
  });
  const [currentPage, setCurrentPage] = useState(() => {
    const pageParam = searchParams.get('page');
    return pageParam ? parseInt(pageParam, 10) : 1;
  });
  
  const ITEMS_PER_PAGE = 20;
  
  // デバウンス用のRef
  const debounceRef = useRef(null);
  const isInitialMount = useRef(true);

  // URLパラメータを更新する関数（useCallbackの依存関係から除外）
  const updateURLParams = useCallback((newSearchTerm, newSelectedPlaces, newPage) => {
    const params = new URLSearchParams();
    
    if (newSearchTerm && newSearchTerm.trim() !== '') {
      params.set('search', newSearchTerm.trim());
    }
    
    if (newSelectedPlaces && newSelectedPlaces.length > 0) {
      params.set('places', newSelectedPlaces.join(','));
    }
    
    if (newPage && newPage > 1) {
      params.set('page', newPage.toString());
    }
    
    setSearchParams(params, { replace: true }); // replace: trueで履歴を置き換え
  }, [setSearchParams]);

  // カメラデータを取得
  const fetchCameras = useCallback(async (searchTerm, selectedPlaces, page = 1) => {
    console.log('🚀 fetchCameras called with:', {
      searchTerm,
      selectedPlaces: selectedPlaces.length,
      page
    });
    
    setLoading(true);
    setError(null);
    
    try {
      const data = await getFilteredCameras({
        placeIds: selectedPlaces,
        searchTerm,
        page,
        limit: ITEMS_PER_PAGE,
        includeImage: true
      });
      
      setCameras(data.cameras || []);
      setPagination(data.pagination || {});
      
      // URLパラメータ更新
      const params = new URLSearchParams();
      if (searchTerm && searchTerm.trim() !== '') {
        params.set('search', searchTerm.trim());
      }
      if (selectedPlaces && selectedPlaces.length > 0) {
        params.set('places', selectedPlaces.join(','));
      }
      if (page && page > 1) {
        params.set('page', page.toString());
      }
      setSearchParams(params, { replace: true });
      
    } catch (err) {
      console.error('Error fetching filtered cameras:', err);
      setError(t('messages:errors.fetchCamerasFailed'));
      setCameras([]);
      setPagination({});
    } finally {
      setLoading(false);
    }
  }, [setSearchParams, t]);

  // useEffectも依存関係を最小化
  useEffect(() => {
    console.log('🔄 Single useEffect triggered:', {
      searchTerm,
      selectedPlaces: selectedPlaces.length,
      currentPage
    });
    
    // デバウンス処理
    const timer = setTimeout(() => {
      console.log('⏰ Executing search after debounce');
      fetchCameras(searchTerm, selectedPlaces, currentPage);
    }, 300);

    return () => {
      console.log('🧹 Cleaning up timer');
      clearTimeout(timer);
    };
  }, [searchTerm, selectedPlaces, currentPage]);

  // 場所データを取得
  useEffect(() => {
    const fetchPlaces = async () => {
      try {
        const placesData = await getPlaces();
        setPlaces(placesData);
      } catch (err) {
        console.error('Error fetching places:', err);
        setError(t('messages:errors.fetchPlacesFailed'));
      }
    };
    fetchPlaces();
  }, [t]);

  // ページ変更時
  const handlePageChange = (event, value) => {
    console.log('📄 Page change:', value);
    
    // 即座に実行
    fetchCameras(searchTerm, selectedPlaces, value);
    
    // 状態も更新
    setCurrentPage(value);
  };

  // 場所選択は通常のデバウンス処理でOK
  const handlePlaceToggle = (placeId) => {
    console.log('🏠 handlePlaceToggle:', placeId);
    
    // React 18のstartTransitionを使用
    React.startTransition(() => {
      setSelectedPlaces(prev => {
        const newSelection = prev.includes(placeId) 
          ? prev.filter(id => id !== placeId)
          : [...prev, placeId];
        console.log('🏠 New selection:', newSelection);
        return newSelection;
      });
      
      setCurrentPage(1);
    });
  };

  // 全ての場所選択をクリア
  const handleClearPlaces = () => {
    setSelectedPlaces([]);
    setCurrentPage(1);
  };

  // 検索語変更のハンドラー（デバウンス処理を統合）
  const handleSearchChange = (e) => {
    const value = e.target.value;
    setSearchTerm(value);
    // ページを1に戻す
    if (currentPage !== 1) {
      setCurrentPage(1);
    }
  };

  // ブラウザバック/フォワード対応
  useEffect(() => {
    const handlePopState = () => {
      const newSearchTerm = searchParams.get('search') || '';
      const newPlacesParam = searchParams.get('places');
      const newSelectedPlaces = newPlacesParam ? newPlacesParam.split(',').filter(Boolean) : [];
      const newPageParam = searchParams.get('page');
      const newPage = newPageParam ? parseInt(newPageParam, 10) : 1;

      setSearchTerm(newSearchTerm);
      setSelectedPlaces(newSelectedPlaces);
      setCurrentPage(newPage);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [searchParams]);

  // コンポーネントのアンマウント時にデバウンスタイマーをクリア
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  // カメラ追加ボタンのハンドラー
  const handleAddCamera = () => {
    navigate('/camera/new');
  };

  // LIVE ビューイングのハンドラー
  const handleOpenDashboard = () => {
    // 現在の検索条件をURLパラメータとして新しいページに遷移
    const params = new URLSearchParams();
    
    if (searchTerm && searchTerm.trim() !== '') {
      params.set('search', searchTerm.trim());
    }
    
    if (selectedPlaces && selectedPlaces.length > 0) {
      params.set('places', selectedPlaces.join(','));
    }
    
    if (currentPage && currentPage > 1) {
      params.set('page', currentPage.toString());
    }
    
    const queryString = params.toString();
    navigate(`/live-dashboard${queryString ? `?${queryString}` : ''}`);
  };



  // 場所フィルタコンポーネント
  const PlaceFilterComponent = () => (
    <Paper sx={{ 
      p: 2, 
      position: isMobile ? 'static' : 'sticky',
      top: isMobile ? 'auto' : theme.spacing(2),
      height: 'fit-content'
    }}>
      <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <LocationOn />
        {t('pages:home.filterByPlace')}
      </Typography>
      
      <Box sx={{ 
        display: 'flex', 
        flexDirection: isMobile ? 'row' : 'column',
        flexWrap: 'wrap',
        gap: 1,
        maxHeight: isMobile ? 'none' : 400,
        overflowY: isMobile ? 'visible' : 'auto'
      }}>
        <Chip
          label={t('common:all')}
          clickable
          variant={selectedPlaces.length === 0 ? 'filled' : 'outlined'}
          color="primary"
          onClick={handleClearPlaces}
        />
        
        {places.map(place => (
          <Chip
            key={place.place_id}
            label={place.name}
            clickable
            variant={selectedPlaces.includes(place.place_id) ? 'filled' : 'outlined'}
            color="primary"
            onClick={() => handlePlaceToggle(place.place_id)}
          />
        ))}
      </Box>
      
      {selectedPlaces.length > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          {t('pages:home.placesSelected', { count: selectedPlaces.length })}
        </Typography>
      )}
    </Paper>
  );

  return (
    <PageLayout>
      {/* TitleArea */}
      <TitleArea
        title={t('pages:home.title')}
        rightContent={
          <>
            <Button
              variant="outlined"
              startIcon={<DashboardIcon />}
              onClick={handleOpenDashboard}
              disabled={!cameras || cameras.length === 0}
              size="small"
            >
              {t('pages:home.liveViewing')}
            </Button>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={handleAddCamera}
              size="small"
            >
              {t('pages:home.addCamera')}
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
        {/* 検索ボックス */}
        <TextField
          fullWidth
          variant="outlined"
          placeholder={t('pages:home.searchPlaceholder')}
          value={searchTerm}
          onChange={handleSearchChange}
          sx={{ mb: 3 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
          }}
        />

        <Grid container spacing={3}>
          {/* 場所フィルタ */}
          <Grid item xs={12} md={3}>
            <PlaceFilterComponent />
          </Grid>
          
          {/* カメラ一覧 */}
          <Grid item xs={12} md={9}>
            {/* 検索結果情報 */}
            {pagination.total_count !== undefined && (
              <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  {t('pages:home.camerasCount', { count: pagination.total_count })}
                  {selectedPlaces.length > 0 && (
                    <> {t('pages:home.filteringByPlaces', { count: selectedPlaces.length })}</>
                  )}
                </Typography>
                
                {pagination.total_pages > 1 && (
                  <Typography variant="body2" color="text.secondary">
                    {t('pages:home.pageInfo', { current: pagination.current_page, total: pagination.total_pages })}
                  </Typography>
                )}
              </Box>
            )}

            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', my: 4 }}>
                <CircularProgress />
              </Box>
            ) : error ? (
              <Alert severity="error" sx={{ mb: 3 }}>
                {error}
              </Alert>
            ) : cameras.length === 0 ? (
              <Alert severity="info">
                {t('pages:home.noResults')}
              </Alert>
            ) : (
              <>
                {/* カメラグリッド */}
                <Box 
                  sx={{ 
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 3,
                    mb: 4,
                    '& > *': {
                      flex: {
                        xs: '0 0 100%',
                        sm: '0 0 100%',
                        md: '0 0 calc(50% - 12px)',
                        lg: '0 0 calc(33.333% - 16px)',
                        xl: '0 0 calc(25% - 18px)'
                      },
                      maxWidth: {
                        xs: '100%',
                        sm: '100%',
                        md: 'calc(50% - 12px)',
                        lg: 'calc(33.333% - 16px)',
                        xl: 'calc(25% - 18px)'
                      }
                    }
                  }}
                >
                  {cameras.map(camera => (
                    <Box key={camera.camera_id}>
                      <CameraCard camera={camera} />
                    </Box>
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
          </Grid>
        </Grid>
        </Container>
      </Box>
    </PageLayout>
  );
};

export default Home;
