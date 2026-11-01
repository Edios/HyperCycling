import type { TrackInfo } from '../types';
import { getSharedSpotifyProvider, isSpotifyUsable } from './shared';
import { settingsSpotifyStore } from './settings-store';

export const SPOTIFY_LOOKUP_TIMEOUT_MS = 5_000;

/** Spotify's oEmbed answers without a login and allows browser requests; it gives the title only. */
async function oembedTitle(id: string, timeoutMs: number): Promise<TrackInfo | undefined> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const target = `https://open.spotify.com/track/${encodeURIComponent(id)}`;
    const res = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(target)}`, {
      signal: abort.signal,
      referrerPolicy: 'no-referrer',
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { title?: unknown };
    return typeof body.title === 'string' && body.title ? { title: body.title } : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The name (and artists) of a Spotify track for the editor: the Web API when connected, the
 * public oEmbed otherwise or when that fails. Never rejects; `undefined` means nothing was found.
 */
export async function lookupSpotifyTrack(
  id: string,
  timeoutMs: number = SPOTIFY_LOOKUP_TIMEOUT_MS,
): Promise<TrackInfo | undefined> {
  if (isSpotifyUsable(settingsSpotifyStore.read())) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const info = await Promise.race([
        getSharedSpotifyProvider().describeTrack({
          provider: 'spotify',
          id,
          title: '',
          startAtSec: 0,
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
        }),
      ]);
      if (info?.title) return info;
    } catch {
      // fall through to oEmbed
    } finally {
      clearTimeout(timer);
    }
  }
  return oembedTitle(id, timeoutMs);
}
