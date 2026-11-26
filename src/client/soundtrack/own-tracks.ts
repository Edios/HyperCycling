import { create } from 'zustand';
import {
  MAX_OWN_TRACKS,
  ownTrackRecord,
  type OwnTrackInput,
  type OwnTrackRecord,
} from '../../domain/soundtrack-own';
import { getRepositories } from '../data/repositories';

/**
 * The rider's own songs (Soundtrack Match PR 6), read from the device once per visit (the
 * `ownTracks` repository) and kept here for the wizard and the ride screen.
 */
interface OwnTracksState {
  tracks: OwnTrackRecord[];
  /** The device was asked (found or not, or it failed: then the list is empty). */
  loaded: boolean;
}

export const useOwnTracks = create<OwnTracksState>(() => ({ tracks: [], loaded: false }));

let loading: Promise<void> | undefined;

/** Reads the own songs from the device once; a failing storage just means none. */
export function loadOwnTracks(): Promise<void> {
  if (useOwnTracks.getState().loaded) return Promise.resolve();
  loading ??= (async () => {
    try {
      const repos = await getRepositories();
      const tracks = await repos.ownTracks.list();
      useOwnTracks.setState({ tracks: sorted(tracks), loaded: true });
    } catch (err) {
      console.warn('Loading the own songs failed', err);
      useOwnTracks.setState({ loaded: true });
    } finally {
      loading = undefined;
    }
  })();
  return loading;
}

function sorted(tracks: readonly OwnTrackRecord[]): OwnTrackRecord[] {
  return [...tracks].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

export type AddOwnResult = 'added' | 'duplicate' | 'full' | 'failed';

/** Adds a song (one per video) and writes it to the device. */
export async function addOwnTrack(input: OwnTrackInput, now = new Date()): Promise<AddOwnResult> {
  const record = ownTrackRecord(input, now);
  const { tracks } = useOwnTracks.getState();
  if (tracks.some((t) => t.youtubeId === record.youtubeId)) return 'duplicate';
  if (tracks.length >= MAX_OWN_TRACKS) return 'full';
  try {
    const repos = await getRepositories();
    await repos.ownTracks.put(record);
  } catch (err) {
    console.warn('Saving the own song failed', err);
    return 'failed';
  }
  useOwnTracks.setState((s) => ({ tracks: [...s.tracks, record] }));
  return 'added';
}

/** Removes a song from the list and from the device. */
export async function removeOwnTrack(id: string): Promise<boolean> {
  useOwnTracks.setState((s) => ({ tracks: s.tracks.filter((t) => t.id !== id) }));
  try {
    const repos = await getRepositories();
    await repos.ownTracks.remove(id);
    return true;
  } catch (err) {
    console.warn('Removing the own song failed', err);
    return false;
  }
}

export function resetOwnTracksForTests(): void {
  loading = undefined;
  useOwnTracks.setState({ tracks: [], loaded: false });
}
