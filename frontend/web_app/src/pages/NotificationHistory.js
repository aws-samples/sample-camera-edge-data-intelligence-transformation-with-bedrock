import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
  Alert
} from '@mui/material';
import PageLayout from '../components/PageLayout';
import TitleArea from '../components/TitleArea';
import { getNotificationHistory } from '../services/api';
import { HEADER_HEIGHT, TITLE_AREA_HEIGHT } from '../constants/layout';
import { formatUTCWithTimezone } from '../utils/timezone';
import { useTranslation } from 'react-i18next';

const NotificationHistory = () => {
  const { t } = useTranslation(['pages', 'common']);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [notifications, setNotifications] = useState([]);
  const [pagination, setPagination] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // URLパラメータからページ番号を取得
  const currentPage = parseInt(searchParams.get('page')) || 1;

  // 通知履歴を取得
  const fetchNotificationHistory = async (page = 1) => {
    setLoading(true);
    setError(null);
    
    try {
      const data = await getNotificationHistory(page, 20);
      setNotifications(data.notifications || []);
      setPagination(data.pagination || {});
    } catch (err) {
      console.error('Error fetching notification history:', err);
      setError(t('pages:notificationHistory.fetchFailed'));
      setNotifications([]);
      setPagination({});
    } finally {
      setLoading(false);
    }
  };

  // ページが変更された時の処理
  useEffect(() => {
    fetchNotificationHistory(currentPage);
  }, [currentPage]);

  // ページネーション変更時の処理
  const handlePageChange = (event, value) => {
    setSearchParams({ page: value.toString() });
  };

  // 時刻をフォーマット（UTC → ユーザー設定のタイムゾーンに変換）
  const formatDateTime = (isoString) => {
    return formatUTCWithTimezone(isoString, 'YYYY-MM-DD HH:mm');
  };

  // 通知クリック時の処理（Headerと同じロジック）
  const handleNotificationClick = (notification) => {
    console.log('Notification clicked:', notification);
    
    const { camera_id, file_id, detector, detector_id, file_type, collector, collector_id, start_time } = notification;
    
    if (camera_id && file_id && detector_id && file_type && collector_id && start_time) {
      // start_time (ISO format) を YYYYMMDDHHMM 形式に変換
      const datetime = convertISOToDateTime(start_time);
      
      if (datetime) {
        // ディープリンクURLを生成（IDベース）
        const params = new URLSearchParams({
          collector_id: collector_id,
          file_type: file_type,
          datetime: datetime,
          detector_id: detector_id,
          file_id: file_id
        });
        
        const deepLinkUrl = `/camera/${camera_id}?${params.toString()}`;
        console.log('Generated deep link URL:', deepLinkUrl);
        
        navigate(deepLinkUrl);
      } else {
        // 時刻変換に失敗した場合は通常の遷移
        console.warn('Failed to parse start_time, using simple navigation');
        navigate(`/camera/${camera_id}`);
      }
    } else {
      // 必要なデータが不足している場合は通常の遷移
      console.warn('Missing required notification data, using simple navigation');
      navigate(`/camera/${camera_id}`);
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
        title={t('pages:notificationHistory.title')}
        backTo="/"
        leftContent={
          pagination.total_count !== undefined && (
            <Typography variant="body2" color="text.secondary">
              全 {pagination.total_count} 件
            </Typography>
          )
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
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : error ? (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        ) : notifications.length === 0 ? (
          <Paper sx={{ p: 4, textAlign: 'center' }}>
            <Typography variant="h6" color="text.secondary">
              通知履歴がありません
            </Typography>
          </Paper>
        ) : (
          <>
            <Box sx={{ mb: 3 }}>
              {notifications.map((notification, index) => (
                <Card 
                  key={notification.detect_log_id || index}
                  sx={{ 
                    mb: 2, 
                    cursor: 'pointer',
                    '&:hover': {
                      boxShadow: 4
                    }
                  }}
                  onClick={() => handleNotificationClick(notification)}
                >
                  <CardContent>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                      <Typography variant="h6" sx={{ fontWeight: 'bold', flex: 1 }}>
                        {notification.place_name}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {formatDateTime(notification.start_time)}
                      </Typography>
                    </Box>
                    
                    <Typography variant="body1" color="text.secondary" sx={{ mb: 1 }}>
                      {notification.camera_name}
                    </Typography>
                    
                    <Typography variant="body1" sx={{ mb: 2 }}>
                      {notification.detect_notify_reason}
                    </Typography>
                    
                    <Box sx={{ display: 'flex', gap: 1 }}>
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
        </Container>
      </Box>
    </PageLayout>
  );
};

export default NotificationHistory; 