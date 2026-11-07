import type { TrackRef } from '../../../domain/workout';
import type { BpmQuery } from './client';

/** Words that make a bracketed part or a "- suffix" a release note rather than part of the title. */
const NOTE =
  /\b(official|video|audio|lyrics?|hd|4k|remaster(ed)?|mono|stereo|visuali[sz]er|feat\.?|ft\.?|featuring|version|edit)\b/i;
/** "- Remastered 2011", "- 2011 Remaster", "- Official Audio", "- Radio Edit", "- Single Version". */
const NOTE_SUFFIX =
  /^(\d{4}\s+)?(remaster(ed)?|official|lyrics?|audio|video|mono|stereo|single|radio|live)\b.*$/i;

/**
 * A song title without release notes: bracketed notes ("(Official Video)", "[HD]", "(feat. X)"),
 * a trailing "- Remastered 2011" style suffix and a trailing "feat. X". Words are never cut from
 * the middle of a title ("Video Killed the Radio Star" stays whole).
 */
export function cleanTitle(raw: string): string {
  let title = raw.replace(/[([{][^)\]}]*[)\]}]/g, (group) => (NOTE.test(group) ? ' ' : group));
  const dash = title.split(/\s[-–—]\s/);
  while (dash.length > 1 && NOTE_SUFFIX.test((dash[dash.length - 1] as string).trim())) dash.pop();
  title = dash.join(' - ');
  title = title.replace(/\s+(feat\.?|ft\.?|featuring)\s.*$/i, '');
  return title.replace(/\s+/g, ' ').trim();
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
    const title = cleanTitle(raw);
    if (!title) return undefined;
    const artist = track.artist?.split(',')[0]?.trim();
    return { title, ...(artist ? { artist } : {}) };
  }
  const parts = raw.split(/\s[-–—]\s/);
  if (parts.length >= 2) {
    const artist = (parts[0] as string).trim();
    const title = cleanTitle(parts.slice(1).join(' - '));
    if (title) return { title, ...(artist ? { artist } : {}) };
  }
  const title = cleanTitle(raw);
  return title ? { title } : undefined;
}
