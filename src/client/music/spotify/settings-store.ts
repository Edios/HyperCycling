import { didSettingsLoadFail, getSettingsSnapshot, updateSettings } from '../../data/useSettings';
import type { SpotifyStore } from './client';

/**
 * Keeps the Spotify credentials in `settings.spotify` through the shared settings store, so a
 * token refresh can never be overwritten by a stale in-memory copy of the settings. Refuses to
 * write after a failed settings load: that would replace the user's real settings with defaults.
 */
export const settingsSpotifyStore: SpotifyStore = {
  read: () => getSettingsSnapshot().spotify,
  write: (next) =>
    didSettingsLoadFail()
      ? Promise.reject(new Error('Settings could not be loaded'))
      : updateSettings({ spotify: next }),
};
