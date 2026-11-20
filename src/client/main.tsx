import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadSettings } from './data/useSettings';
import { completeSpotifyCallbackOnLoad, settingsSpotifyStore } from './music/spotify';
import './theme/tokens.css';
import './theme/fonts.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

async function bootstrap(container: HTMLElement): Promise<void> {
  // Returning from the Spotify consent page: finish the login before anything reads settings.
  const query = new URLSearchParams(location.search);
  if (query.has('code') || query.has('error')) {
    try {
      await loadSettings();
      await completeSpotifyCallbackOnLoad(settingsSpotifyStore);
    } catch {
      // The app must still start; the settings screen shows the Spotify state.
    }
  }
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

async function start(container: HTMLElement): Promise<void> {
  // Bluetooth test hook for Playwright, installed before the first render so a fake device is
  // in place before any screen reads navigator.bluetooth. The branch and its chunk are removed
  // from other builds.
  if (import.meta.env.VITE_E2E === '1') {
    try {
      (await import('./devices/e2e-hook')).installBleTestHook();
    } catch (err) {
      console.warn('Bluetooth test hook failed', err);
    }
  }
  await bootstrap(container);
}

void start(root);
