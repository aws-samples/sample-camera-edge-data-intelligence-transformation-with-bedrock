import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppBar, Toolbar, Typography, Button, IconButton, Menu, MenuItem, Avatar, Badge, Box, Divider, ListItemText, ListItemIcon, Chip } from '@mui/material';
import { Menu as MenuIcon, AccountCircle, Notifications, Search, Insights, CameraAlt, Bookmark, LocalOffer, Help as HelpIcon, LocationOn, Movie } from '@mui/icons-material';
import { useAuth } from '../utils/AuthContext';
import { getRecentNotifications } from '../services/api';
import Help from './Help';
import TimezoneSelector from './TimezoneSelector';
import LocaleSelector from './LocaleSelector';
import { formatUTCWithTimezone, getCurrentTimezone } from '../utils/timezone';
import { useTranslation } from 'react-i18next';

const Header = () => {
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation(['navigation', 'common']);
  const [anchorEl, setAnchorEl] = useState(null);
  const [mobileMenuAnchorEl, setMobileMenuAnchorEl] = useState(null);
  const [notificationAnchorEl, setNotificationAnchorEl] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [notificationCount, setNotificationCount] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);

  const handleProfileMenuOpen = (event) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMobileMenuOpen = (event) => {
    setMobileMenuAnchorEl(event.currentTarget);
  };

  const handleNotificationMenuOpen = (event) => {
    setNotificationAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
    setMobileMenuAnchorEl(null);
    setNotificationAnchorEl(null);
  };

  const handleLogout = async () => {
    await logout();
    handleMenuClose();
    navigate('/login');
  };

  const handleHelpOpen = () => {
    setHelpOpen(true);
  };

  const handleHelpClose = () => {
    setHelpOpen(false);
  };

  // 通知データを取得
  const fetchNotifications = async () => {
    console.log('=== fetchNotifications called ===');
    console.log('isAuthenticated:', isAuthenticated);
    
    try {
      console.log('Calling getRecentNotifications API...');
      const data = await getRecentNotifications();
      console.log('API response received:', data);
      console.log('Notifications count:', data.notifications?.length || 0);
      
      setNotifications(data.notifications || []);
      setNotificationCount(data.total_count || 0);
      
      console.log('State updated - notifications:', data.notifications || []);
      console.log('State updated - notificationCount:', data.total_count || 0);
    } catch (error) {
      console.error('Error fetching notifications:', error);
      console.error('Error details:', error.message);
      console.error('Error stack:', error.stack);
      setNotifications([]);
      setNotificationCount(0);
    }
    
    console.log('=== fetchNotifications end ===');
  };

  // 認証時と5分間隔で通知を取得
  useEffect(() => {
    if (isAuthenticated) {
      fetchNotifications();
      const interval = setInterval(fetchNotifications, 5 * 60 * 1000); // 5分間隔
      return () => clearInterval(interval);
    }
  }, [isAuthenticated]);

  // 時刻をフォーマット（UTC → ユーザー設定のタイムゾーンに変換）
  const formatDateTime = (isoString) => {
    return formatUTCWithTimezone(isoString, 'MM/DD HH:mm');
  };

  // カメラビューに遷移
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
    
    handleMenuClose();
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

  const renderNotificationMenu = (
    <Menu
      anchorEl={notificationAnchorEl}
      anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      keepMounted
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      open={Boolean(notificationAnchorEl)}
      onClose={handleMenuClose}
      PaperProps={{
        style: {
          maxHeight: 400,
          width: 350,
        },
      }}
    >
      <MenuItem onClick={() => { handleMenuClose(); navigate('/notifications'); }}>
        <ListItemIcon>
          <Notifications />
        </ListItemIcon>
        <ListItemText primary={t('navigation:notificationListView')} />
      </MenuItem>
      <Divider />
      {notifications.length === 0 ? (
        <MenuItem disabled>
          <ListItemText primary={t('navigation:noRecentNotifications')} />
        </MenuItem>
      ) : (
        notifications.map((notification, index) => (
          <div key={notification.detect_log_id || index}>
            <MenuItem 
              onClick={() => handleNotificationClick(notification)}
              style={{ whiteSpace: 'normal', height: 'auto', alignItems: 'flex-start' }}
            >
              <Box sx={{ width: '100%', py: 1 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 'bold', flex: 1 }}>
                    {notification.place_name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {formatDateTime(notification.start_time)}
                  </Typography>
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  {notification.camera_name}
                </Typography>
                <Typography variant="body2" sx={{ mb: 1 }}>
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
              </Box>
            </MenuItem>
            {index < notifications.length - 1 && <Divider />}
          </div>
        ))
      )}
      <Divider />
      <MenuItem onClick={() => { handleMenuClose(); navigate('/notifications'); }}>
        <ListItemIcon>
          <Notifications />
        </ListItemIcon>
        <ListItemText primary={t('navigation:notificationListView')} />
      </MenuItem>
    </Menu>
  );

  const renderMenu = (
    <Menu
      anchorEl={anchorEl}
      anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      keepMounted
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      open={Boolean(anchorEl)}
      onClose={handleMenuClose}
    >
      <MenuItem onClick={() => { handleMenuClose(); navigate('/profile'); }}>{t('navigation:profile')}</MenuItem>
      <MenuItem onClick={handleLogout}>{t('navigation:logout')}</MenuItem>
    </Menu>
  );

  const renderMobileMenu = (
    <Menu
      anchorEl={mobileMenuAnchorEl}
      anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      keepMounted
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      open={Boolean(mobileMenuAnchorEl)}
      onClose={handleMenuClose}
    >
      <MenuItem onClick={() => { handleMenuClose(); navigate('/places'); }}>
        <ListItemIcon>
          <LocationOn />
        </ListItemIcon>
        <ListItemText primary={t('navigation:places')} />
      </MenuItem>
      <MenuItem onClick={() => { handleMenuClose(); navigate('/'); }}>
        <ListItemIcon>
          <CameraAlt />
        </ListItemIcon>
        <ListItemText primary={t('navigation:cameras')} />
      </MenuItem>
      <MenuItem onClick={() => { handleMenuClose(); navigate('/test-movie'); }}>
        <ListItemIcon>
          <Movie />
        </ListItemIcon>
        <ListItemText primary={t('navigation:testMovie')} />
      </MenuItem>
      <MenuItem onClick={() => { handleMenuClose(); navigate('/bookmark'); }}>
        <ListItemIcon>
          <Bookmark />
        </ListItemIcon>
        <ListItemText primary={t('navigation:bookmarks')} />
      </MenuItem>
      {/* <MenuItem onClick={() => { handleMenuClose(); navigate('/notifications'); }}>
        {t('navigation:notificationList')}
      </MenuItem> */}
      <MenuItem onClick={() => { handleMenuClose(); navigate('/search'); }}>
        {t('navigation:search')}
      </MenuItem>
      <MenuItem onClick={() => { handleMenuClose(); navigate('/insight'); }}>
        {t('navigation:insights')}
      </MenuItem>
      <MenuItem onClick={() => { handleMenuClose(); navigate('/tag'); }}>
        <ListItemIcon>
          <LocalOffer />
        </ListItemIcon>
        <ListItemText primary={t('navigation:tagManagement')} />
      </MenuItem>
      <MenuItem onClick={() => { handleMenuClose(); handleHelpOpen(); }}>
        <ListItemIcon>
          <HelpIcon />
        </ListItemIcon>
        <ListItemText primary={t('navigation:help')} />
      </MenuItem>
      <MenuItem onClick={() => { handleMenuClose(); navigate('/profile'); }}>
        {t('navigation:profile')}
      </MenuItem>
      <MenuItem onClick={handleLogout}>
        {t('navigation:logout')}
      </MenuItem>
    </Menu>
  );

  return (
    <AppBar position="fixed" sx={{ zIndex: 1100 }}>
      <Toolbar>
        <Box component={Link} to="/" sx={{ flexGrow: 1, textDecoration: 'none', color: 'white', display: 'flex', alignItems: 'baseline', gap: 2 }}>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            CEDIX
          </Typography>
          {/* <Typography variant="caption" sx={{ 
            fontSize: '0.75rem', 
            fontWeight: 'bold',
            opacity: 0.8, 
            display: { xs: 'none', md: 'block' },
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: '500px'
          }}>
            現場の監視カメラをAWSに接続 + 映像をAIで解析して現場の状況を自動解析
          </Typography> */}
        </Box>
        
        {isAuthenticated ? (
          <>
            {/* デスクトップ版 */}
            <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center' }}>
              <Button color="inherit" component={Link} to="/places" sx={{ mr: 1 }}>
                <LocationOn sx={{ mr: 1 }} />
                {t('navigation:places')}
              </Button>
              <Button color="inherit" component={Link} to="/" sx={{ mr: 1 }}>
                <CameraAlt sx={{ mr: 1 }} />
                {t('navigation:cameras')}
              </Button>
              <Button color="inherit" component={Link} to="/test-movie" sx={{ mr: 1 }}>
                <Movie sx={{ mr: 1 }} />
                {t('navigation:testMovie')}
              </Button>
              <Button color="inherit" component={Link} to="/bookmark" sx={{ mr: 1 }}>
                <Bookmark sx={{ mr: 1 }} />
                {t('navigation:bookmarks')}
              </Button>
              {/* <Button color="inherit" component={Link} to="/notifications">
                {t('navigation:notificationList')}
              </Button> */}
              <Button color="inherit" component={Link} to="/search" sx={{ mr: 1 }}>
                <Search sx={{ mr: 1 }} />
                {t('navigation:search')}
              </Button>
              <Button color="inherit" component={Link} to="/insight" sx={{ mr: 1 }}>
                <Insights sx={{ mr: 1 }} />
                {t('navigation:insights')}
              </Button>
              <Button color="inherit" component={Link} to="/tag" sx={{ mr: 1 }}>
                <LocalOffer sx={{ mr: 1 }} />
                {t('navigation:tagManagement')}
              </Button>
              <Box sx={{ mr: 2 }}>
                <TimezoneSelector />
              </Box>
              <Box sx={{ mr: 2 }}>
                <LocaleSelector />
              </Box>
              <IconButton
                color="inherit"
                onClick={handleNotificationMenuOpen}
                sx={{ ml: 1 }}
              >
                <Badge badgeContent={notificationCount} color="error">
                  <Notifications />
                </Badge>
              </IconButton>
              <IconButton
                color="inherit"
                onClick={handleHelpOpen}
                sx={{ ml: 1 }}
                title={t('navigation:help')}
              >
                <HelpIcon />
              </IconButton>
              <IconButton
                edge="end"
                aria-label="account of current user"
                aria-controls="menu-appbar"
                aria-haspopup="true"
                onClick={handleProfileMenuOpen}
                color="inherit"
              >
                {user?.attributes?.picture ? (
                  <Avatar src={user.attributes.picture} alt={user.username} />
                ) : (
                  <AccountCircle />
                )}
              </IconButton>
            </Box>
            
            {/* モバイル版 */}
            <Box sx={{ display: { xs: 'flex', md: 'none' }, alignItems: 'center' }}>
              <IconButton
                color="inherit"
                onClick={handleNotificationMenuOpen}
                sx={{ mr: 1 }}
              >
                <Badge badgeContent={notificationCount} color="error">
                  <Notifications />
                </Badge>
              </IconButton>
              <IconButton
                aria-label="show more"
                aria-controls="menu-mobile"
                aria-haspopup="true"
                onClick={handleMobileMenuOpen}
                color="inherit"
              >
                <MenuIcon />
              </IconButton>
            </Box>
            
            {renderNotificationMenu}
            {renderMenu}
            {renderMobileMenu}
          </>
        ) : (
          <Button color="inherit" component={Link} to="/login">
            {t('navigation:login')}
          </Button>
        )}
      </Toolbar>
      
      {/* ヘルプダイアログ */}
      <Help open={helpOpen} onClose={handleHelpClose} />
    </AppBar>
  );
};

export default Header;
