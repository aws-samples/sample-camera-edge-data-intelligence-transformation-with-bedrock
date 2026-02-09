import React, { useState, useEffect } from 'react';
import { 
  Container, Typography, Box, Paper, Button, Alert, 
  Grid, List, ListItem, ListItemText, ListItemSecondaryAction,
  IconButton, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, FormControl, InputLabel, Select, MenuItem,
  CircularProgress, Snackbar, Divider
} from '@mui/material';
import { Add, Delete, Edit, CloudUpload } from '@mui/icons-material';
import PageLayout from '../components/PageLayout';
import TitleArea from '../components/TitleArea';
import {
  getTagCategories, createTagCategory, updateTagCategory, deleteTagCategory,
  getTags, getTag, createTag, updateTag, deleteTag,
  uploadTagImage, getTagImageUrl
} from '../services/api';
import { HEADER_HEIGHT, TITLE_AREA_HEIGHT } from '../constants/layout';
import { useTranslation } from 'react-i18next';

const Tag = () => {
  const { t } = useTranslation(['pages', 'common']);
  // State for tag categories
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [categoryLoading, setCategoryLoading] = useState(false);
  
  // State for category details editing
  const [categoryDetails, setCategoryDetails] = useState({
    system_prompt: '',
    detect_prompt: ''
  });
  const [isEditingCategory, setIsEditingCategory] = useState(false);
  
  // State for tags
  const [tags, setTags] = useState([]);
  const [selectedTag, setSelectedTag] = useState(null);
  const [tagLoading, setTagLoading] = useState(false);
  
  // State for tag details
  const [tagDetails, setTagDetails] = useState({
    tag_id: '',
    tag_name: '',
    tag_prompt: '',
    tagcategory_id: '',
    s3path: '',
    file_format: ''
  });
  const [isEditingTag, setIsEditingTag] = useState(false);
  const [isNewTag, setIsNewTag] = useState(false);
  
  // State for dialogs
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [categoryDialogMode, setCategoryDialogMode] = useState('create'); // 'create' or 'edit'
  const [categoryForm, setCategoryForm] = useState({
    tagcategory_name: ''
  });
  
  // State for image upload
  const [selectedFile, setSelectedFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(false);
  
  // State for alerts and loading
  const [alert, setAlert] = useState({ open: false, message: '', severity: 'info' });
  const [loading, setLoading] = useState(false);

  // Load initial data
  useEffect(() => {
    loadCategories();
  }, []);

  // Load tags when category is selected
  useEffect(() => {
    if (selectedCategory) {
      loadTags(selectedCategory.tagcategory_id);
    } else {
      setTags([]);
      setSelectedTag(null);
      resetTagDetails();
    }
  }, [selectedCategory]);

  // Load tag details when tag is selected
  useEffect(() => {
    if (selectedTag && !isNewTag) {
      loadTagDetails(selectedTag.tag_name);
    }
  }, [selectedTag, isNewTag]);

  // Load categories
  const loadCategories = async () => {
    try {
      setCategoryLoading(true);
      const data = await getTagCategories();
      setCategories(data);
    } catch (error) {
      showAlert(t('pages:tag.fetchCategoriesFailed'), 'error');
    } finally {
      setCategoryLoading(false);
    }
  };

  // Load tags for selected category
  const loadTags = async (categoryId) => {
    try {
      setTagLoading(true);
      const data = await getTags(categoryId, false);
      setTags(data);
    } catch (error) {
      console.error('Error loading tags:', error);
      if (error.message.includes('503')) {
        showAlert(t('pages:tag.serviceUnavailable'), 'warning');
      } else {
        showAlert(t('pages:tag.fetchTagsFailed'), 'error');
      }
    } finally {
      setTagLoading(false);
    }
  };

  // Load tag details
  const loadTagDetails = async (tagName) => {
    try {
      setLoading(true);
      const data = await getTag(tagName, true);
      console.log('Tag details loaded:', data);
      setTagDetails(data);
      
      // Load image if exists
      if (data.s3path) {
        console.log('S3 path found:', data.s3path);
        try {
          const imageData = await getTagImageUrl(tagName);
          console.log('Image data received:', imageData);
          setImageUrl(imageData.presigned_url);
          console.log('Image URL set:', imageData.presigned_url);
        } catch (imageError) {
          console.error('Error loading image for tag:', tagName, imageError);
          setImageUrl(null);
        }
      } else {
        console.log('No S3 path found for tag:', tagName);
        setImageUrl(null);
      }
      
      setIsEditingTag(false);
    } catch (error) {
      console.error('Error loading tag details:', error);
      showAlert(t('pages:tag.fetchTagDetailsFailed'), 'error');
    } finally {
      setLoading(false);
    }
  };

  // Reset tag details
  const resetTagDetails = () => {
    setTagDetails({
      tag_id: '',
      tag_name: '',
      tag_prompt: '',
      tagcategory_id: selectedCategory?.tagcategory_id || '',
      s3path: '',
      file_format: ''
    });
    setImageUrl(null);
    setSelectedFile(null);
    setImagePreview(null);
    setIsEditingTag(false);
    setIsNewTag(false);
  };

  // Show alert
  const showAlert = (message, severity = 'info') => {
    setAlert({ open: true, message, severity });
  };

  // Handle category selection
  const handleCategorySelect = (category) => {
    setSelectedCategory(category);
    setSelectedTag(null);
    resetTagDetails();
    
    // Set category details for editing
    setCategoryDetails({
      system_prompt: category.system_prompt || '',
      detect_prompt: category.detect_prompt || ''
    });
    setIsEditingCategory(false);
  };

  // Handle tag selection
  const handleTagSelect = (tag) => {
    setSelectedTag(tag);
    setIsNewTag(false);
  };

  // Handle category dialog
  const openCategoryDialog = (mode, category = null) => {
    setCategoryDialogMode(mode);
    if (mode === 'edit' && category) {
      setCategoryForm({
        tagcategory_name: category.tagcategory_name
      });
    } else {
      setCategoryForm({
        tagcategory_name: ''
      });
    }
    setCategoryDialogOpen(true);
  };

  const handleCategoryDialogClose = () => {
    setCategoryDialogOpen(false);
    setCategoryForm({ tagcategory_name: '' });
  };

  const handleCategorySubmit = async () => {
    try {
      setLoading(true);
      if (categoryDialogMode === 'create') {
        await createTagCategory(categoryForm);
        showAlert(t('pages:tag.categoryCreated'), 'success');
      } else {
        await updateTagCategory(selectedCategory.tagcategory_id, categoryForm);
        showAlert(t('pages:tag.categoryUpdated'), 'success');
      }
      
      await loadCategories();
      handleCategoryDialogClose();
    } catch (error) {
      showAlert(t(categoryDialogMode === 'create' ? 'pages:tag.createCategoryFailed' : 'pages:tag.updateCategoryFailed'), 'error');
    } finally {
      setLoading(false);
    }
  };

  // Handle category delete
  const handleCategoryDelete = async (category) => {
    if (!window.confirm(`タグカテゴリ「${category.tagcategory_name}」を削除しますか？`)) {
      return;
    }

    try {
      setLoading(true);
      await deleteTagCategory(category.tagcategory_id, true); // cascade delete
      showAlert('タグカテゴリを削除しました', 'success');
      
      await loadCategories();
      
      // Reset selection if deleted category was selected
      if (selectedCategory?.tagcategory_id === category.tagcategory_id) {
        setSelectedCategory(null);
        setSelectedTag(null);
        resetTagDetails();
      }
    } catch (error) {
      showAlert('タグカテゴリの削除に失敗しました', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Handle new tag
  const handleNewTag = () => {
    if (!selectedCategory) {
      showAlert('タグカテゴリを選択してください', 'warning');
      return;
    }

    setSelectedTag(null);
    setTagDetails({
      tag_id: '',
      tag_name: '',
      tag_prompt: '',
      tagcategory_id: selectedCategory.tagcategory_id,
      s3path: '',
      file_format: ''
    });
    setImageUrl(null);
    setSelectedFile(null);
    setImagePreview(null);
    setIsNewTag(true);
    setIsEditingTag(true);
  };

  // Handle tag delete
  const handleTagDelete = async (tag) => {
    if (!window.confirm(`タグ「${tag.tag_name}」を削除しますか？`)) {
      return;
    }

    try {
      setLoading(true);
      await deleteTag(tag.tag_name);
      showAlert('タグを削除しました', 'success');
      
      await loadTags(selectedCategory.tagcategory_id);
      
      // Reset selection if deleted tag was selected
      if (selectedTag?.tag_name === tag.tag_name) {
        setSelectedTag(null);
        resetTagDetails();
      }
    } catch (error) {
      showAlert('タグの削除に失敗しました', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Handle tag form submit
  const handleTagSubmit = async () => {
    if (!tagDetails.tag_name || !tagDetails.tag_prompt) {
      showAlert('タグ名とプロンプトは必須です', 'warning');
      return;
    }

    try {
      setLoading(true);
      
      if (isNewTag) {
        // Create new tag
        await createTag(tagDetails);
        showAlert('タグを作成しました', 'success');
        
        // Upload image if selected
        if (selectedFile) {
          await handleImageUpload(tagDetails.tag_name);
        }
        
        await loadTags(selectedCategory.tagcategory_id);
        
        // Select the newly created tag
        setSelectedTag({ tag_name: tagDetails.tag_name });
        setIsNewTag(false);
      } else {
        // Update existing tag
        const updateData = {
          tag_prompt: tagDetails.tag_prompt,
          tagcategory_id: tagDetails.tagcategory_id,
          s3path: tagDetails.s3path,
          file_format: tagDetails.file_format
        };
        
        await updateTag(tagDetails.tag_name, updateData);
        showAlert('タグを更新しました', 'success');
        
        // Upload image if selected
        if (selectedFile) {
          await handleImageUpload(tagDetails.tag_name);
        }
        
        await loadTags(selectedCategory.tagcategory_id);
        await loadTagDetails(tagDetails.tag_name);
      }
      
      setIsEditingTag(false);
    } catch (error) {
      console.error('Error in tag submit:', error);
      if (error.message.includes('503')) {
        showAlert('タグサービスが一時的に利用できません。しばらくしてから再度お試しください。', 'warning');
      } else {
        showAlert(`タグの${isNewTag ? '作成' : '更新'}に失敗しました`, 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  // Handle file selection
  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      showAlert('JPEG、PNG、GIF形式のファイルのみ対応しています', 'error');
      return;
    }

    // Validate file size (5MB)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      showAlert('ファイルサイズは5MB以下にしてください', 'error');
      return;
    }

    setSelectedFile(file);

    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      setImagePreview(e.target.result);
    };
    reader.readAsDataURL(file);
  };

  // Handle image upload
  const handleImageUpload = async (tagName) => {
    if (!selectedFile || !tagName) return;

    try {
      setUploadProgress(true);
      const response = await uploadTagImage(tagName, selectedFile);
      
      // Update tag details with new image info
      setTagDetails(prev => ({
        ...prev,
        s3path: response.s3_path,
        file_format: response.file_format
      }));
      
      // Set new image URL
      setImageUrl(response.presigned_url);
      
      // Reset file selection
      setSelectedFile(null);
      setImagePreview(null);
      
      showAlert('画像をアップロードしました', 'success');
    } catch (error) {
      showAlert('画像のアップロードに失敗しました', 'error');
    } finally {
      setUploadProgress(false);
    }
  };

  // Handle category details update
  const handleCategoryDetailsUpdate = async () => {
    if (!selectedCategory) return;

    try {
      setLoading(true);
      
      const updateData = {
        tagcategory_name: selectedCategory.tagcategory_name,
        system_prompt: categoryDetails.system_prompt,
        detect_prompt: categoryDetails.detect_prompt
      };
      
      await updateTagCategory(selectedCategory.tagcategory_id, updateData);
      showAlert('タグカテゴリ詳細を更新しました', 'success');
      
      // Reload categories to reflect changes
      await loadCategories();
      
      // Update selected category with new details
      const updatedCategory = {
        ...selectedCategory,
        system_prompt: categoryDetails.system_prompt,
        detect_prompt: categoryDetails.detect_prompt
      };
      setSelectedCategory(updatedCategory);
      setIsEditingCategory(false);
      
    } catch (error) {
      showAlert('タグカテゴリ詳細の更新に失敗しました', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageLayout>
      <TitleArea
        title={t('pages:tag.title')}
        rightContent={
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={() => openCategoryDialog('create')}
            size="small"
          >
            {t('pages:tag.addCategory')}
          </Button>
        }
      />

      <Box
        sx={{
          marginTop: `${HEADER_HEIGHT + TITLE_AREA_HEIGHT}px`,
          overflow: 'auto',
          height: `calc(100vh - ${HEADER_HEIGHT + TITLE_AREA_HEIGHT}px)`,
          backgroundColor: '#f5f5f5',
        }}
      >
        <Container maxWidth={false} sx={{ maxWidth: '2000px', py: 3 }}>
        <Grid container spacing={2} sx={{ height: `calc(100vh - ${HEADER_HEIGHT + TITLE_AREA_HEIGHT + 50}px)` }}>
          {/* Left Column - Tag Categories */}
          <Grid item xs={3}>
            <Paper sx={{ height: '100%', p: 2 }}>
              <Box sx={{ mb: 2 }}>
                <Typography variant="h6">{t('pages:tag.tagCategories')}</Typography>
              </Box>
              
              {categoryLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
                  <CircularProgress />
                </Box>
              ) : (
                <List sx={{ maxHeight: 'calc(100% - 80px)', overflow: 'auto' }}>
                  {categories.map((category) => (
                    <ListItem
                      key={category.tagcategory_id}
                      button
                      selected={selectedCategory?.tagcategory_id === category.tagcategory_id}
                      onClick={() => handleCategorySelect(category)}
                      sx={{ mb: 1, border: 1, borderColor: 'divider', borderRadius: 1 }}
                    >
                      <ListItemText primary={category.tagcategory_name} />
                      <ListItemSecondaryAction>
                        <IconButton
                          edge="end"
                          onClick={(e) => {
                            e.stopPropagation();
                            openCategoryDialog('edit', category);
                          }}
                          size="small"
                        >
                          <Edit />
                        </IconButton>
                        <IconButton
                          edge="end"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCategoryDelete(category);
                          }}
                          size="small"
                          color="error"
                        >
                          <Delete />
                        </IconButton>
                      </ListItemSecondaryAction>
                    </ListItem>
                  ))}
                </List>
              )}
            </Paper>
          </Grid>

          {/* Middle Column - Category Details and Tags */}
          <Grid item xs={4}>
            {selectedCategory ? (
              <Paper sx={{ height: '100%', p: 2, display: 'flex', flexDirection: 'column' }}>
                {/* Category Details */}
                <Typography variant="h6" gutterBottom>
                  {selectedCategory.tagcategory_name}
                </Typography>
                
                <Box sx={{ mb: 2 }}>
                  <TextField
                    label={t('pages:tag.systemPromptTemplate')}
                    value={categoryDetails.system_prompt}
                    onChange={(e) => setCategoryDetails(prev => ({ ...prev, system_prompt: e.target.value }))}
                    disabled={!isEditingCategory}
                    fullWidth
                    size="small"
                    margin="dense"
                  />
                  
                  <TextField
                    label={t('pages:tag.detectPromptTemplate')}
                    value={categoryDetails.detect_prompt}
                    onChange={(e) => setCategoryDetails(prev => ({ ...prev, detect_prompt: e.target.value }))}
                    disabled={!isEditingCategory}
                    fullWidth
                    multiline
                    rows={5}
                    size="small"
                    margin="dense"
                  />
                  
                  <Box sx={{ mt: 1, display: 'flex', gap: 1 }}>
                    {isEditingCategory ? (
                      <>
                        <Button
                          variant="contained"
                          onClick={handleCategoryDetailsUpdate}
                          disabled={loading}
                          size="small"
                        >
                          {t('pages:tag.update')}
                        </Button>
                        <Button
                          variant="outlined"
                          onClick={() => {
                            setCategoryDetails({
                              system_prompt: selectedCategory.system_prompt || '',
                              detect_prompt: selectedCategory.detect_prompt || ''
                            });
                            setIsEditingCategory(false);
                          }}
                          disabled={loading}
                          size="small"
                        >
                          {t('common:cancel')}
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="outlined"
                        onClick={() => setIsEditingCategory(true)}
                        size="small"
                      >
                        {t('pages:tag.edit')}
                      </Button>
                    )}
                  </Box>
                </Box>
                
                <Divider sx={{ my: 1 }} />
                
                {/* Tags Section */}
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                  <Typography variant="subtitle1">{t('pages:tag.tagList')}</Typography>
                  <Button
                    variant="contained"
                    startIcon={<Add />}
                    onClick={handleNewTag}
                    size="small"
                  >
                    {t('pages:tag.createNew')}
                  </Button>
                </Box>
                
                {tagLoading ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
                    <CircularProgress size={20} />
                  </Box>
                ) : (
                  <List sx={{ flex: 1, overflow: 'auto', maxHeight: 'calc(100% - 300px)' }}>
                    {tags.map((tag) => (
                      <ListItem
                        key={tag.tag_name}
                        button
                        selected={selectedTag?.tag_name === tag.tag_name}
                        onClick={() => handleTagSelect(tag)}
                        sx={{ mb: 1, border: 1, borderColor: 'divider', borderRadius: 1 }}
                      >
                        <ListItemText primary={tag.tag_name} />
                        <ListItemSecondaryAction>
                          <IconButton
                            edge="end"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleTagDelete(tag);
                            }}
                            size="small"
                            color="error"
                          >
                            <Delete />
                          </IconButton>
                        </ListItemSecondaryAction>
                      </ListItem>
                    ))}
                  </List>
                )}
              </Paper>
            ) : (
              <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Typography color="text.secondary">
                  {t('pages:tag.selectCategory')}
                </Typography>
              </Box>
            )}
          </Grid>

          {/* Right Column - Tag Details */}
          <Grid item xs={5}>
            {(selectedTag || isNewTag) ? (
            <Paper sx={{ height: '100%', p: 2 }}>
              <Typography variant="h6" gutterBottom>
                {t('pages:tag.tagDetails')}
              </Typography>
              
              {!selectedTag && !isNewTag ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50%' }}>
                  <Typography color="text.secondary">
                    {t('pages:tag.selectTag')}
                  </Typography>
                </Box>
              ) : loading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
                  <CircularProgress />
                </Box>
              ) : (
                <Box sx={{ maxHeight: 'calc(100% - 80px)', overflow: 'auto' }}>
                  <TextField
                    label={t('pages:tag.tagId')}
                    value={tagDetails.tag_id}
                    disabled
                    fullWidth
                    margin="normal"
                    size="small"
                    sx={{ mb: 1 }}
                  />
                  
                  <TextField
                    label={t('pages:tag.tagName')}
                    value={tagDetails.tag_name}
                    onChange={(e) => setTagDetails(prev => ({ ...prev, tag_name: e.target.value }))}
                    disabled={!isNewTag} // Only editable when creating new tag
                    fullWidth
                    margin="normal"
                  />
                  
                  <TextField
                    label={t('pages:tag.tagPrompt')}
                    value={tagDetails.tag_prompt}
                    onChange={(e) => setTagDetails(prev => ({ ...prev, tag_prompt: e.target.value }))}
                    disabled={!isEditingTag && !isNewTag}
                    fullWidth
                    multiline
                    rows={3}
                    margin="normal"
                  />
                  
                  <FormControl fullWidth margin="normal">
                    <InputLabel>{t('pages:tag.tagCategoryField')}</InputLabel>
                    <Select
                      value={tagDetails.tagcategory_id}
                      onChange={(e) => setTagDetails(prev => ({ ...prev, tagcategory_id: e.target.value }))}
                      disabled={!isEditingTag && !isNewTag}
                      label={t('pages:tag.tagCategoryField')}
                    >
                      {categories.map((category) => (
                        <MenuItem key={category.tagcategory_id} value={category.tagcategory_id}>
                          {category.tagcategory_name}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  
                  <TextField
                    label={t('pages:tag.s3Path')}
                    value={tagDetails.s3path}
                    disabled
                    fullWidth
                    margin="normal"
                  />
                  
                  <TextField
                    label={t('pages:tag.fileFormat')}
                    value={tagDetails.file_format}
                    disabled
                    fullWidth
                    margin="normal"
                  />
                  
                  <Divider sx={{ my: 2 }} />
                  
                  {/* Image Section */}
                  <Typography variant="subtitle1" gutterBottom>
                    {t('pages:tag.referenceImage')}
                  </Typography>
                  
                  {imageUrl && (
                    <Box sx={{ mb: 2 }}>
                      <img
                        src={imageUrl}
                        alt="Tag reference"
                        style={{
                          maxWidth: '100%',
                          maxHeight: '200px',
                          objectFit: 'contain',
                          border: '1px solid #ddd',
                          borderRadius: '4px'
                        }}
                        onLoad={() => console.log('Image loaded successfully:', imageUrl)}
                        onError={(e) => {
                          console.error('Image load error:', e);
                          console.error('Failed image URL:', imageUrl);
                        }}
                      />
                    </Box>
                  )}
                  
                  {!imageUrl && tagDetails?.s3path && (
                    <Box sx={{ mb: 2, p: 2, backgroundColor: '#f5f5f5', borderRadius: '4px' }}>
                      <Typography variant="body2" color="text.secondary">
                        {t('pages:tag.imageLoadFailed')}
                      </Typography>
                      <Typography variant="caption" display="block" sx={{ mt: 1 }}>
                        {t('pages:tag.s3Path')}: {tagDetails.s3path}
                      </Typography>
                    </Box>
                  )}
                  
                  {imagePreview && (
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="caption" display="block" gutterBottom>
                        {t('pages:tag.preview')}:
                      </Typography>
                      <img
                        src={imagePreview}
                        alt="Preview"
                        style={{
                          maxWidth: '100%',
                          maxHeight: '200px',
                          objectFit: 'contain',
                          border: '1px solid #ddd',
                          borderRadius: '4px'
                        }}
                      />
                    </Box>
                  )}
                  
                  {(isEditingTag || isNewTag) && (
                    <Box sx={{ mb: 2 }}>
                      <input
                        accept="image/*"
                        style={{ display: 'none' }}
                        id="image-upload"
                        type="file"
                        onChange={handleFileSelect}
                      />
                      <label htmlFor="image-upload">
                        <Button
                          component="span"
                          variant="outlined"
                          startIcon={<CloudUpload />}
                          fullWidth
                        >
                          {t('pages:tag.selectImage')}
                        </Button>
                      </label>
                    </Box>
                  )}
                  
                  <Box sx={{ mt: 3, display: 'flex', gap: 1 }}>
                    {isEditingTag || isNewTag ? (
                      <>
                        <Button
                          variant="contained"
                          onClick={handleTagSubmit}
                          disabled={loading || uploadProgress}
                          fullWidth
                        >
                          {uploadProgress ? <CircularProgress size={20} /> : isNewTag ? t('pages:tag.create') : t('pages:tag.update')}
                        </Button>
                        <Button
                          variant="outlined"
                          onClick={() => {
                            if (isNewTag) {
                              resetTagDetails();
                            } else {
                              setIsEditingTag(false);
                              loadTagDetails(selectedTag.tag_name);
                            }
                          }}
                          disabled={loading || uploadProgress}
                        >
                          {t('common:cancel')}
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="contained"
                        onClick={() => setIsEditingTag(true)}
                        disabled={!selectedTag}
                        fullWidth
                      >
                        {t('pages:tag.edit')}
                      </Button>
                    )}
                  </Box>
                </Box>
              )}
            </Paper>
            ) : (
              <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Typography color="text.secondary">
                  {t('pages:tag.selectOrCreateTag')}
                </Typography>
              </Box>
            )}
          </Grid>
        </Grid>

        {/* Category Dialog */}
        <Dialog open={categoryDialogOpen} onClose={handleCategoryDialogClose} maxWidth="sm" fullWidth>
          <DialogTitle>
            {categoryDialogMode === 'create' ? t('pages:tag.categoryDialogCreateTitle') : t('pages:tag.categoryDialogEditTitle')}
          </DialogTitle>
          <DialogContent>
            <TextField
              label={t('pages:tag.categoryName')}
              value={categoryForm.tagcategory_name}
              onChange={(e) => setCategoryForm(prev => ({ ...prev, tagcategory_name: e.target.value }))}
              fullWidth
              margin="normal"
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCategoryDialogClose}>{t('common:cancel')}</Button>
            <Button
              onClick={handleCategorySubmit}
              disabled={!categoryForm.tagcategory_name || loading}
              variant="contained"
            >
              {categoryDialogMode === 'create' ? t('pages:tag.create') : t('pages:tag.update')}
            </Button>
          </DialogActions>
        </Dialog>

        {/* Alert Snackbar */}
        <Snackbar
          open={alert.open}
          autoHideDuration={6000}
          onClose={() => setAlert(prev => ({ ...prev, open: false }))}
        >
          <Alert
            onClose={() => setAlert(prev => ({ ...prev, open: false }))}
            severity={alert.severity}
            sx={{ width: '100%' }}
          >
            {alert.message}
          </Alert>
        </Snackbar>
        </Container>
      </Box>
    </PageLayout>
  );
};

export default Tag; 