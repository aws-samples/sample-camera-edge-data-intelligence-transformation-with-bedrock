import React from 'react';
import { Box } from '@mui/material';
import Header from './Header';

/**
 * PageLayout - ページ全体のレイアウトラッパーコンポーネント
 * 
 * Header + TitleArea + コンテンツ という統一されたレイアウト構造を提供
 * 
 * @param {React.ReactNode} children - ページコンテンツ
 * @param {number} width - ページの幅（通常は100%、Drawerがある場合は調整）
 * @param {object} sx - 追加のスタイル
 */
const PageLayout = ({ 
  children,
  width = '100%',
  sx = {},
}) => {
  return (
    <>
      <Header />
      <Box
        sx={{
          display: 'flex',
          minHeight: '100vh',
          width: '100%',
          ...sx,
        }}
      >
        <Box
          sx={{
            width: width,
            position: 'relative',
            flexShrink: 0,
          }}
        >
          {children}
        </Box>
      </Box>
    </>
  );
};

export default PageLayout;

