import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  CircularProgress,
  Alert,
  Snackbar,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from '@mui/material';
import { Edit as EditIcon, Delete as DeleteIcon, Add as AddIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { getPlaces, deletePlace } from '../services/api';
import PageLayout from '../components/PageLayout';
import TitleArea from '../components/TitleArea';
import { HEADER_HEIGHT, TITLE_AREA_HEIGHT } from '../constants/layout';
import { useTranslation } from 'react-i18next';

const PlaceList = () => {
  const navigate = useNavigate();
  const { t } = useTranslation(['pages', 'common']);
  const [places, setPlaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [deleteDialog, setDeleteDialog] = useState({ open: false, placeId: null, placeName: '' });

  useEffect(() => {
    fetchPlaces();
  }, []);

  const fetchPlaces = async () => {
    try {
      setLoading(true);
      const data = await getPlaces();
      setPlaces(data || []);
      setError(null);
    } catch (err) {
      console.error('Error fetching places:', err);
      setError(t('pages:placeList.fetchFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleAddPlace = () => {
    navigate('/places/new');
  };

  const handleEditPlace = (placeId) => {
    navigate(`/places/${placeId}/edit`);
  };

  const handleDeleteClick = (placeId, placeName) => {
    setDeleteDialog({ open: true, placeId, placeName });
  };

  const handleDeleteConfirm = async () => {
    const { placeId, placeName } = deleteDialog;
    try {
      await deletePlace(placeId);
      setSnackbar({
        open: true,
        message: t('pages:placeList.deleteSuccess', { placeName }),
        severity: 'success',
      });
      fetchPlaces(); // Refresh the list
    } catch (err) {
      console.error('Error deleting place:', err);
      let errorMessage = t('pages:placeList.deleteFailed');
      
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
      setDeleteDialog({ open: false, placeId: null, placeName: '' });
    }
  };

  const handleDeleteCancel = () => {
    setDeleteDialog({ open: false, placeId: null, placeName: '' });
  };

  const handleCloseSnackbar = () => {
    setSnackbar({ ...snackbar, open: false });
  };

  if (loading) {
    return (
      <PageLayout>
        <TitleArea 
          title={t('pages:placeList.title')} 
          backTo="/"
          rightContent={
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={handleAddPlace}
            >
              {t('pages:placeList.addButton')}
            </Button>
          }
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
          title={t('pages:placeList.title')} 
          backTo="/"
          rightContent={
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={handleAddPlace}
            >
              {t('pages:placeList.addButton')}
            </Button>
          }
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
        title={t('pages:placeList.title')} 
        backTo="/"
        rightContent={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={handleAddPlace}
          >
            {t('pages:placeList.addButton')}
          </Button>
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
        {places.length === 0 ? (
          <Paper sx={{ p: 3, textAlign: 'center' }}>
            <Typography variant="body1" color="text.secondary">
              {t('pages:placeList.noPlaces')}
            </Typography>
          </Paper>
        ) : (
          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>{t('pages:placeList.placeName')}</TableCell>
                  <TableCell align="right">{t('pages:placeList.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {places.map((place) => (
                  <TableRow key={place.place_id}>
                    <TableCell>{place.name || t('pages:placeList.unnamed')}</TableCell>
                    <TableCell align="right">
                      <IconButton
                        color="primary"
                        onClick={() => handleEditPlace(place.place_id)}
                        title={t('common:edit')}
                      >
                        <EditIcon />
                      </IconButton>
                      <IconButton
                        color="error"
                        onClick={() => handleDeleteClick(place.place_id, place.name)}
                        title={t('common:delete')}
                      >
                        <DeleteIcon />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Box>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialog.open}
        onClose={handleDeleteCancel}
      >
        <DialogTitle>{t('pages:placeList.deleteDialogTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('pages:placeList.deleteDialogContent', { placeName: deleteDialog.placeName })}
            <br />
            <br />
            {t('pages:placeList.deleteDialogWarning')}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteCancel}>{t('common:cancel')}</Button>
          <Button onClick={handleDeleteConfirm} color="error" variant="contained">
            {t('common:delete')}
          </Button>
        </DialogActions>
      </Dialog>

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

export default PlaceList;

