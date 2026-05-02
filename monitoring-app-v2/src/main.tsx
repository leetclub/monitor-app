import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/** PWA: HTTPS + manifest + SW with fetch handler → Chrome/Edge “Install app”. Also localhost in dev for testing. */
function shouldRegisterServiceWorker(): boolean {
  if (!('serviceWorker' in navigator)) return false;
  if (import.meta.env.PROD) return true;
  const h = typeof location !== 'undefined' ? location.hostname : '';
  return h === 'localhost' || h === '127.0.0.1';
}

function registerMonitoringServiceWorker() {
  if (!shouldRegisterServiceWorker()) return;
  const opts: RegistrationOptions = { scope: '/', updateViaCache: 'none' };
  const run = () => {
    void navigator.serviceWorker.register('/sw.js', opts).catch(() => {
      /* ignore */
    });
  };
  run();
  window.addEventListener('load', run);
}

registerMonitoringServiceWorker();
