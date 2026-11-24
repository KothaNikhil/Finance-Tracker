import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { applyTheme, getStoredTheme } from './theme';

applyTheme(getStoredTheme());

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('The app root element is missing.');

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
