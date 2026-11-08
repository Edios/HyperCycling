import type { SpotifySettings } from '../../../domain/settings';
import { hasCredentials } from './client';
import { resolveClientId } from './client-id';
import { createSpotifyProvider, type SpotifyProvider } from './provider';
import { settingsSpotifyStore } from './settings-store';

let shared: SpotifyProvider | undefined;

/**
 * The app-wide Spotify provider backed by `settings.spotify`. It holds no resources, so training
 * sessions, the editor search and the settings screen can all use the same instance.
 */
export function getSharedSpotifyProvider(): SpotifyProvider {
  return (shared ??= createSpotifyProvider({ store: settingsSpotifyStore, watchdogMs: 6000 }));
}

/** Test seam: forget the shared instance (or install a prepared one). */
export function resetSharedSpotifyProviderForTests(next?: SpotifyProvider): void {
  shared = next;
}

/** True when tokens are stored and a Client ID can be resolved: the provider can be used. */
export function isSpotifyUsable(cfg: SpotifySettings | undefined): boolean {
  return hasCredentials(cfg) && resolveClientId(cfg?.clientId) !== '';
}
