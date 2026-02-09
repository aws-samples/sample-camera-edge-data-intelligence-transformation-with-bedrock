import React, { useEffect, useRef, useState } from 'react';
import { Box, Button, Typography, Alert } from '@mui/material';

const VSaaSPlayer = ({ 
  apiKey, 
  deviceId, 
  autoPlay = true, 
  onError, 
  onPlayerReady,
  width = '100%',
  height = '100%',
  style = {}
}) => {
  const playerRef = useRef(null);
  const [player, setPlayer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('初期化中');

  useEffect(() => {
    if (!apiKey || !deviceId) {
      setError('APIキーまたはデバイスIDが設定されていません');
      setLoading(false);
      return;
    }

    let isMounted = true;
    let playerInstance = null;

    const initializeVSaaS = async () => {
      try {
        setLoading(true);
        setError(null);
        setStatus('VSaaS SDKを初期化中...');

        // Wait for VSaaS SDK to be loaded
        let retryCount = 0;
        const maxRetries = 10;
        while (typeof window.VSaaS === 'undefined' && retryCount < maxRetries) {
          console.log(`Waiting for VSaaS SDK... (${retryCount + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, 500));
          retryCount++;
        }
        
        if (typeof window.VSaaS === 'undefined') {
          throw new Error('VSaaS SDK が読み込まれていません');
        }

        // API Keyを設定
        await window.VSaaS.Auth.setToken(apiKey, 'apiKey');
        setStatus('認証完了');

        if (!isMounted) return;

        // プレイヤーインスタンスを作成
        console.log('Creating VSaaS player instance...');
        playerInstance = new window.VSaaS.Player.StreamingPlayer(playerRef.current);
        
        // イベントリスナーを設定
        setupPlayerEventListeners(playerInstance);
        
        // デバイスIDを設定
        playerInstance.deviceId = deviceId;
        
        setPlayer(playerInstance);
        
        // UI表示を更新してから自動再生
        setLoading(false);
        setStatus('接続済み');

        // onPlayerReady callback
        if (onPlayerReady) {
          onPlayerReady(playerInstance);
        }

        // 自動再生（常時ミュート）
        if (autoPlay) {
          setTimeout(() => {
            try {
              // 音声は常時無効
              playerInstance.muted = true;
              // ユーザー操作を有効化
              playerInstance.userInteractions = true;
              const playResult = playerInstance.play();
              console.log('Play method result:', playResult);
            } catch (error) {
              console.error('Initial autoplay error:', error);
            }
          }, 100);
        }

      } catch (error) {
        console.error('VSaaS player initialization error:', error);
        if (isMounted) {
          setError(`初期化エラー: ${error.message}`);
          setLoading(false);
          setStatus('エラー');
          if (onError) {
            onError(error);
          }
        }
      }
    };

    // Initialize VSaaS player
    initializeVSaaS();

    return () => {
      isMounted = false;
      if (playerInstance) {
        try {
          console.log('Cleaning up VSaaS player...');
          playerInstance.pause();
          // プレイヤーを完全に破棄
          if (typeof playerInstance.destroy === 'function') {
            playerInstance.destroy();
          }
        } catch (error) {
          console.error('Error cleaning up player:', error);
        }
      }
    };
  }, [apiKey, deviceId]); // autoPlay, onError, onPlayerReady を依存配列から除外

  const setupPlayerEventListeners = (playerInstance) => {
    // ステータス変更イベント
    playerInstance.on(window.VSaaS.Player.PlayerEvent.STATUS_CHANGE, ({ status: newStatus, context }) => {
      console.log('=== VSaaS player status changed ===');
      console.log('Status:', newStatus);
      console.log('Context:', context);
      
      setStatus(newStatus);

      if (newStatus === window.VSaaS.Player.PlayerStatus.Error) {
        const errorMsg = context?.error?.message || 'プレイヤーエラー';
        console.error('Player error details:', context?.error);
        setError(errorMsg);
        if (onError) {
          onError(new Error(errorMsg));
        }
      } else {
        setError(null);
      }
    });
  };

  return (
    <Box sx={{ 
      width, 
      height, 
      position: 'relative',
      ...style 
    }}>
      {/* プレイヤーコンテナ */}
      <Box
        ref={playerRef}
        sx={{
          width: '100%',
          height: '100%',
          backgroundColor: '#000',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          '& video': {
            objectFit: 'contain !important',
            width: '100% !important',
            height: '100% !important'
          }
        }}
      >
        {loading && (
          <Typography 
            color="white" 
            sx={{ 
              position: 'absolute', 
              top: '50%', 
              left: '50%', 
              transform: 'translate(-50%, -50%)',
              zIndex: 1 
            }}
          >
            {status}
          </Typography>
        )}
      </Box>

      {/* エラー表示 */}
      {error && (
        <Alert severity="error" sx={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 2 }}>
          {error}
        </Alert>
      )}
    </Box>
  );
};

export default VSaaSPlayer; 