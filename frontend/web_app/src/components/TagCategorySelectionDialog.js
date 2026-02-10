import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItem,
  ListItemText,
  ListItemButton,
  Button,
  Box,
  Typography,
  CircularProgress
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { getTagCategories } from '../services/api';

const TagCategorySelectionDialog = ({ open, onClose, onCategorySelect }) => {
  const { t } = useTranslation(['dialogs', 'common']);
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [loading, setLoading] = useState(false);

  // カテゴリ一覧を取得
  useEffect(() => {
    if (open) {
      loadCategories();
    }
  }, [open]);

  const loadCategories = async () => {
    try {
      setLoading(true);
      const data = await getTagCategories();
      setCategories(data);
    } catch (error) {
      console.error('Error loading categories:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCategorySelect = (category) => {
    setSelectedCategory(category);
  };

  const handleLoadCategory = () => {
    if (selectedCategory) {
      onCategorySelect(selectedCategory);
      handleClose();
    }
  };

  const handleClose = () => {
    setSelectedCategory(null);
    onClose();
  };

  return (
    <Dialog 
      open={open} 
      onClose={handleClose} 
      maxWidth="sm" 
      fullWidth
      sx={{ '& .MuiDialog-paper': { height: '60vh' } }}
    >
      <DialogTitle>{t('dialogs:tagCategory.title')}</DialogTitle>
      <DialogContent>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t('dialogs:tagCategory.description')}
            </Typography>
            <List sx={{ height: 'calc(100% - 60px)', overflow: 'auto' }}>
              {categories.map((category) => (
                <ListItem key={category.tagcategory_id} disablePadding>
                  <ListItemButton
                    selected={selectedCategory?.tagcategory_id === category.tagcategory_id}
                    onClick={() => handleCategorySelect(category)}
                  >
                    <ListItemText 
                      primary={category.tagcategory_name}
                      secondary={`${t('dialogs:tagCategory.systemPrompt')}: ${category.system_prompt ? t('dialogs:tagCategory.configured') : t('dialogs:tagCategory.notConfigured')} | ${t('dialogs:tagCategory.detectPrompt')}: ${category.detect_prompt ? t('dialogs:tagCategory.configured') : t('dialogs:tagCategory.notConfigured')}`}
                    />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>{t('common:cancel')}</Button>
        <Button 
          onClick={handleLoadCategory} 
          variant="contained"
          disabled={!selectedCategory}
        >
          {t('dialogs:tagCategory.load')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default TagCategorySelectionDialog; 