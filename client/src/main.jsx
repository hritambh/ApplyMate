import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { applyTheme, getStoredTheme } from './theme.js';
import './styles.css';

// Apply the saved theme before first paint to avoid a flash of the wrong theme.
applyTheme(getStoredTheme());

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
