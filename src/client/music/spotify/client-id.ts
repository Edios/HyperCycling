/**
 * Spotify Client ID to use: the value saved in settings wins, otherwise the optional build-time
 * default `VITE_SPOTIFY_CLIENT_ID`, otherwise empty. A Client ID is public under PKCE; it is
 * the only Spotify value allowed in a VITE_* variable (those are baked into the bundle).
 */
export function resolveClientId(
  settingsClientId?: string,
  buildDefault: string | undefined = import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined,
): string {
  return settingsClientId?.trim() || buildDefault?.trim() || '';
}
