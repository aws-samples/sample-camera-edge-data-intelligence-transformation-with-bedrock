import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import { BrowserRouter } from 'react-router-dom';
import { Amplify } from 'aws-amplify';
import { requiredEnvVar } from './utils/env';
import './i18n'; // i18n設定を初期化
import { initializeLocale } from './utils/locale';

// Initialize locale (ブラウザ言語検出)
initializeLocale();

// Configure Amplify
// Values can be overridden with environment variables
Amplify.configure({
  Auth: {
    region: requiredEnvVar('VITE_REGION', import.meta.env.VITE_REGION),
    userPoolId: requiredEnvVar('VITE_USER_POOL_ID', import.meta.env.VITE_USER_POOL_ID),
    userPoolWebClientId: requiredEnvVar('VITE_USER_POOL_CLIENT_ID', import.meta.env.VITE_USER_POOL_CLIENT_ID),
    mandatorySignIn: true,
  },
  API: {
    endpoints: [
      {
        name: 'cedix_api',
        endpoint: requiredEnvVar('VITE_API_URL', import.meta.env.VITE_API_URL),
      },
    ],
  }
});

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  // <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  // </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
