import React from 'react';
import { Container, Typography, Box, Button } from '@mui/material';
import { Link } from 'react-router-dom';
import Header from '../components/Header';

const NotFound = () => {
  return (
    <>
      <Header />
      <Container className="container">
        <Box sx={{ my: 4, textAlign: 'center' }}>
          <Typography variant="h1" component="h1" gutterBottom>
            404
          </Typography>
          <Typography variant="h4" component="h2" gutterBottom>
            ページが見つかりません
          </Typography>
          <Typography variant="body1" paragraph>
            お探しのページは存在しないか、移動した可能性があります。
          </Typography>
          <Button variant="contained" component={Link} to="/" sx={{ mt: 2 }}>
            ホームに戻る
          </Button>
        </Box>
      </Container>
    </>
  );
};

export default NotFound;
