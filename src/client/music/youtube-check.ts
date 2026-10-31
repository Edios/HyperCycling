import type { TrackRef } from '../../domain/workout';

export interface YoutubeCheck {
  /** `ok`: embeddable. `blocked`: the owner disallows embedding. `missing`: private or deleted. */
  status: 'ok' | 'blocked' | 'missing' | 'unknown';
  title?: string;
  author?: string;
}

export const OEMBED_TIMEOUT_MS = 5_000;

/**
 * Asks YouTube's oEmbed endpoint whether a video can be embedded (401 = embedding disabled,
 * 404 = not found) and returns its title. Network trouble or an odd answer gives `unknown`:
 * nothing is marked then, because the IFrame player reports the truth at playback time.
 */
export async function checkYoutubeEmbeddable(
  videoId: string,
  doFetch: typeof fetch = (...a) => fetch(...a),
  timeoutMs: number = OEMBED_TIMEOUT_MS,
): Promise<YoutubeCheck> {
  const target = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    // No referrer: only the video id leaves the app, nothing about where it runs.
    const res = await doFetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(target)}&format=json`,
      { signal: abort.signal, referrerPolicy: 'no-referrer' },
    );
    if (res.status === 401 || res.status === 403) return { status: 'blocked' };
    if (res.status === 404) return { status: 'missing' };
    if (!res.ok) return { status: 'unknown' };
    const body = (await res.json()) as { title?: unknown; author_name?: unknown };
    return {
      status: 'ok',
      ...(typeof body.title === 'string' && body.title ? { title: body.title } : {}),
      ...(typeof body.author_name === 'string' && body.author_name
        ? { author: body.author_name }
        : {}),
    };
  } catch {
    return { status: 'unknown' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The track with what a check found: title and author fill empty fields, a blocked or missing
 * video gets `notEmbeddable`, and a video that now embeds loses the mark. An `unknown` answer
 * changes nothing. Returns the same object when nothing changes.
 */
export function applyYoutubeCheck(track: TrackRef, check: YoutubeCheck): TrackRef {
  const next: TrackRef = { ...track };
  if (check.title && !next.title) next.title = check.title;
  if (check.author && !next.artist) next.artist = check.author;
  if (check.status === 'blocked' || check.status === 'missing') next.notEmbeddable = true;
  else if (check.status === 'ok') delete next.notEmbeddable;
  const same =
    next.title === track.title &&
    next.artist === track.artist &&
    next.notEmbeddable === track.notEmbeddable;
  return same ? track : next;
}
