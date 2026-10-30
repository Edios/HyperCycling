export interface ParsedTrack {
  provider: 'spotify' | 'youtube';
  id: string;
}

const SPOTIFY_ID = /^[A-Za-z0-9]{10,32}$/;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{6,20}$/;

/**
 * Extracts provider and id from a Spotify track link/URI or a YouTube video link
 * (watch?v=, youtu.be/, shorts/). Returns undefined for anything else.
 */
export function parseTrackUrl(input: string): ParsedTrack | undefined {
  const text = input.trim();
  const uri = /^spotify:track:(.*)$/.exec(text);
  if (uri) {
    const id = uri[1] ?? '';
    return SPOTIFY_ID.test(id) ? { provider: 'spotify', id } : undefined;
  }

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');

  if (host === 'open.spotify.com') {
    const id = /\/track\/([^/?#]+)/.exec(url.pathname)?.[1];
    return id && SPOTIFY_ID.test(id) ? { provider: 'spotify', id } : undefined;
  }
  if (host === 'youtu.be') {
    const id = url.pathname.split('/')[1];
    return id && YOUTUBE_ID.test(id) ? { provider: 'youtube', id } : undefined;
  }
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    const fromQuery = url.pathname === '/watch' ? url.searchParams.get('v') : null;
    const id = fromQuery ?? /^\/(?:shorts|embed)\/([^/?#]+)/.exec(url.pathname)?.[1];
    return id && YOUTUBE_ID.test(id) ? { provider: 'youtube', id } : undefined;
  }
  return undefined;
}

/** Parses "m:ss" or plain seconds into seconds; undefined when invalid. */
export function parseClock(text: string): number | undefined {
  const m = /^\s*(?:(\d{1,3}):)?(\d{1,5})\s*$/.exec(text);
  if (!m) return undefined;
  const sec = Number(m[2]);
  if (m[1] === undefined) return sec;
  if (sec > 59) return undefined;
  return Number(m[1]) * 60 + sec;
}
