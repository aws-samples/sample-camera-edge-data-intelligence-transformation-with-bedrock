import React, { useEffect, useRef } from 'react';
import Hls from 'hls.js';

const VideoPlayer = ({ 
  src, 
  autoPlay = true, 
  controls = true, 
  muted = false, 
  poster = null, 
  onEnded = null,
  hlsConfig = {},
  onError = null,
  isHls = false
}) => {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const isPlayingRef = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    
    if (!video) return;
    
    // Add ended event listener
    if (onEnded) {
      video.addEventListener('ended', onEnded);
    }

    // Add error event listener
    const handleError = (error) => {
      console.error('Video error:', error);
      if (onError) onError(error);
    };
    video.addEventListener('error', handleError);
    
    // Function to load video source
    const loadVideo = async () => {
      // Clean up any existing HLS instance
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      
      // Reset video source
      video.pause();
      video.removeAttribute('src');
      video.load();
      
      // HLSストリーミングの場合
      if (isHls || (src && src.endsWith('.m3u8'))) {
        // Check if HLS is supported
        if (Hls.isSupported()) {
          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: true,
            backBufferLength: 90,
            ...hlsConfig
          });
          
          hls.loadSource(src);
          hls.attachMedia(video);
          
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (autoPlay && !isPlayingRef.current) {
              isPlayingRef.current = true;
              video.play().catch(error => {
                console.error('Error attempting to play HLS video:', error);
                if (onError) onError(error);
              });
            }
          });
          
          hls.on(Hls.Events.ERROR, (event, data) => {
            console.error('HLS error:', data);
            if (onError) onError(data);
            
            if (data.fatal) {
              switch (data.type) {
                case Hls.ErrorTypes.NETWORK_ERROR:
                  console.log('Network error, trying to recover...');
                  hls.startLoad();
                  break;
                case Hls.ErrorTypes.MEDIA_ERROR:
                  console.log('Media error, trying to recover...');
                  hls.recoverMediaError();
                  break;
                default:
                  console.error('Fatal error, cannot recover');
                  hls.destroy();
                  break;
              }
            }
          });
          
          hlsRef.current = hls;
        } 
        // For browsers that natively support HLS (Safari)
        else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = src;
          if (autoPlay && !isPlayingRef.current) {
            isPlayingRef.current = true;
            video.play().catch(error => {
              console.error('Error attempting to play HLS video in Safari:', error);
              if (onError) onError(error);
            });
          }
        } else {
          console.error('HLS is not supported in this browser');
          if (onError) onError(new Error('HLS is not supported in this browser'));
        }
      } 
      // MP4動画の場合
      else if (src) {
        try {
          video.src = src;
          await video.load(); // 明示的にload()を呼び出し
          
          if (autoPlay && !isPlayingRef.current) {
            isPlayingRef.current = true;
            await video.play();
          }
        } catch (error) {
          console.error('Error attempting to play MP4 video:', error);
          if (onError) onError(error);
        }
      }
    };
    
    loadVideo();
    
    // Cleanup function
    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      
      if (video) {
        // Remove event listeners
        if (onEnded) {
          video.removeEventListener('ended', onEnded);
        }
        video.removeEventListener('error', handleError);
        
        video.pause();
        video.removeAttribute('src');
        video.load();
        isPlayingRef.current = false;
      }
    };
  }, [src, autoPlay, onEnded, hlsConfig, onError, isHls]);
  
  return (
    <video
      ref={videoRef}
      className="video-player"
      controls={controls}
      muted={muted}
      poster={poster}
      playsInline
      crossOrigin="anonymous"
      preload="auto"
      style={{
        width: '100%',
        height: '100%',
        maxWidth: '100%',
        maxHeight: '100%',
        objectFit: 'contain'
      }}
    />
  );
};

export default VideoPlayer;
