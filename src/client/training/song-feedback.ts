import { create } from 'zustand';
import {
  songFeedbackRecord,
  withRating,
  type FeedbackInput,
  type SongFeedbackRecord,
  type SongRating,
} from '../../domain/song-feedback';
import { getRepositories } from '../data/repositories';

/**
 * The thumbs of the ride on screen, by `<provider>:<track id>`: what the buttons show. Each tap is
 * written to the device (the `songFeedback` repository); the planner does not read it (spec §9 J).
 */
interface SongFeedbackState {
  rideStartedAt: string | undefined;
  byTrack: Record<string, SongFeedbackRecord>;
}

export const useSongFeedback = create<SongFeedbackState>(() => ({
  rideStartedAt: undefined,
  byTrack: {},
}));

export const trackKey = (t: { provider: string; id: string }): string => `${t.provider}:${t.id}`;

/** Applies a tap and writes it; false when the device refused (the screen keeps the tap). */
export async function rateSong(
  input: FeedbackInput,
  tap: SongRating | 'love',
  now = new Date(),
): Promise<boolean> {
  const state = useSongFeedback.getState();
  // Another ride: the earlier ride's thumbs are not this one's.
  const byTrack = state.rideStartedAt === input.rideStartedAt ? state.byTrack : {};
  const key = trackKey(input.track);
  const current = byTrack[key] ?? songFeedbackRecord(input, now);
  const next = withRating(current, tap, now);
  useSongFeedback.setState({
    rideStartedAt: input.rideStartedAt,
    byTrack: { ...byTrack, [key]: next },
  });
  try {
    const repos = await getRepositories();
    await repos.songFeedback.put(next);
    return true;
  } catch (err) {
    console.warn('Saving the song feedback failed', err);
    return false;
  }
}

/** Forgets the thumbs on screen (a new ride screen); what was written stays on the device. */
export function clearSongFeedback(): void {
  useSongFeedback.setState({ rideStartedAt: undefined, byTrack: {} });
}

export const resetSongFeedbackForTests = clearSongFeedback;
