import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { AuthProvider } from './utils/AuthContext';
import PrivateRoute from './components/PrivateRoute';
import Login from './pages/Login';
import Home from './pages/Home';
import CameraView from './pages/CameraView';
import CameraEdit from './pages/CameraEdit';
import LiveDashboard from './pages/LiveDashboard';
import NotificationHistory from './pages/NotificationHistory';
import Search from './pages/Search';
import Insight from './pages/Insight';
import Bookmark from './pages/Bookmark';
import Tag from './pages/Tag';
import PlaceList from './pages/PlaceList';
import PlaceEdit from './pages/PlaceEdit';
import TestMovie from './pages/TestMovie';
import NotFound from './pages/NotFound';

// Create a theme instance
const theme = createTheme({
  palette: {
    primary: {
      main: '#e67e22',
    },
    secondary: {
      main: '#2ecc71',
    },
    background: {
      default: '#f5f5f5',
    },
  },
  typography: {
    fontFamily: [
      '-apple-system',
      'BlinkMacSystemFont',
      '"Segoe UI"',
      'Roboto',
      '"Helvetica Neue"',
      'Arial',
      'sans-serif',
      '"Apple Color Emoji"',
      '"Segoe UI Emoji"',
      '"Segoe UI Symbol"',
    ].join(','),
  },
});

function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<Login />} />
          
          {/* Protected routes */}
          <Route element={<PrivateRoute />}>
            <Route path="/" element={<Home />} />
            <Route path="/live-dashboard" element={<LiveDashboard />} />
            <Route path="/camera/new" element={<CameraEdit />} />
            <Route path="/camera/:cameraId" element={<CameraView />} />
            <Route path="/camera/:cameraId/edit" element={<CameraEdit />} />
            <Route path="/notifications" element={<NotificationHistory />} />
            <Route path="/search" element={<Search />} />
            <Route path="/insight" element={<Insight />} />
            <Route path="/bookmark" element={<Bookmark />} />
            <Route path="/tag" element={<Tag />} />
            <Route path="/places" element={<PlaceList />} />
            <Route path="/places/new" element={<PlaceEdit />} />
            <Route path="/places/:placeId/edit" element={<PlaceEdit />} />
            <Route path="/test-movie" element={<TestMovie />} />
          </Route>
          
          {/* Redirect to home */}
          <Route path="/index.html" element={<Navigate to="/" replace />} />
          
          {/* 404 route */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
