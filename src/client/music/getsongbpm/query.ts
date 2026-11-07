import type { TrackRef } from '../../../domain/workout';
import type { BpmQuery } from './client';

/** Brackets and "official video"-style noise that YouTube titles carry. */
function clean(text: string): string {
  return text
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
    .replace(/\b(official|video|audio|lyrics?|hd|4k|remaster(ed)?)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * What to search GetSongBPM for. Spotify tracks carry title and artist. A YouTube title is
 * usually "Artist - Song (Official Video)": split it; a title without a dash is searched as a
 * song title alone (the channel name is not a reliable artist).
 */
export function trackQuery(
  track: Pick<TrackRef, 'provider' | 'title' | 'artist'>,
): BpmQuery | undefined {
  const raw = track.title.trim();
  if (!raw) return undefined;
  if (track.provider === 'spotify') {
    return { title: raw, ...(track.artist ? { artist: track.artist.split(',')[0]?.trim() } : {}) };
  }
  const dash = raw.split(/\s[-–—]\s/);
  if (dash.length >= 2) {
    const artist = clean(dash[0] as string);
    const title = clean(dash.slice(1).join(' - '));
    if (title) return { title, ...(artist ? { artist } : {}) };
  }
  const title = clean(raw);
  return title ? { title } : undefined;
}
