import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Paper, Typography, IconButton, CircularProgress, Modal } from '@mui/material';
import { ZoomIn, ZoomOut, FullscreenExit, Fullscreen } from '@mui/icons-material';
import { downloadFile } from '../services/api';

const ImageViewer = ({ 
  images = [], 
  selectedImage = null, 
  onImageSelect = null,
  currentTime = null,
  showThumbnails = true,  // サムネイルリストを表示するかどうか
  detectArea = null,      // ポリゴン座標JSON（例: "[[100,100],[200,100],[200,200]]"）
  videoWidth = 1280,      // 映像幅（ポリゴン座標の基準解像度）
  videoHeight = 720       // 映像高さ（ポリゴン座標の基準解像度）
}) => {
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [imageCache, setImageCache] = useState({}); // Cache for presigned URLs
  const [loadingImages, setLoadingImages] = useState({}); // Track loading state
  const thumbnailContainerRef = useRef(null);
  const imageContainerRef = useRef(null);
  const canvasRef = useRef(null);

  // Update current image when selectedImage changes
  useEffect(() => {
    console.log('ImageViewer useEffect - selectedImage changed:', selectedImage);
    console.log('ImageViewer useEffect - images length:', images.length);
    
    if (selectedImage && images.length > 0) {
      const index = images.findIndex(img => img.id === selectedImage.id);
      console.log('Found image index:', index);
      if (index !== -1) {
        setCurrentImageIndex(index);
        // Scroll to the selected thumbnail
        if (showThumbnails) {
          scrollToThumbnail(index);
        }
      }
    }
  }, [selectedImage, images, showThumbnails]);

  // Scroll to thumbnail function
  const scrollToThumbnail = (index) => {
    if (thumbnailContainerRef.current && index >= 0) {
      const container = thumbnailContainerRef.current;
      const thumbnailWidth = 120 + 8; // thumbnail width + gap
      const containerWidth = container.offsetWidth;
      const scrollPosition = (index * thumbnailWidth) - (containerWidth / 2) + (thumbnailWidth / 2);
      
      container.scrollTo({
        left: Math.max(0, scrollPosition),
        behavior: 'smooth'
      });
    }
  };

  // Handle image selection from thumbnail
  const handleImageSelect = (image, index) => {
    console.log('ImageViewer handleImageSelect called with:', image, index);
    setCurrentImageIndex(index);
    if (showThumbnails) {
      scrollToThumbnail(index);
    }
    if (onImageSelect) {
      console.log('Calling onImageSelect with image:', image);
      onImageSelect(image);
    }
  };

  // Handle zoom controls
  const handleZoomIn = () => {
    setZoom(prev => Math.min(prev * 1.2, 5));
  };

  const handleZoomOut = () => {
    setZoom(prev => Math.max(prev / 1.2, 0.1));
  };

  const handleResetZoom = () => {
    setZoom(1);
  };

  // Handle fullscreen toggle
  const handleFullscreenToggle = () => {
    setIsFullscreen(!isFullscreen);
    // Reset zoom when entering/exiting fullscreen
    setZoom(1);
  };

  const currentImage = images[currentImageIndex];
  
  console.log('=== ImageViewer render ===');
  console.log('selectedImage prop:', selectedImage);
  console.log('currentImageIndex:', currentImageIndex);
  console.log('currentImage:', currentImage);
  console.log('images length:', images.length);
  console.log('showThumbnails:', showThumbnails);

  // Load presigned URL for an image
  const loadPresignedUrl = async (image) => {
    if (!image || !image.id || imageCache[image.id] || loadingImages[image.id]) {
      return; // Already cached, loading, or invalid image
    }

    setLoadingImages(prev => ({ ...prev, [image.id]: true }));
    
    try {
      console.log('Loading presigned URL for image:', image.id);
      const downloadData = await downloadFile(image.id);
      
      if (downloadData && downloadData.presigned_url) {
        console.log('Successfully got presigned URL for image:', image.id);
        setImageCache(prev => ({
          ...prev,
          [image.id]: downloadData.presigned_url
        }));
      } else {
        console.warn('No presigned URL in download data for image:', image.id);
      }
    } catch (err) {
      console.error('Error loading presigned URL for image:', image.id, err);
    } finally {
      setLoadingImages(prev => ({ ...prev, [image.id]: false }));
    }
  };

  // Get the URL to use for an image (presigned URL, cached URL, or s3path)
  const getImageUrl = (image) => {
    if (!image) return null;
    
    // presigned_url が渡されている場合は最優先で使用（キャッシュより優先）
    // これにより、検出画像切り替え時に新しいURLが正しく反映される
    if (image.presigned_url) {
      return image.presigned_url;
    }
    
    // Check cache (presigned_url がない場合のフォールバック)
    if (imageCache[image.id]) {
      return imageCache[image.id];
    }
    
    // Fall back to s3path if available
    if (image.url) {
      return image.url;
    }
    
    // Otherwise, trigger loading of presigned URL
    loadPresignedUrl(image);
    return null;
  };

  // Load presigned URLs for current and nearby images
  useEffect(() => {
    if (!currentImage) return;
    
    // Load current image
    if (!getImageUrl(currentImage)) {
      loadPresignedUrl(currentImage);
    }
    
    // Preload next and previous images
    const nextIndex = currentImageIndex + 1;
    const prevIndex = currentImageIndex - 1;
    
    if (nextIndex < images.length) {
      const nextImage = images[nextIndex];
      if (!getImageUrl(nextImage)) {
        loadPresignedUrl(nextImage);
      }
    }
    
    if (prevIndex >= 0) {
      const prevImage = images[prevIndex];
      if (!getImageUrl(prevImage)) {
        loadPresignedUrl(prevImage);
      }
    }
  }, [currentImageIndex, images, currentImage]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (e.key === 'ArrowLeft' && currentImageIndex > 0) {
        handleImageSelect(images[currentImageIndex - 1], currentImageIndex - 1);
      } else if (e.key === 'ArrowRight' && currentImageIndex < images.length - 1) {
        handleImageSelect(images[currentImageIndex + 1], currentImageIndex + 1);
      } else if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [currentImageIndex, images, isFullscreen]);

  // ポリゴン描画関数
  const drawDetectAreaPolygon = useCallback(() => {
    const canvas = canvasRef.current;
    const container = imageContainerRef.current;
    if (!canvas || !container || !detectArea || zoom !== 1) return;

    // ポリゴン座標をパース
    let points;
    try {
      points = JSON.parse(detectArea);
      if (!Array.isArray(points) || points.length < 3) return;
    } catch (e) {
      console.error('Failed to parse detectArea:', e);
      return;
    }

    // コンテナのサイズを取得
    const containerRect = container.getBoundingClientRect();
    if (containerRect.width === 0 || containerRect.height === 0) return;

    // 画像のアスペクト比を考慮して実際の表示サイズを計算
    const containerAspect = containerRect.width / containerRect.height;
    const imageAspect = videoWidth / videoHeight;
    
    let displayWidth, displayHeight, offsetX, offsetY;
    
    if (containerAspect > imageAspect) {
      // コンテナが横長 → 高さに合わせる
      displayHeight = containerRect.height;
      displayWidth = displayHeight * imageAspect;
      offsetX = (containerRect.width - displayWidth) / 2;
      offsetY = 0;
    } else {
      // コンテナが縦長 → 幅に合わせる
      displayWidth = containerRect.width;
      displayHeight = displayWidth / imageAspect;
      offsetX = 0;
      offsetY = (containerRect.height - displayHeight) / 2;
    }

    // Canvas サイズをコンテナに合わせる
    canvas.width = containerRect.width;
    canvas.height = containerRect.height;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // スケーリング係数
    const scaleX = displayWidth / videoWidth;
    const scaleY = displayHeight / videoHeight;

    // ポリゴン描画
    ctx.beginPath();
    const firstPoint = points[0];
    ctx.moveTo(firstPoint[0] * scaleX + offsetX, firstPoint[1] * scaleY + offsetY);
    
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i][0] * scaleX + offsetX, points[i][1] * scaleY + offsetY);
    }
    ctx.closePath();

    // 塗りつぶし
    ctx.fillStyle = 'rgba(0, 150, 255, 0.25)';
    ctx.fill();

    // 線
    ctx.strokeStyle = '#00BFFF';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 頂点
    points.forEach((point, index) => {
      const x = point[0] * scaleX + offsetX;
      const y = point[1] * scaleY + offsetY;
      ctx.beginPath();
      ctx.arc(x, y, index === 0 ? 5 : 3, 0, Math.PI * 2);
      ctx.fillStyle = index === 0 ? '#FF6B6B' : '#00BFFF';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.stroke();
    });
  }, [detectArea, videoWidth, videoHeight, zoom]);

  // ポリゴン描画のトリガー
  useEffect(() => {
    if (detectArea && zoom === 1 && !isFullscreen) {
      // 少し遅延させて画像のレンダリング完了後に描画
      const timer = setTimeout(drawDetectAreaPolygon, 100);
      return () => clearTimeout(timer);
    } else {
      // 条件を満たさない場合はCanvasをクリア
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
  }, [detectArea, currentImageIndex, zoom, isFullscreen, drawDetectAreaPolygon]);

  // ウィンドウリサイズ時にポリゴンを再描画
  useEffect(() => {
    if (!detectArea || zoom !== 1 || isFullscreen) return;
    
    const handleResize = () => {
      drawDetectAreaPolygon();
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [detectArea, zoom, isFullscreen, drawDetectAreaPolygon]);

  if (images.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 4 }}>
        <Typography variant="body1" color="text.secondary">
          画像がありません
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Main image display */}
      <Paper 
        elevation={2} 
        sx={{ 
          mb: showThumbnails ? 2 : 0,
          overflow: 'hidden',
          position: 'relative',
          backgroundColor: '#000',
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        {/* Image controls */}
        <Box
          sx={{
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 2,
            display: 'flex',
            gap: 1,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            borderRadius: 1,
            p: 0.5
          }}
        >
          <IconButton size="small" onClick={handleZoomOut} sx={{ color: 'white' }}>
            <ZoomOut />
          </IconButton>
          <IconButton size="small" onClick={handleResetZoom} sx={{ color: 'white' }}>
            <Typography variant="caption">{Math.round(zoom * 100)}%</Typography>
          </IconButton>
          <IconButton size="small" onClick={handleZoomIn} sx={{ color: 'white' }}>
            <ZoomIn />
          </IconButton>
          <IconButton size="small" onClick={handleFullscreenToggle} sx={{ color: 'white' }}>
            <Fullscreen />
          </IconButton>
        </Box>

        {/* Image display */}
        {currentImage ? (
          <Box
            ref={imageContainerRef}
            sx={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: zoom > 1 ? 'auto' : 'hidden',
              cursor: zoom > 1 ? 'move' : 'default',
              position: 'relative'
            }}
          >
            {loadingImages[currentImage.id] ? (
              <CircularProgress sx={{ color: 'white' }} />
            ) : getImageUrl(currentImage) ? (
              <>
                <img
                  src={getImageUrl(currentImage)}
                  alt="Selected"
                  style={{
                    width: zoom > 1 ? 'auto' : '100%',
                    height: zoom > 1 ? 'auto' : '100%',
                    maxWidth: '100%',
                    maxHeight: '100%',
                    objectFit: 'contain',
                    display: 'block',
                    transform: zoom > 1 ? `scale(${zoom})` : 'none'
                  }}
                  onError={(e) => {
                    console.error('Main image failed to load:', e.target.src);
                  }}
                  onLoad={drawDetectAreaPolygon}
                />
                {/* 検出エリアポリゴンオーバーレイ */}
                {detectArea && zoom === 1 && !isFullscreen && (
                  <canvas
                    ref={canvasRef}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: '100%',
                      pointerEvents: 'none'
                    }}
                  />
                )}
              </>
            ) : (
              <Box sx={{ textAlign: 'center', color: 'white' }}>
                <CircularProgress sx={{ color: 'white', mb: 2 }} />
                <Typography>画像を読み込み中...</Typography>
              </Box>
            )}
          </Box>
        ) : (
          <Box />
        )}
      </Paper>

      {/* Thumbnail strip - 条件付きで表示 */}
      {showThumbnails && images.length > 0 && (
        <Box
          ref={thumbnailContainerRef}
          sx={{
            display: 'flex',
            overflowX: 'auto',
            gap: 1,
            pb: 2,
            scrollBehavior: 'smooth',
            '&::-webkit-scrollbar': {
              height: 8,
            },
            '&::-webkit-scrollbar-track': {
              backgroundColor: '#f1f1f1',
              borderRadius: 4,
            },
            '&::-webkit-scrollbar-thumb': {
              backgroundColor: '#888',
              borderRadius: 4,
            },
            '&::-webkit-scrollbar-thumb:hover': {
              backgroundColor: '#555',
            },
          }}
        >
          {images.map((image, index) => (
            <Box
              key={image.id || index}
              onClick={() => handleImageSelect(image, index)}
              sx={{
                minWidth: 120,
                height: 80,
                cursor: 'pointer',
                border: currentImageIndex === index ? '3px solid #e67e22' : '2px solid transparent',
                borderRadius: 1,
                overflow: 'hidden',
                backgroundColor: image.has_detect ? 'rgba(255, 193, 7, 0.15)' : '#f5f5f5',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                transform: currentImageIndex === index ? 'scale(1.05)' : 'scale(1)',
                transition: 'all 0.2s ease',
                boxShadow: currentImageIndex === index ? '0 4px 8px rgba(230, 126, 34, 0.3)' : 'none',
                '&:hover': {
                  border: currentImageIndex === index ? '3px solid #e67e22' : '2px solid #ccc',
                  transform: 'scale(1.05)',
                }
              }}
            >
              {loadingImages[image.id] ? (
                <CircularProgress size={20} sx={{ color: '#666' }} />
              ) : getImageUrl(image) ? (
                <img
                  src={getImageUrl(image)}
                  alt={`Thumbnail ${index + 1}`}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    opacity: image.has_detect ? 0.85 : 1.0
                  }}
                  onError={(e) => {
                    console.error('Thumbnail failed to load:', e.target.src);
                  }}
                />
              ) : (
                <Box sx={{ textAlign: 'center', color: '#666', fontSize: '0.75rem' }}>
                  取得中...
                </Box>
              )}
              {/* Time overlay on thumbnail */}
              <Box
                sx={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  backgroundColor: image.has_detect 
                    ? 'rgba(255, 193, 7, 0.9)' 
                    : 'rgba(0, 0, 0, 0.7)',
                  color: 'white',
                  fontSize: '0.75rem',
                  textAlign: 'center',
                  py: 0.25
                }}
              >
                {image.startTime ? new Date(image.startTime).toLocaleTimeString('ja-JP', {
                  hour: '2-digit', 
                  minute: '2-digit',
                  second: '2-digit'
                }) : ''}
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {/* Fullscreen Modal */}
      <Modal
        open={isFullscreen}
        onClose={handleFullscreenToggle}
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(0, 0, 0, 0.95)'
        }}
      >
        <Box
          sx={{
            position: 'relative',
            width: '100vw',
            height: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            outline: 'none'
          }}
        >
          {currentImage && (
            <>
              {/* Fullscreen image controls */}
              <Box
                sx={{
                  position: 'absolute',
                  top: 8,
                  right: 8,
                  zIndex: 3,
                  display: 'flex',
                  gap: 1,
                  backgroundColor: 'rgba(0, 0, 0, 0.8)',
                  borderRadius: 1,
                  p: 0.5
                }}
              >
                <IconButton size="small" onClick={handleZoomOut} sx={{ color: 'white' }}>
                  <ZoomOut />
                </IconButton>
                <IconButton size="small" onClick={handleResetZoom} sx={{ color: 'white' }}>
                  <Typography variant="caption">{Math.round(zoom * 100)}%</Typography>
                </IconButton>
                <IconButton size="small" onClick={handleZoomIn} sx={{ color: 'white' }}>
                  <ZoomIn />
                </IconButton>
                <IconButton size="small" onClick={handleFullscreenToggle} sx={{ color: 'white' }}>
                  <FullscreenExit />
                </IconButton>
              </Box>

              {/* Fullscreen image */}
              <Box
                sx={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'auto'
                }}
              >
                {loadingImages[currentImage.id] ? (
                  <CircularProgress sx={{ color: 'white' }} />
                ) : getImageUrl(currentImage) ? (
                  <img
                    src={getImageUrl(currentImage)}
                    alt="Fullscreen"
                    style={{
                      maxWidth: zoom > 1 ? 'none' : '100%',
                      maxHeight: zoom > 1 ? 'none' : '100%',
                      width: zoom > 1 ? `${100 * zoom}%` : 'auto',
                      height: 'auto',
                      objectFit: 'contain'
                    }}
                  />
                ) : (
                  <Box sx={{ textAlign: 'center', color: 'white' }}>
                    <CircularProgress sx={{ color: 'white', mb: 2 }} />
                    <Typography>画像を読み込み中...</Typography>
                  </Box>
                )}
              </Box>
            </>
          )}
        </Box>
      </Modal>
    </Box>
  );
};

export default ImageViewer;
