import type { TrackRef } from '../../domain/workout';
import { getSharedSpotifyProvider, isSpotifyUsable } from './spotify/shared';
import { settingsSpotifyStore } from './spotify/settings-store';
import type { MusicProvider } from './types';
import { createYoutubeMusicProvider, type YoutubeMusicProvider } from './youtube-provider';

export interface MusicProviders {
  /** The provider for a track's service, created on first use. `undefined` when not available. */
  get(kind: TrackRef['provider']): MusicProvider | undefined;
  /** Stops and releases everything created so far. */
  dispose(): void;
}

/**
 * The providers one training session can use. YouTube needs no sign-in, so it is always there;
 * Spotify joins when a Client ID resolves and tokens are stored (otherwise its tracks count as
 * unplayable and the director warns once per track).
 */
export function createMusicProviders(): MusicProviders {
  let youtube: YoutubeMusicProvider | undefined;
  return {
    get(kind) {
      if (kind === 'youtube') return (youtube ??= createYoutubeMusicProvider());
      return isSpotifyUsable(settingsSpotifyStore.read()) ? getSharedSpotifyProvider() : undefined;
    },
    dispose() {
      youtube?.dispose();
      youtube = undefined;
    },
  };
}
