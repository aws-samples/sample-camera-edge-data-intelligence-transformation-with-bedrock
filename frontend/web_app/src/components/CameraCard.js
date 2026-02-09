import React, { useState } from 'react';
import { Card, CardActionArea, CardContent, CardMedia, Typography, Box, IconButton, Tooltip } from '@mui/material';
import { Settings as SettingsIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';

const CameraCard = ({ camera }) => {
  const navigate = useNavigate();
  const [imgError, setImgError] = useState(false);

  // Use presigned_url if available, otherwise fallback to image_url, thumbnail or placeholder
  const imageUrl = camera.presigned_url || camera.image_url || camera.thumbnail || 
    `https://via.placeholder.com/300x200?text=${encodeURIComponent(camera.name)}`;

  const handleClick = () => {
    navigate(`/camera/${camera.camera_id}`);
  };

  const handleEditClick = (e) => {
    e.stopPropagation(); // カードのクリックイベントを阻止
    navigate(`/camera/${camera.camera_id}/edit`);
  };

  return (
    <Card
      className="camera-card"
      sx={{
        height: 320, // 必要に応じて調整
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
      }}
    >
      {/* システム設定アイコン */}
      <Box
        sx={{
          position: 'absolute',
          bottom: 8,
          right: 8,
          zIndex: 1,
        }}
      >
        <Tooltip title="カメラ設定を編集">
          <IconButton
            onClick={handleEditClick}
            sx={{
              color: 'inherit',
              '&:hover': {
                backgroundColor: 'rgba(0, 0, 0, 0.1)',
              },
            }}
            size="small"
          >
            <SettingsIcon />
          </IconButton>
        </Tooltip>
      </Box>

      <CardActionArea
        onClick={handleClick}
        sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}
      >
        {!imgError ? (
          <CardMedia
            component="img"
            height="200"
            image={imageUrl}
            alt={camera.name}
            className="camera-thumbnail"
            onError={() => setImgError(true)}
            sx={{
              backgroundColor: '#000000',
              minHeight: '200px',
              objectFit: 'cover',
            }}
          />
        ) : (
          <Box
            sx={{
              width: '100%',
              height: '200px',
              backgroundColor: '#000000',
            }}
          />
        )}
        <CardContent
          className="camera-info"
          sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-start' }}
        >
          <Typography variant="h6" component="h3" className="camera-name">
            {camera.name}
          </Typography>
          <Typography variant="body2" color="textSecondary" className="camera-location">
            {camera.place_name || '場所不明'}
          </Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  );
};

export default CameraCard;
