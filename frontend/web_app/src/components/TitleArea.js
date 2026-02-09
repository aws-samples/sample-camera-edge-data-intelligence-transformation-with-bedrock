import React from 'react';
import { Paper, Box, IconButton, Typography } from '@mui/material';
import { ArrowBack } from '@mui/icons-material';
import { Link } from 'react-router-dom';
import { HEADER_HEIGHT, TITLE_AREA_HEIGHT } from '../constants/layout';

/**
 * TitleArea - 固定タイトルバーコンポーネント
 * 
 * @param {string} title - ページタイトル
 * @param {string|null} backTo - 戻るリンク先（nullの場合は表示しない）
 * @param {React.ReactNode} leftContent - タイトル右側に配置する追加コンテンツ
 * @param {React.ReactNode} rightContent - 右側に配置するアクションボタンなど
 * @param {number} rightOffset - 右側のオフセット（Drawerなど）
 * @param {object} sx - 追加のスタイル
 */
const TitleArea = ({ 
  title, 
  backTo = null,
  leftContent = null,
  rightContent = null,
  rightOffset = 0,
  sx = {},
}) => {
  return (
    <Paper
      elevation={2}
      sx={{
        position: 'fixed',
        top: `${HEADER_HEIGHT}px`,
        left: 0,
        right: `${rightOffset}px`,
        height: `${TITLE_AREA_HEIGHT}px`,
        zIndex: 1090,
        backgroundColor: 'white',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        px: 3,
        transition: 'right 0.3s ease',
        ...sx,
      }}
    >
      {/* 左側 */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        {backTo && (
          <IconButton 
            component={Link} 
            to={backTo} 
            size="medium"
            aria-label="戻る"
          >
            <ArrowBack />
          </IconButton>
        )}
        <Typography variant="h5" component="h1">
          {title}
        </Typography>
        {leftContent}
      </Box>
      
      {/* 右側 */}
      {rightContent && (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          {rightContent}
        </Box>
      )}
    </Paper>
  );
};

export default TitleArea;

