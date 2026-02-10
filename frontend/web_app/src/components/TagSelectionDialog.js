import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Grid,
  Typography,
  List,
  ListItem,
  ListItemText,
  ListItemButton,
  Button,
  Box,
  Paper
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { getTagCategories, getTags } from '../services/api';

const TagSelectionDialog = ({ open, onClose, onTagSelect }) => {
  const { t } = useTranslation(['dialogs', 'common']);
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [tags, setTags] = useState([]);
  const [selectedTag, setSelectedTag] = useState(null);
  const [loading, setLoading] = useState(false);

  // カテゴリ一覧を取得
  useEffect(() => {
    if (open) {
      loadCategories();
    }
  }, [open]);

  // 選択されたカテゴリのタグ一覧を取得
  useEffect(() => {
    if (selectedCategory) {
      loadTags(selectedCategory.tagcategory_id);
    } else {
      setTags([]);
      setSelectedTag(null);
    }
  }, [selectedCategory]);

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

  const loadTags = async (categoryId) => {
    try {
      setLoading(true);
      const data = await getTags(categoryId, false);
      setTags(data);
    } catch (error) {
      console.error('Error loading tags:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCategorySelect = (category) => {
    setSelectedCategory(category);
    setSelectedTag(null);
  };

  const handleTagSelect = (tag) => {
    setSelectedTag(tag);
  };

  const handleAddTag = () => {
    if (selectedTag) {
      onTagSelect(selectedTag);
      handleClose();
    }
  };

  const handleClose = () => {
    setSelectedCategory(null);
    setSelectedTag(null);
    onClose();
  };

  return (
    <Dialog 
      open={open} 
      onClose={handleClose} 
      maxWidth="md" 
      fullWidth
      sx={{ '& .MuiDialog-paper': { height: '70vh' } }}
    >
      <DialogTitle>{t('dialogs:tagSelection.title')}</DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ height: '100%' }}>
          {/* 左側: タグカテゴリ一覧 */}
          <Grid item xs={6}>
            <Paper sx={{ height: '100%', p: 2 }}>
              <Typography variant="h6" gutterBottom>
                {t('dialogs:tagSelection.tagCategory')}
              </Typography>
              <List sx={{ height: 'calc(100% - 40px)', overflow: 'auto' }}>
                {categories.map((category) => (
                  <ListItem key={category.tagcategory_id} disablePadding>
                    <ListItemButton
                      selected={selectedCategory?.tagcategory_id === category.tagcategory_id}
                      onClick={() => handleCategorySelect(category)}
                    >
                      <ListItemText primary={category.tagcategory_name} />
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
            </Paper>
          </Grid>

          {/* 右側: タグ一覧 */}
          <Grid item xs={6}>
            <Paper sx={{ height: '100%', p: 2 }}>
              <Typography variant="h6" gutterBottom>
                {t('dialogs:tagSelection.tagList')}
              </Typography>
              {selectedCategory ? (
                <List sx={{ height: 'calc(100% - 40px)', overflow: 'auto' }}>
                  {tags.map((tag) => (
                    <ListItem key={tag.tag_name} disablePadding>
                      <ListItemButton
                        selected={selectedTag?.tag_name === tag.tag_name}
                        onClick={() => handleTagSelect(tag)}
                      >
                        <ListItemText 
                          primary={tag.tag_name}
                          secondary={tag.tag_prompt}
                        />
                      </ListItemButton>
                    </ListItem>
                  ))}
                </List>
              ) : (
                <Box sx={{ 
                  height: 'calc(100% - 40px)', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center' 
                }}>
                  <Typography color="text.secondary">
                    {t('dialogs:tagSelection.selectCategoryPrompt')}
                  </Typography>
                </Box>
              )}
            </Paper>
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>{t('common:cancel')}</Button>
        <Button 
          onClick={handleAddTag} 
          variant="contained"
          disabled={!selectedTag}
        >
          {t('dialogs:tagSelection.addTag')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default TagSelectionDialog; 