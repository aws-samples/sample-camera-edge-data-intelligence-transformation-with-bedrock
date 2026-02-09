import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Container, 
  Box, 
  Typography, 
  TextField, 
  Button, 
  Paper, 
  Alert,
  CircularProgress
} from '@mui/material';
import { signIn } from '../services/auth';
import { useAuth } from '../utils/AuthContext';
import PasswordChangeDialog from '../components/PasswordChangeDialog';
import { useTranslation } from 'react-i18next';

const Login = () => {
  const { t } = useTranslation(['pages', 'common']);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  
  // Password change dialog state
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [challengeUser, setChallengeUser] = useState(null);
  const [requiredAttributes, setRequiredAttributes] = useState([]);
  
  const navigate = useNavigate();
  const { setUser } = useAuth();
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    
    try {
      const result = await signIn(username, password);
      
      // Check if password change is required
      if (result.type === 'FORCE_CHANGE_PASSWORD') {
        console.log('Password change required');
        setChallengeUser(result.user);
        setRequiredAttributes(result.requiredAttributes);
        setShowPasswordDialog(true);
      } else if (result.type === 'SUCCESS') {
        // Normal login success
        setUser(result.user);
        navigate('/');
      }
    } catch (err) {
      console.error('Login error:', err);
      setError('ログインに失敗しました。ユーザー名とパスワードを確認してください。');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordChangeSuccess = (user) => {
    console.log('Password change successful, logging in user');
    setShowPasswordDialog(false);
    setUser(user);
    navigate('/');
  };

  const handlePasswordChangeError = (error) => {
    console.error('Password change error:', error);
    setError('パスワードの変更に失敗しました。');
  };
  
  return (
    <Container maxWidth="sm">
      <Box sx={{ mt: 8, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <Paper elevation={3} sx={{ p: 4, width: '100%' }}>
          <Typography component="h1" variant="h5" align="center" gutterBottom>
            AWS CEDIX ログイン
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
              id="username"
              label={t('pages:login.username')}
              name="username"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={loading}
            />
            <TextField
              margin="normal"
              required
              fullWidth
              name="password"
              label={t('pages:login.password')}
              type="password"
              id="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
            
            <Button
              type="submit"
              fullWidth
              variant="contained"
              sx={{ mt: 3, mb: 2 }}
              disabled={loading}
            >
              {loading ? <CircularProgress size={24} /> : t('pages:login.loginButton')}
            </Button>
          </Box>
        </Paper>
      </Box>
      
      {/* Password Change Dialog */}
      <PasswordChangeDialog
        open={showPasswordDialog}
        challengeUser={challengeUser}
        requiredAttributes={requiredAttributes}
        onSuccess={handlePasswordChangeSuccess}
        onError={handlePasswordChangeError}
      />
    </Container>
  );
};

export default Login;
