export interface ParsedTrack {
  provider: 'spotify' | 'youtube';
  id: string;
  /** Start offset from a YouTube `t=` parameter, when present. */
  startAtSec?: number;
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
  const youtube = (id: string | undefined): ParsedTrack | undefined => {
    if (!id || !YOUTUBE_ID.test(id)) return undefined;
    const start = parseYoutubeStart(url.searchParams.get('t') ?? url.searchParams.get('start'));
    return start === undefined
      ? { provider: 'youtube', id }
      : { provider: 'youtube', id, startAtSec: start };
  };
  if (host === 'youtu.be') return youtube(url.pathname.split('/')[1]);
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    const fromQuery = url.pathname === '/watch' ? url.searchParams.get('v') : null;
    const id = fromQuery ?? /^\/(?:shorts|embed)\/([^/?#]+)/.exec(url.pathname)?.[1];
    return youtube(id);
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

/** "90", "90s" or "1m30s" (also with hours) to seconds; undefined when absent or invalid. */
export function parseYoutubeStart(raw: string | null): number | undefined {
  if (!raw) return undefined;
  if (/^\d+$/.test(raw)) return Number(raw);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(raw);
  if (!m || (m[1] === undefined && m[2] === undefined && m[3] === undefined)) return undefined;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}
