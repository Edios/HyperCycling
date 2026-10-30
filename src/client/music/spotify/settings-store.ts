import { getSettingsSnapshot, updateSettings } from '../../data/useSettings';
import type { SpotifyStore } from './client';

/**
 * Keeps the Spotify credentials in `settings.spotify` through the shared settings store, so a
 * token refresh can never be overwritten by a stale in-memory copy of the settings.
 */
export const settingsSpotifyStore: SpotifyStore = {
  read: () => getSettingsSnapshot().spotify,
  write: (next) => updateSettings({ spotify: next }),
};
