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
import { getTagCategories } from '../services/api';

const TagCategorySelectionDialog = ({ open, onClose, onCategorySelect }) => {
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
      <DialogTitle>タグカテゴリ選択</DialogTitle>
      <DialogContent>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              ロードするタグカテゴリを選択してください
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
                      secondary={`システムプロンプト: ${category.system_prompt ? '設定済み' : '未設定'} | 検出プロンプト: ${category.detect_prompt ? '設定済み' : '未設定'}`}
                    />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>キャンセル</Button>
        <Button 
          onClick={handleLoadCategory} 
          variant="contained"
          disabled={!selectedCategory}
        >
          ロード
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default TagCategorySelectionDialog; 