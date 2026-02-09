import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  TextField,
  Paper,
  Typography,
  CircularProgress,
  Alert,
  Snackbar,
} from '@mui/material';
import { useNavigate, useParams } from 'react-router-dom';
import { getPlace, createPlace, updatePlace } from '../services/api';
import PageLayout from '../components/PageLayout';
import TitleArea from '../components/TitleArea';
import { HEADER_HEIGHT, TITLE_AREA_HEIGHT } from '../constants/layout';
import { useTranslation } from 'react-i18next';

const PlaceEdit = () => {
  const { t } = useTranslation(['pages', 'common']);
  const navigate = useNavigate();
  const { placeId } = useParams();
  const isNewPlace = !placeId || placeId === 'new';

  const [loading, setLoading] = useState(!isNewPlace);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

  const [formData, setFormData] = useState({
    place_id: '',
    name: '',
  });

  const [validationErrors, setValidationErrors] = useState({
    name: '',
  });

  useEffect(() => {
    if (!isNewPlace) {
      fetchPlace();
    }
  }, [placeId, isNewPlace]);

  const fetchPlace = async () => {
    try {
      setLoading(true);
      const data = await getPlace(placeId);
      setFormData({
        place_id: data.place_id || '',
        name: data.name || '',
      });
      setError(null);
    } catch (err) {
      console.error('Error fetching place:', err);
      setError(t('pages:placeEdit.fetchFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (field) => (event) => {
    setFormData({
      ...formData,
      [field]: event.target.value,
    });
    // Clear validation error when user starts typing
    if (validationErrors[field]) {
      setValidationErrors({
        ...validationErrors,
        [field]: '',
      });
    }
  };

  const validateForm = () => {
    const errors = {};
    
    if (!formData.name || formData.name.trim() === '') {
      errors.name = t('pages:placeEdit.nameRequired');
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) {
      return;
    }

    try {
      setSaving(true);
      
      const dataToSave = {
        name: formData.name.trim(),
      };

      if (isNewPlace) {
        await createPlace(dataToSave);
        setSnackbar({
          open: true,
          message: t('pages:placeEdit.createSuccess'),
          severity: 'success',
        });
      } else {
        // Include place_id for update
        dataToSave.place_id = formData.place_id;
        await updatePlace(placeId, dataToSave);
        setSnackbar({
          open: true,
          message: t('pages:placeEdit.updateSuccess'),
          severity: 'success',
        });
      }

      // Navigate back to list after a short delay
      setTimeout(() => {
        navigate('/places');
      }, 1000);
    } catch (err) {
      console.error('Error saving place:', err);
      let errorMessage = t('pages:placeEdit.saveFailed');
      
      // Check if error has response data (from API)
      if (err.response && err.response.data && err.response.data.detail) {
        errorMessage = err.response.data.detail;
      }
      
      setSnackbar({
        open: true,
        message: errorMessage,
        severity: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    navigate('/places');
  };

  const handleCloseSnackbar = () => {
    setSnackbar({ ...snackbar, open: false });
  };

  if (loading) {
    return (
      <PageLayout>
        <TitleArea 
          title={isNewPlace ? t('pages:placeEdit.addTitle') : t('pages:placeEdit.editTitle')} 
          backTo="/places"
        />
        <Box
          sx={{
            marginTop: `${HEADER_HEIGHT + TITLE_AREA_HEIGHT}px`,
            height: `calc(100vh - ${HEADER_HEIGHT + TITLE_AREA_HEIGHT}px)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'auto',
          }}
        >
          <CircularProgress />
        </Box>
      </PageLayout>
    );
  }

  if (error) {
    return (
      <PageLayout>
        <TitleArea 
          title={isNewPlace ? t('pages:placeEdit.addTitle') : t('pages:placeEdit.editTitle')} 
          backTo="/places"
        />
        <Box
          sx={{
            marginTop: `${HEADER_HEIGHT + TITLE_AREA_HEIGHT}px`,
            height: `calc(100vh - ${HEADER_HEIGHT + TITLE_AREA_HEIGHT}px)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'auto',
            p: 3,
          }}
        >
          <Alert severity="error">{error}</Alert>
        </Box>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <TitleArea 
        title={isNewPlace ? t('pages:placeEdit.addTitle') : t('pages:placeEdit.editTitle')} 
        backTo="/places"
        rightContent={
          <>
            <Button
              variant="outlined"
              onClick={handleCancel}
              disabled={saving}
            >
              {t('common:cancel')}
            </Button>
            <Button
              variant="contained"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? <CircularProgress size={24} /> : t('pages:placeEdit.saveButton')}
            </Button>
          </>
        }
      />
      <Box
        sx={{
          marginTop: `${HEADER_HEIGHT + TITLE_AREA_HEIGHT}px`,
          height: `calc(100vh - ${HEADER_HEIGHT + TITLE_AREA_HEIGHT}px)`,
          overflow: 'auto',
          p: 3,
        }}
      >
        <Paper sx={{ p: 3, maxWidth: 800, margin: '0 auto' }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {/* Place ID (read-only, only for edit mode) */}
            {!isNewPlace && (
              <TextField
                label={t('pages:placeEdit.placeId')}
                value={formData.place_id}
                disabled
                fullWidth
                helperText={t('pages:placeEdit.placeIdHelper')}
              />
            )}

            {/* Place Name */}
            <TextField
              label={t('pages:placeEdit.placeName')}
              value={formData.name}
              onChange={handleChange('name')}
              error={!!validationErrors.name}
              helperText={validationErrors.name || t('pages:placeEdit.placeNameHelper')}
              required
              fullWidth
            />
          </Box>
        </Paper>
      </Box>

      {/* Snackbar for notifications */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={handleCloseSnackbar} severity={snackbar.severity} sx={{ width: '100%' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </PageLayout>
  );
};

export default PlaceEdit;

