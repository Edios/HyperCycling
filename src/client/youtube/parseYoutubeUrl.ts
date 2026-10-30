export interface ParsedYoutubeUrl {
  videoId: string;
  /** Where playback starts, in whole seconds (0 when the link has no start time). */
  startSec: number;
}

const ID = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);

/** "90", "90s", "1m30s", "1h2m3s" as seconds; anything else is undefined. */
export function parseStartTime(raw: string): number | undefined {
  const s = raw.trim().toLowerCase();
  if (/^\d+$/.test(s)) return Number(s);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(s);
  if (!m || s === '') return undefined;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

function startFrom(url: URL): number {
  for (const key of ['t', 'start']) {
    const v = url.searchParams.get(key);
    if (v !== null) {
      const sec = parseStartTime(v);
      if (sec !== undefined) return sec;
    }
  }
  return 0;
}

/** The video id and start time of a YouTube link, or null when it is not one we can play. */
export function parseYoutubeUrl(input: string): ParsedYoutubeUrl | null {
  const text = input.trim();
  if (text === '') return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);
  let id: string | null | undefined;
  if (host === 'youtu.be') {
    id = parts[0];
  } else if (HOSTS.has(host)) {
    if (parts[0] === 'watch') id = url.searchParams.get('v');
    else if (parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live') id = parts[1];
  } else {
    return null;
  }
  if (!id || !ID.test(id)) return null;
  return { videoId: id, startSec: startFrom(url) };
}
