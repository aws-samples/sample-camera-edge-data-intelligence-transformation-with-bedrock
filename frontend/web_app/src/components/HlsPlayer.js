import React, { useEffect, useRef } from 'react';
import Hls from 'hls.js';

const HlsPlayer = ({ 
  src, 
  autoPlay = true, 
  controls = true, 
  muted = false, 
  poster = null, 
  onEnded = null,
  hlsConfig = {},
  onError = null,
  onPlayerReady = null,
  onSessionExpired = null,  // セッション期限切れ時のコールバック
  liveMode = false,  // ライブモード：タブ復帰時にライブエッジへシーク
  width = '100%',
  height = '100%',
  style = {}
}) => {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const isPlayingRef = useRef(false);
  const sessionExpiredHandledRef = useRef(false);  // セッション期限切れ処理済みフラグ

  // タブ復帰時にライブエッジへシークするハンドラ
  useEffect(() => {
    if (!liveMode) return;
    
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const video = videoRef.current;
        const hls = hlsRef.current;
        
        console.log('[HlsPlayer] Tab became visible, checking live edge...');
        
        if (video && hls) {
          // ライブエッジへシーク
          const liveEdge = hls.liveSyncPosition;
          const currentTime = video.currentTime;
          const delay = liveEdge - currentTime;
          
          console.log(`[HlsPlayer] currentTime=${currentTime?.toFixed(1)}s, liveEdge=${liveEdge?.toFixed(1)}s, delay=${delay?.toFixed(1)}s`);
          
          // 3秒以上遅れている場合のみシーク
          if (liveEdge && liveEdge > 0 && delay > 3) {
            console.log(`[HlsPlayer] Seeking to live edge (delay=${delay.toFixed(1)}s)`);
            
            // シーク完了後に再生
            const onSeeked = () => {
              video.removeEventListener('seeked', onSeeked);
              if (video.paused) {
                video.play().catch(e => console.error('[HlsPlayer] Resume play failed:', e));
              }
            };
            video.addEventListener('seeked', onSeeked);
            video.currentTime = liveEdge;
          } else if (video.paused) {
            // 遅れが少ない場合は再生のみ
            video.play().catch(e => console.error('[HlsPlayer] Resume play failed:', e));
          }
        } else {
          console.log('[HlsPlayer] video or hls not available');
        }
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [liveMode]);

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
    
    // Function to load HLS video source
    const loadHlsVideo = async () => {
      // Clean up any existing HLS instance
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      
      // セッション期限切れフラグをリセット（新しいURLで再開するため）
      sessionExpiredHandledRef.current = false;
      
      // Reset video source
      video.pause();
      video.removeAttribute('src');
      video.load();
      
      if (!src) return;
      
      // HLSストリーミングの処理
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          backBufferLength: 90,
          maxBufferLength: 30, // ダッシュボード用に制限
          maxMaxBufferLength: 60, // ダッシュボード用に制限
          ...hlsConfig
        });
        
        hls.loadSource(src);
        hls.attachMedia(video);
        
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          console.log('HLS manifest parsed successfully');
          
          if (autoPlay && !isPlayingRef.current) {
            isPlayingRef.current = true;
            video.play().catch(error => {
              // Autoplay blocked - try muted playback as fallback
              if (error.name === 'NotAllowedError') {
                console.log('Autoplay blocked, trying muted playback...');
                video.muted = true;
                video.play().then(() => {
                  console.log('Muted autoplay successful');
                }).catch(mutedError => {
                  console.error('Even muted autoplay failed:', mutedError);
                  if (onError) onError(mutedError);
                });
              } else {
                console.error('Error attempting to play HLS video:', error);
                if (onError) onError(error);
              }
            });
          }
        });
        
        // onPlayerReadyはloadedmetadataイベント後に呼び出す
        // （MANIFEST_PARSED時点ではvideoWidth/videoHeightが取得できないため）
        video.addEventListener('loadedmetadata', () => {
          console.log('HLS video metadata loaded:', video.videoWidth, 'x', video.videoHeight);
          if (onPlayerReady) {
            onPlayerReady(video);
          }
        }, { once: true });
        
        hls.on(Hls.Events.ERROR, (event, data) => {
          console.error('HLS error:', data);
          if (onError) onError(data);
          
          // セッション期限切れの検出（403エラー）
          const isSessionExpired = 
            data.response?.code === 403 || 
            data.details === 'manifestLoadError' && data.response?.code === 403;
          
          if (isSessionExpired && onSessionExpired && !sessionExpiredHandledRef.current) {
            console.log('HLS session expired, requesting URL refresh...');
            sessionExpiredHandledRef.current = true;
            hls.destroy();
            hlsRef.current = null;
            onSessionExpired();
            return;
          }
          
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                // セッション期限切れ以外のネットワークエラーは再試行
                if (!isSessionExpired) {
                  console.log('Network error, trying to recover...');
                  hls.startLoad();
                } else {
                  console.log('Session expired, cannot recover with startLoad');
                  hls.destroy();
                  hlsRef.current = null;
                }
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                console.log('Media error, trying to recover...');
                hls.recoverMediaError();
                break;
              default:
                console.error('Fatal error, cannot recover');
                hls.destroy();
                hlsRef.current = null;
                break;
            }
          }
        });
        
        hlsRef.current = hls;
      } 
      // For browsers that natively support HLS (Safari)
      else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = src;
        
        video.addEventListener('loadedmetadata', () => {
          console.log('HLS loaded in Safari');
          if (onPlayerReady) {
            onPlayerReady(video);
          }
        });
        
        if (autoPlay && !isPlayingRef.current) {
          isPlayingRef.current = true;
          video.play().catch(error => {
            // Autoplay blocked - try muted playback as fallback
            if (error.name === 'NotAllowedError') {
              console.log('Autoplay blocked in Safari, trying muted playback...');
              video.muted = true;
              video.play().then(() => {
                console.log('Muted autoplay successful in Safari');
              }).catch(mutedError => {
                console.error('Even muted autoplay failed in Safari:', mutedError);
                if (onError) onError(mutedError);
              });
            } else {
              console.error('Error attempting to play HLS video in Safari:', error);
              if (onError) onError(error);
            }
          });
        }
      } else {
        const errorMsg = 'HLS is not supported in this browser';
        console.error(errorMsg);
        if (onError) onError(new Error(errorMsg));
      }
    };
    
    loadHlsVideo();
    
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
  }, [src, autoPlay, onEnded, hlsConfig, onError, onPlayerReady]);
  
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
        width, 
        height, 
        objectFit: 'cover',
        ...style 
      }}
    />
  );
};

export default HlsPlayer; 