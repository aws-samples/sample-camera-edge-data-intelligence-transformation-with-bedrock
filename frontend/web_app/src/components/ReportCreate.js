import React, { useState } from 'react';
import {
  Dialog, DialogContent, DialogActions,
  TextField, Button, Box, Typography, CircularProgress, Alert, Grid, Paper
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { createReport } from '../services/api';
import ReactMarkdown from 'react-markdown';

const DEFAULT_MODEL_ID = 'global.anthropic.claude-haiku-4-5-20251001-v1:0';

const ReportCreate = ({ open, onClose, bookmark }) => {
  const { t } = useTranslation(['dialogs', 'common']);
  
  const [title, setTitle] = useState(t('dialogs:reportCreate.defaultTitle'));
  const [content, setContent] = useState(t('dialogs:reportCreate.defaultContent'));
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const handleCreate = async () => {
    if (!title || !content || !modelId) {
      setError(t('dialogs:reportCreate.validationError'));
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await createReport({
        bookmark_id: bookmark?.bookmark_id,
        report_title: title,
        report_content: content,
        model_id: modelId
      });
      setResult(data.report || data.result || t('dialogs:reportCreate.successMessage'));
    } catch (e) {
      setError(t('dialogs:reportCreate.errorMessage'));
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setTitle(t('dialogs:reportCreate.defaultTitle'));
    setContent(t('dialogs:reportCreate.defaultContent'));
    setModelId(DEFAULT_MODEL_ID);
    setResult(null);
    setError(null);
    setLoading(false);
    onClose();
  };

  return (
    <Dialog 
      open={open} 
      onClose={handleClose} 
      maxWidth="xl" 
      fullWidth
      sx={{
        '& .MuiDialog-paper': {
          width: '95vw',
          height: '90vh',
          maxWidth: '95vw',
          maxHeight: '90vh'
        }
      }}
    >
      <DialogContent sx={{ height: 'calc(100% - 60px)', overflow: 'hidden', p: 2 }}>
        <Grid container spacing={2} sx={{ height: '100%' }}>
          {/* 左側: レポート結果表示エリア（広い） */}
          <Grid item xs={8} sx={{ height: '100%' }}>
            <Paper sx={{ 
              height: '100%', 
              p: 2, 
              display: 'flex', 
              flexDirection: 'column',
              backgroundColor: '#fafafa'
            }}>
              <Typography variant="h6" sx={{ mb: 2 }}>
                {t('dialogs:reportCreate.resultTitle')}
              </Typography>
              <Box sx={{ 
                flex: 1,
                border: '1px solid #ccc', 
                borderRadius: 1, 
                p: 2, 
                background: 'white',
                overflow: 'auto'
              }}>
                {loading && (
                  <Box sx={{ 
                    display: 'flex', 
                    justifyContent: 'center', 
                    alignItems: 'center', 
                    height: '100%' 
                  }}>
                    <CircularProgress />
                  </Box>
                )}
                {!loading && !result && (
                  <Box sx={{ 
                    display: 'flex', 
                    justifyContent: 'center', 
                    alignItems: 'center', 
                    height: '100%',
                    color: 'text.secondary'
                  }}>
                    <Typography variant="body1">
                      {t('dialogs:reportCreate.resultPlaceholder')}
                    </Typography>
                  </Box>
                )}
                {result && (
                  <ReactMarkdown
                    components={{
                      img: ({ src, alt, ...props }) => (
                        <img 
                          src={src} 
                          alt={alt} 
                          style={{ maxWidth: '400px', height: 'auto' }}
                          {...props}
                        />
                      )
                    }}
                  >
                    {result}
                  </ReactMarkdown>
                )}
              </Box>
            </Paper>
          </Grid>
          
          {/* 右側: フォームエリア（幅狭い） */}
          <Grid item xs={4} sx={{ height: '100%' }}>
            <Paper sx={{ 
              height: '100%', 
              p: 2, 
              display: 'flex', 
              flexDirection: 'column'
            }}>
              <Typography variant="h6" sx={{ mb: 2 }}>
                {t('dialogs:reportCreate.settingsTitle')}
              </Typography>
              
              <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <TextField
                  label={t('dialogs:reportCreate.reportTitle')}
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  fullWidth
                  variant="outlined"
                />
                
                <TextField
                  label={t('dialogs:reportCreate.modelId')}
                  value={modelId}
                  onChange={e => setModelId(e.target.value)}
                  fullWidth
                  variant="outlined"
                  helperText={t('dialogs:reportCreate.modelIdHelp')}
                />
                
                <TextField
                  label={t('dialogs:reportCreate.reportContent')}
                  value={content}
                  onChange={e => setContent(e.target.value)}
                  fullWidth
                  multiline
                  rows={6}
                  variant="outlined"
                />
                
                {error && <Alert severity="error">{error}</Alert>}
                
                <Box sx={{ mt: 'auto', pt: 2 }}>
                  <Button 
                    onClick={handleCreate} 
                    variant="contained" 
                    color="primary" 
                    disabled={loading}
                    fullWidth
                    size="large"
                  >
                    {t('dialogs:reportCreate.createButton')}
                  </Button>
                </Box>
              </Box>
            </Paper>
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>{t('dialogs:reportCreate.close')}</Button>
      </DialogActions>
    </Dialog>
  );
};

export default ReportCreate;
