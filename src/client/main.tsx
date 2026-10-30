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

void bootstrap(root);
