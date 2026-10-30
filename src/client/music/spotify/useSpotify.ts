import { useSettings } from '../../data/useSettings';
import { isSpotifyUsable } from './shared';

/** True while Spotify can be used: tokens are stored and a Client ID resolves. */
export function useSpotifyConnected(): boolean {
  const { settings } = useSettings();
  return isSpotifyUsable(settings.spotify);
}
