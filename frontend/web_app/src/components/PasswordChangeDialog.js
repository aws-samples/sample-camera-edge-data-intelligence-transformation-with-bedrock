import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Box,
  Typography,
  Alert,
  CircularProgress
} from '@mui/material';
import { completeNewPassword } from '../services/auth';

const PasswordChangeDialog = ({ open, challengeUser, requiredAttributes, onSuccess, onError }) => {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    // Validate passwords match
    if (newPassword !== confirmPassword) {
      setError('パスワードが一致しません');
      return;
    }
    
    // Validate password strength
    if (newPassword.length < 8) {
      setError('パスワードは8文字以上で入力してください');
      return;
    }
    
    setLoading(true);
    
    try {
      // Complete the new password challenge
      const user = await completeNewPassword(challengeUser, newPassword, requiredAttributes);
      onSuccess(user);
    } catch (err) {
      console.error('Password change error:', err);
      let errorMessage = 'パスワードの変更に失敗しました';
      
      if (err.code === 'InvalidPasswordException') {
        errorMessage = 'パスワードが要件を満たしていません。より強いパスワードを設定してください。';
      } else if (err.code === 'LimitExceededException') {
        errorMessage = '試行回数が上限に達しました。しばらく待ってから再度お試しください。';
      }
      
      setError(errorMessage);
      onError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} maxWidth="sm" fullWidth disableEscapeKeyDown>
      <DialogTitle>
        パスワードの変更が必要です
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          初回ログインのため、新しいパスワードを設定してください。
        </Typography>
        
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        
        <Box component="form" onSubmit={handleSubmit} sx={{ mt: 1 }}>
          <TextField
            margin="normal"
            required
            fullWidth
            name="newPassword"
            label="新しいパスワード"
            type="password"
            id="newPassword"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            disabled={loading}
            helperText="8文字以上で入力してください"
          />
          <TextField
            margin="normal"
            required
            fullWidth
            name="confirmPassword"
            label="パスワード確認"
            type="password"
            id="confirmPassword"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            disabled={loading}
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={loading || !newPassword || !confirmPassword}
          fullWidth
        >
          {loading ? <CircularProgress size={24} /> : 'パスワードを変更'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default PasswordChangeDialog; 