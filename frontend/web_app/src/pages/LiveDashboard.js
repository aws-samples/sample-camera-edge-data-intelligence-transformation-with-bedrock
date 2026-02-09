import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { 
  Container, 
  Typography, 
  Box, 
  CircularProgress, 
  Grid,
  Card,
  CardContent,
  Alert
} from '@mui/material';
import PageLayout from '../components/PageLayout';
import TitleArea from '../components/TitleArea';
import HlsPlayer from '../components/HlsPlayer';
import VSaaSPlayer from '../components/VSaaSPlayer';
import { getFilteredCameras, hlsRecUrl } from '../services/api';
import { HEADER_HEIGHT, TITLE_AREA_HEIGHT } from '../constants/layout';
import { useTranslation } from 'react-i18next';

const LiveDashboard = () => {
  const { t } = useTranslation(['pages', 'common']);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  
  // 状態管理
  const [cameras, setCameras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hlsUrls, setHlsUrls] = useState({});
  const [loadingUrls, setLoadingUrls] = useState({});

  // URLパラメータから検索条件を取得（useMemoで安定化）
  const searchTerm = searchParams.get('search') || '';
  const selectedPlaces = useMemo(() => {
    const placesParam = searchParams.get('places');
    return placesParam ? placesParam.split(',').filter(Boolean) : [];
  }, [searchParams]);
  const currentPage = parseInt(searchParams.get('page') || '1', 10);

  // カメラ一覧に戻る関数
  const handleBackToHome = () => {
    // 現在のURLパラメータをそのまま引き継いでカメラ一覧に戻る
    const currentParams = new URLSearchParams(location.search);
    navigate(`/${currentParams.toString() ? `?${currentParams.toString()}` : ''}`);
  };

  // カメラデータを取得
  useEffect(() => {
    const fetchCameras = async () => {
      setLoading(true);
      setError(null);
      
      try {
        const data = await getFilteredCameras({
          placeIds: selectedPlaces,
          searchTerm,
          page: currentPage,
          limit: 100, // LIVEビューイングでは多めに表示
          includeImage: false // LIVEビューイングでは画像は不要
        });
        
        setCameras(data.cameras || []);
      } catch (err) {
        console.error('Error fetching cameras for live dashboard:', err);
        setError(t('pages:liveDashboard.fetchCamerasFailed'));
        setCameras([]);
      } finally {
        setLoading(false);
      }
    };

    fetchCameras();
  }, [searchTerm, selectedPlaces, currentPage]);

  // HLS URLを取得（useCallbackで安定化）
  const fetchHlsUrl = React.useCallback(async (camera) => {
    if (camera.type === 'kinesis') {
      setLoadingUrls(prev => ({ ...prev, [camera.camera_id]: true }));
      try {
        const hlsData = await hlsRecUrl(camera.camera_id);
        setHlsUrls(prev => ({ ...prev, [camera.camera_id]: hlsData.url }));
      } catch (error) {
        console.error("Error fetching HLS URL for camera %s:", camera.camera_id, error);
        setHlsUrls(prev => ({ ...prev, [camera.camera_id]: null }));
      } finally {
        setLoadingUrls(prev => ({ ...prev, [camera.camera_id]: false }));
      }
    }
  }, []);

  // カメラが取得されたらHLS URLを取得（重複実行を防ぐ）
  useEffect(() => {
    if (cameras && cameras.length > 0) {
      cameras.forEach(camera => {
        if (camera.type === 'kinesis' && 
            hlsUrls[camera.camera_id] === undefined && 
            !loadingUrls[camera.camera_id]) {
          fetchHlsUrl(camera);
        }
      });
    }
  }, [cameras, hlsUrls, loadingUrls, fetchHlsUrl]);

  // カメラクリック時の処理（useCallbackで安定化）
  const handleCameraClick = React.useCallback((camera) => {
    // 現在の検索条件を保持してカメラ詳細ページに移動
    const params = new URLSearchParams();
    if (searchTerm) params.set('search', searchTerm);
    if (selectedPlaces.length > 0) params.set('places', selectedPlaces.join(','));
    if (currentPage > 1) params.set('page', currentPage.toString());
    
    // カメラ詳細ページのURLパラメータとして検索条件を追加（必要に応じて）
    navigate(`/camera/${camera.camera_id}`);
  }, [searchTerm, selectedPlaces, currentPage, navigate]);

  // カメラごとのプレイヤーコンポーネント（React.memoで最適化）
  const CameraPlayer = React.memo(({ camera }) => {
    const isLoading = loadingUrls[camera.camera_id];
    const hlsUrl = hlsUrls[camera.camera_id];

    const renderPlayer = () => {
      switch (camera.type) {
        case 'kinesis':
          if (isLoading) {
            return (
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', bgcolor: '#000' }}>
                <CircularProgress sx={{ color: '#fff' }} />
              </Box>
            );
          }
          if (hlsUrl) {
            return (
              <HlsPlayer
                src={hlsUrl}
                autoPlay={true}
                controls={true}
                muted={true}
                onError={(error) => {
                  console.error("HLS error for camera %s:", camera.camera_id, error);
                }}
              />
            );
          }
          return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', bgcolor: '#f5f5f5' }}>
              <Typography variant="body2" color="text.secondary">{t('pages:liveDashboard.noHls')}</Typography>
            </Box>
          );

        case 'vsaas':
          if (camera.vsaas_apikey && camera.vsaas_device_id) {
            return (
              <VSaaSPlayer
                apiKey={camera.vsaas_apikey}
                deviceId={camera.vsaas_device_id}
                autoPlay={true}
                onError={(error) => {
                  console.error("VSaaS error for camera %s:", camera.camera_id, error);
                }}
              />
            );
          }
          return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', bgcolor: '#f5f5f5' }}>
              <Typography variant="body2" color="text.secondary">{t('pages:liveDashboard.vsaasIncomplete')}</Typography>
            </Box>
          );

        case 's3':
        default:
          return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', bgcolor: '#f5f5f5' }}>
              <Typography variant="body2" color="text.secondary">{t('pages:liveDashboard.noLiveStream')}</Typography>
            </Box>
          );
      }
    };

    return (
      <Card 
        sx={{ 
          height: '100%',
          cursor: 'pointer',
          transition: 'transform 0.2s ease, box-shadow 0.2s ease',
          '&:hover': {
            transform: 'scale(1.02)',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)'
          }
        }}
        onClick={() => handleCameraClick(camera)}
      >
        <CardContent sx={{ p: 1, '&:last-child': { pb: 1 } }}>
          <Typography variant="subtitle2" gutterBottom noWrap>
            {camera.name}
          </Typography>
          <Typography variant="caption" color="text.secondary" gutterBottom noWrap>
            {camera.place_name}
          </Typography>
          <Box sx={{ height: 250, backgroundColor: '#000', borderRadius: 1 }}>
            {renderPlayer()}
          </Box>
        </CardContent>
      </Card>
    );
  });

  return (
    <PageLayout>
      {/* TitleArea */}
      <TitleArea
        title={t('pages:liveDashboard.title')}
        backTo={(() => {
          // 現在の検索条件を保持してカメラ一覧に戻る
          const params = new URLSearchParams();
          if (searchTerm) params.set('search', searchTerm);
          if (selectedPlaces.length > 0) params.set('places', selectedPlaces.join(','));
          if (currentPage > 1) params.set('page', currentPage.toString());
          return `/${params.toString() ? `?${params.toString()}` : ''}`;
        })()}
        leftContent={
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              backgroundColor: '#e53e3e',
              color: 'white',
              px: 1.5,
              py: 0.5,
              borderRadius: 1,
              fontSize: '0.875rem',
              fontWeight: 'bold',
              letterSpacing: '0.05em',
              minWidth: 60,
              height: 28,
              position: 'relative',
              '&::before': {
                content: '""',
                width: 8,
                height: 8,
                backgroundColor: 'white',
                borderRadius: '50%',
                marginRight: 0.75,
                animation: 'pulse 2s infinite',
              },
              '@keyframes pulse': {
                '0%': { opacity: 1 },
                '50%': { opacity: 0.5 },
                '100%': { opacity: 1 },
              },
            }}
          >
            LIVE
          </Box>
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
        {/* 検索条件の表示 */}
        {(searchTerm || selectedPlaces.length > 0) && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="body2" color="text.secondary">
              {t('pages:liveDashboard.searchCondition')}: 
              {searchTerm && ` ${t('pages:liveDashboard.keyword')}「${searchTerm}」`}
              {selectedPlaces.length > 0 && ` ${t('pages:liveDashboard.placeFilter')}(${t('pages:liveDashboard.placesCount', { count: selectedPlaces.length })})`}
            </Typography>
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
            {t('pages:liveDashboard.noMatchingCameras')}
          </Alert>
        ) : (
          <Grid container spacing={2}>
            {cameras.map(camera => (
              <Grid item xs={12} sm={6} md={4} lg={3} key={camera.camera_id}>
                <CameraPlayer camera={camera} />
              </Grid>
            ))}
          </Grid>
        )}
        </Container>
      </Box>
    </PageLayout>
  );
};

export default LiveDashboard; 