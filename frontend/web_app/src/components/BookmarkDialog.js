import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  TextField,
  Box,
  Typography,
  Divider,
  Alert,
  CircularProgress,
  Paper
} from '@mui/material';
import { Add as AddIcon, Bookmark as BookmarkIcon } from '@mui/icons-material';
import { getUserBookmarks, createBookmark, addBookmarkDetail, createBookmarkDetail } from '../services/api';
import { useTranslation } from 'react-i18next';

const REQUIRED_FIELDS = ['file_id', 'collector', 'detector'];

const BookmarkDialog = ({ open, onClose, bookmarkData = {}, onSuccess, ...rest }) => {
  const { t } = useTranslation(['pages', 'messages', 'common']);
  const [bookmarks, setBookmarks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [selectedBookmark, setSelectedBookmark] = useState(null);
  const [newBookmarkName, setNewBookmarkName] = useState('');
  const [isCreatingNew, setIsCreatingNew] = useState(false);

  // 必須項目チェック
  const missingFields = REQUIRED_FIELDS.filter(f => !bookmarkData[f]);

  // ブックマーク一覧を取得
  const fetchBookmarksData = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getUserBookmarks();
      setBookmarks(data);
    } catch (err) {
      console.error('Error fetching bookmarks:', err);
      setError(t('messages:errors.fetchBookmarksFailed'));
    } finally {
      setLoading(false);
    }
  };

  // ダイアログが開かれた時にブックマーク一覧を取得
  useEffect(() => {
    if (open) {
      fetchBookmarksData();
      setNewBookmarkName('');
      setError(null);
      setSuccess(null);
    }
  }, [open]);

  // 既存ブックマークに追加
  const handleAddToBookmark = async (bookmark) => {
    try {
      await createBookmarkDetail({
        bookmark_id: bookmark.bookmark_id,
        ...bookmarkData,
        updatedate: new Date().toISOString()
      });
      setSuccess(t('pages:bookmark.added'));
      if (onSuccess) onSuccess(bookmark, bookmarkData);
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (error) {
      console.error('ブックマーク詳細の追加に失敗しました:', error);
      setError(t('messages:errors.addBookmarkFailed'));
    }
  };

  // 新規ブックマーク作成＋追加
  const handleCreateNewBookmark = async () => {
    if (!newBookmarkName.trim()) {
      alert(t('messages:validation.enterBookmarkName'));
      return;
    }
    try {
      setIsCreatingNew(true);
      const newBookmark = {
        bookmark_name: newBookmarkName
      };
      const createdBookmark = await createBookmark(newBookmark);
      await createBookmarkDetail({
        bookmark_id: createdBookmark.bookmark_id,
        ...bookmarkData,
        updatedate: new Date().toISOString()
      });
      if (onSuccess) onSuccess(createdBookmark, bookmarkData);
      onClose();
    } catch (error) {
      console.error('新しいブックマークの作成に失敗しました:', error);
      alert(t('messages:errors.createBookmarkFailed'));
    } finally {
      setIsCreatingNew(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth {...rest}>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <BookmarkIcon />
          {t('dialogs:bookmark.addToBookmark')}
        </Box>
      </DialogTitle>
      <DialogContent>
        {missingFields.length > 0 && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {t('dialogs:bookmark.missingFields', { fields: missingFields.join(', ') })}
          </Alert>
        )}
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {success && (
          <Alert severity="success" sx={{ mb: 2 }}>
            {success}
          </Alert>
        )}
        {/* ファイル情報表示 */}
        <Paper sx={{ p: 2, mb: 3, bgcolor: 'grey.50' }}>
          <Typography variant="subtitle2" gutterBottom>
            {t('dialogs:bookmark.fileToAdd')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('dialogs:bookmark.collector')}: {bookmarkData?.collector} | {t('dialogs:bookmark.detector')}: {bookmarkData?.detector}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('dialogs:bookmark.fileId')}: {bookmarkData?.file_id}
          </Typography>
        </Paper>
        {/* 新規ブックマーク作成 */}
        <Paper sx={{ p: 2, mb: 3, border: '2px solid', borderColor: 'primary.main' }}>
          <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 'bold' }}>
            {t('dialogs:bookmark.createNew')}
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-end' }}>
            <TextField
              fullWidth
              label={t('dialogs:bookmark.bookmarkName')}
              value={newBookmarkName}
              onChange={(e) => setNewBookmarkName(e.target.value)}
              disabled={isCreatingNew}
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  handleCreateNewBookmark();
                }
              }}
            />
            <Button
              variant="contained"
              startIcon={isCreatingNew ? <CircularProgress size={16} /> : <AddIcon />}
              onClick={handleCreateNewBookmark}
              disabled={isCreatingNew || !newBookmarkName.trim()}
              sx={{ minWidth: 120 }}
            >
              {isCreatingNew ? t('dialogs:bookmark.creating') : t('dialogs:bookmark.create')}
            </Button>
          </Box>
        </Paper>
        <Divider sx={{ my: 2 }} />
        {/* 既存ブックマーク一覧 */}
        <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 'bold' }}>
          {t('dialogs:bookmark.addToExisting')}
        </Typography>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : bookmarks.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
            {t('dialogs:bookmark.noBookmarks')}
          </Typography>
        ) : (
          <List sx={{ maxHeight: 300, overflow: 'auto' }}>
            {bookmarks.map((bookmark) => (
              <ListItem key={bookmark.bookmark_id} disablePadding>
                <ListItemButton
                  onClick={() => handleAddToBookmark(bookmark)}
                  disabled={loading || missingFields.length > 0}
                >
                  <ListItemText
                    primary={bookmark.bookmark_name}
                    secondary={`${t('dialogs:bookmark.updateDate')}: ${bookmark.updatedate}`}
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>
          {t('common:cancel')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default BookmarkDialog; 