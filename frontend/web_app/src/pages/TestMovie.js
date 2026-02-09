import React, { useState, useEffect } from 'react';
import {
  Container,
  Typography,
  Box,
  Paper,
  Button,
  Grid,
  Alert,
  Card,
  CardContent,
  CardActions,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  CircularProgress,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import PageLayout from '../components/PageLayout';
import TitleArea from '../components/TitleArea';
import { HEADER_HEIGHT, TITLE_AREA_HEIGHT } from '../constants/layout';
import {
  getTestMovies,
  createTestMovie,
  deleteTestMovie,
  getTestMovieStatus,
  uploadTestMovieFile,
} from '../services/api';
import { useTranslation } from 'react-i18next';

const TestMovie = () => {
  const { t } = useTranslation(['pages', 'common']);
  const navigate = useNavigate();

  // State
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [testMovies, setTestMovies] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [deployingMovies, setDeployingMovies] = useState(new Set());

  // Form state
  const [formData, setFormData] = useState({
    type: 'rtsp',
    name: '',
    test_movie_s3_path: ''
  });

  // Initialize
  useEffect(() => {
    fetchTestMovies();
  }, []);

  // Fetch test movies
  const fetchTestMovies = async () => {
    try {
      setLoading(true);
      const data = await getTestMovies();
      setTestMovies(data);
      
      // Start polling for deploying movies
      const deployingIds = new Set(
        data.filter(tm => tm.status === 'deploying').map(tm => tm.test_movie_id)
      );
      setDeployingMovies(deployingIds);
    } catch (err) {
      console.error('Error fetching test movies:', err);
      setError(t('pages:testMovie.fetchFailed'));
    } finally {
      setLoading(false);
    }
  };

  // Poll deploying movies
  useEffect(() => {
    if (deployingMovies.size === 0) return;

    const pollInterval = setInterval(async () => {
      const stillDeploying = new Set();

      for (const testMovieId of deployingMovies) {
        try {
          const status = await getTestMovieStatus(testMovieId);
          
          if (status.status === 'deployed' || status.status === 'failed') {
            // Update test movies list
            setTestMovies(prev => 
              prev.map(tm => tm.test_movie_id === testMovieId ? status : tm)
            );
          } else if (status.status === 'deploying') {
            stillDeploying.add(testMovieId);
          }
        } catch (err) {
          console.error("Error polling test movie %s:", testMovieId, err);
        }
      }

      setDeployingMovies(stillDeploying);
    }, 5000); // Poll every 5 seconds

    return () => clearInterval(pollInterval);
  }, [deployingMovies]);

  // Handle file upload
  const handleFileUpload = async (file) => {
    try {
      setUploading(true);
      setError(null);

      if (!file.name.toLowerCase().endsWith('.mp4')) {
        setError(t('pages:testMovie.mp4Only'));
        return;
      }

      // Get presigned URL
      const urlResponse = await uploadTestMovieFile(file.name);

      // Upload to S3
      const uploadResponse = await fetch(urlResponse.upload_url, {
        method: 'PUT',
        body: file
      });

      if (!uploadResponse.ok) {
        throw new Error(t('pages:testMovie.s3UploadFailed'));
      }

      // Update form data
      setFormData(prev => ({
        ...prev,
        test_movie_s3_path: urlResponse.s3_path
      }));
      setUploadedFile(file);

    } catch (err) {
      console.error('File upload error:', err);
      setError(`${t('pages:testMovie.uploadFailed')}: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  // Handle create
  const handleCreate = async () => {
    try {
      if (!formData.test_movie_s3_path) {
        setError(t('pages:testMovie.uploadRequired'));
        return;
      }

      setUploading(true);
      const response = await createTestMovie(formData);

      // Add to deploying set
      setDeployingMovies(prev => new Set([...prev, response.test_movie_id]));

      // Close dialog
      setDialogOpen(false);
      setFormData({ type: 'rtsp', name: '', test_movie_s3_path: '' });
      setUploadedFile(null);

      // Refresh list
      await fetchTestMovies();

    } catch (err) {
      console.error('Error creating test movie:', err);
      setError(`${t('pages:testMovie.createFailed')}: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  // Handle delete
  const handleDelete = async (testMovieId) => {
    if (!window.confirm(t('pages:testMovie.deleteConfirm'))) {
      return;
    }

    try {
      await deleteTestMovie(testMovieId);
      await fetchTestMovies();
    } catch (err) {
      console.error('Error deleting test movie:', err);
      setError(t('pages:testMovie.deleteFailed'));
    }
  };

  // Render status chip
  const renderStatusChip = (status) => {
    const statusMap = {
      pending: { label: t('pages:testMovie.statusPending'), color: 'default' },
      deploying: { label: t('pages:testMovie.statusDeploying'), color: 'warning' },
      deployed: { label: t('pages:testMovie.statusDeployed'), color: 'success' },
      failed: { label: t('pages:testMovie.statusFailed'), color: 'error' },
      deleted: { label: t('pages:testMovie.statusDeleted'), color: 'default' },
    };

    const config = statusMap[status] || { label: status, color: 'default' };
    
    return (
      <Chip 
        label={config.label} 
        color={config.color} 
        size="small"
        icon={status === 'deploying' ? <CircularProgress size={16} color="inherit" /> : undefined}
      />
    );
  };

  if (loading) {
    return (
      <PageLayout>
        <TitleArea title={t('pages:testMovie.title')} backTo="/" />
        <Box
          sx={{
            marginTop: `${HEADER_HEIGHT + TITLE_AREA_HEIGHT}px`,
            overflow: 'auto',
            height: `calc(100vh - ${HEADER_HEIGHT + TITLE_AREA_HEIGHT}px)`,
          }}
        >
          <Container maxWidth="lg" sx={{ py: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'center', my: 4 }}>
              <CircularProgress />
            </Box>
          </Container>
        </Box>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <TitleArea
        title={t('pages:testMovie.title')}
        backTo="/"
        rightContent={
          <>
            <Tooltip title={t('pages:testMovie.reload')}>
              <IconButton onClick={fetchTestMovies} size="small">
                <RefreshIcon />
              </IconButton>
            </Tooltip>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setDialogOpen(true)}
              size="small"
            >
              {t('pages:testMovie.createButton')}
            </Button>
          </>
        }
      />

      <Box
        sx={{
          marginTop: `${HEADER_HEIGHT + TITLE_AREA_HEIGHT}px`,
          overflow: 'auto',
          height: `calc(100vh - ${HEADER_HEIGHT + TITLE_AREA_HEIGHT}px)`,
        }}
      >
        <Container maxWidth="lg" sx={{ py: 3 }}>
          {error && (
            <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          <Grid container spacing={3}>
            {testMovies.length === 0 ? (
              <Grid item xs={12}>
                <Paper sx={{ p: 4, textAlign: 'center' }}>
                  <Typography color="text.secondary">
                    {t('pages:testMovie.noTestMovies')}
                  </Typography>
                </Paper>
              </Grid>
            ) : (
              testMovies.map((testMovie) => (
                <Grid item xs={12} md={6} lg={4} key={testMovie.test_movie_id}>
                  <Card>
                    <CardContent>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                        <Typography variant="h6" component="div">
                          {testMovie.name || t('pages:testMovie.testMovie')}
                        </Typography>
                        {renderStatusChip(testMovie.status)}
                      </Box>

                      <Typography variant="body2" color="text.secondary" gutterBottom sx={{ wordBreak: 'break-all' }}>
                        <strong>ID:</strong> {testMovie.test_movie_id}
                      </Typography>

                      <Typography variant="body2" color="text.secondary" gutterBottom>
                        <strong>{t('pages:testMovie.type')}:</strong> {testMovie.type}
                      </Typography>

                      {testMovie.rtsp_url && (
                        <Typography variant="body2" color="text.secondary" gutterBottom sx={{ wordBreak: 'break-all' }}>
                          <strong>RTSP URL:</strong> {testMovie.rtsp_url}
                        </Typography>
                      )}

                      {testMovie.cloudformation_stack && (
                        <Typography variant="body2" color="text.secondary" gutterBottom sx={{ wordBreak: 'break-all' }}>
                          <strong>Stack:</strong> {testMovie.cloudformation_stack}
                        </Typography>
                      )}

                      {testMovie.deploy_error && (
                        <Alert severity="error" sx={{ mt: 2 }}>
                          {testMovie.deploy_error}
                        </Alert>
                      )}
                    </CardContent>

                    <CardActions>
                      <Button
                        size="small"
                        color="error"
                        startIcon={<DeleteIcon />}
                        onClick={() => handleDelete(testMovie.test_movie_id)}
                        disabled={testMovie.status === 'deploying'}
                      >
                        {t('common:delete')}
                      </Button>
                    </CardActions>
                  </Card>
                </Grid>
              ))
            )}
          </Grid>

          {/* Create Dialog */}
          <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
            <DialogTitle>{t('pages:testMovie.createDialogTitle')}</DialogTitle>
            <DialogContent>
              <Box sx={{ pt: 2 }}>
                <FormControl fullWidth sx={{ mb: 3 }}>
                  <InputLabel>{t('pages:testMovie.type')}</InputLabel>
                  <Select
                    value={formData.type}
                    onChange={(e) => setFormData(prev => ({ ...prev, type: e.target.value }))}
                    label={t('pages:testMovie.type')}
                  >
                    <MenuItem value="rtsp">RTSP</MenuItem>

                  </Select>
                </FormControl>

                {/* Name Input */}
                <TextField
                  fullWidth
                  label={t('pages:testMovie.name')}
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder={t('pages:testMovie.namePlaceholder')}
                  sx={{ mb: 3 }}
                />

                {/* File Upload */}
                <Box
                  sx={{
                    border: '2px dashed',
                    borderColor: uploading ? 'primary.main' : 'grey.300',
                    borderRadius: 2,
                    p: 3,
                    textAlign: 'center',
                    bgcolor: 'background.paper',
                    cursor: uploading ? 'not-allowed' : 'pointer',
                    transition: 'all 0.2s ease',
                    opacity: uploading ? 0.6 : 1
                  }}
                  onClick={uploading ? undefined : () => document.getElementById('test-movie-file-input').click()}
                >
                  <input
                    id="test-movie-file-input"
                    type="file"
                    accept=".mp4"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        handleFileUpload(e.target.files[0]);
                      }
                    }}
                  />

                  {uploading ? (
                    <Box>
                      <CircularProgress sx={{ mb: 2 }} />
                      <Typography variant="h6" color="primary.main" gutterBottom>
                        📤 {t('pages:testMovie.uploading')}
                      </Typography>
                    </Box>
                  ) : uploadedFile ? (
                    <Box>
                      <Typography variant="h6" color="success.main" gutterBottom>
                        ✅ {t('pages:testMovie.uploadComplete')}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {t('pages:testMovie.fileName')}: {uploadedFile.name}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {t('pages:testMovie.fileSize')}: {(uploadedFile.size / 1024 / 1024).toFixed(2)} MB
                      </Typography>
                    </Box>
                  ) : (
                    <Box>
                      <Typography variant="h6" gutterBottom>
                        📁 {t('pages:testMovie.clickToSelect')}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t('pages:testMovie.mp4OnlyHint')}
                      </Typography>
                    </Box>
                  )}
                </Box>
              </Box>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => {
                setDialogOpen(false);
                setFormData({ type: 'rtsp', test_movie_s3_path: '' });
                setUploadedFile(null);
              }}>
                {t('common:cancel')}
              </Button>
              <Button
                onClick={handleCreate}
                variant="contained"
                disabled={uploading || !formData.test_movie_s3_path}
              >
                {t('common:create')}
              </Button>
            </DialogActions>
          </Dialog>
        </Container>
      </Box>
    </PageLayout>
  );
};

export default TestMovie;

