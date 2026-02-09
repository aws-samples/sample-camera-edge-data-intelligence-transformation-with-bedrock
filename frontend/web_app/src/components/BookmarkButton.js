import React, { useState } from 'react';
import { Button, IconButton, Tooltip } from '@mui/material';
import { Bookmark } from '@mui/icons-material';
import BookmarkDialog from './BookmarkDialog';
import { useTranslation } from 'react-i18next';

/**
 * 汎用BookmarkButton
 * - bookmarkData: ブックマーク対象データ（file_id, file_type, collector, detector, datetime, camera_id, camera_name, place_id, place_name, など）
 * - onBookmarkAdded: ブックマーク追加成功時のコールバック
 * - buttonProps: MUI Button/アイコンボタンの追加props
 * - dialogProps: BookmarkDialogへの追加props
 * - variant: 'button'（デフォルト）または'icon'（アイコンのみ）
 */
const BookmarkButton = ({ 
  bookmarkData = {},
  fileId, 
  collector,
  collectorId,
  detector,
  detectorId,
  cameraId,
  cameraName,
  placeId,
  placeName,
  disabled = false,
  onBookmarkAdded,
  buttonProps = {},
  dialogProps = {},
  variant = 'button',
  tooltip
}) => {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  
  // tooltipが指定されていない場合はデフォルト値を使用
  const tooltipText = tooltip || t('addBookmark');

  // bookmarkData優先、なければ個別propsから生成
  const mergedBookmarkData = {
    file_id: bookmarkData.file_id || fileId,
    collector: bookmarkData.collector || collector,
    collector_id: bookmarkData.collector_id || collectorId,
    detector: bookmarkData.detector || detector,
    detector_id: bookmarkData.detector_id || detectorId,
    camera_id: bookmarkData.camera_id || cameraId,
    camera_name: bookmarkData.camera_name || cameraName,
    place_id: bookmarkData.place_id || placeId,
    place_name: bookmarkData.place_name || placeName,
    ...bookmarkData
  };

  const handleBookmarkAdded = (...args) => {
    setOpen(false);
    if (onBookmarkAdded) onBookmarkAdded(...args);
  };

  return (
    <>
      {variant === 'icon' ? (
        <Tooltip title={tooltipText}>
          <span>
            <IconButton
              color="primary"
              onClick={() => setOpen(true)}
              disabled={disabled}
              size="small"
              {...buttonProps}
            >
              <Bookmark fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      ) : (
        <Button
          variant="contained"
          color="primary"
          startIcon={<Bookmark />}
          onClick={() => setOpen(true)}
          disabled={disabled}
          sx={{ borderRadius: 2 }}
          {...buttonProps}
        >
          {tooltipText}
        </Button>
      )}
      <BookmarkDialog
        open={open}
        onClose={() => setOpen(false)}
        bookmarkData={mergedBookmarkData}
        onSuccess={handleBookmarkAdded}
        {...dialogProps}
      />
    </>
  );
};

export default BookmarkButton; 