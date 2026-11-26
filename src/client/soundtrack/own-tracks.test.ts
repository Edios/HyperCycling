import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ records: new Map<string, unknown>(), fail: false }));
vi.mock('../data/repositories', () => ({
  getRepositories: () =>
    db.fail
      ? Promise.reject(new Error('storage is gone'))
      : Promise.resolve({
          ownTracks: {
            list: () => Promise.resolve([...db.records.values()]),
            put: (r: { id: string }) => {
              db.records.set(r.id, r);
              return Promise.resolve();
            },
            remove: (id: string) => {
              db.records.delete(id);
              return Promise.resolve();
            },
          },
        }),
}));

import {
  addOwnTrack,
  loadOwnTracks,
  removeOwnTrack,
  resetOwnTracksForTests,
  useOwnTracks,
} from './own-tracks';

const song = { youtubeId: 'abcdefghijk', title: 'Mine', bpm: 130 };

beforeEach(() => {
  db.records.clear();
  db.fail = false;
  resetOwnTracksForTests();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('own songs on the device', () => {
  it('adds a song, refuses the same video twice, and keeps it after a reload', async () => {
    await loadOwnTracks();
    expect(await addOwnTrack(song)).toBe('added');
    expect(await addOwnTrack({ ...song, title: 'Again' })).toBe('duplicate');
    expect(useOwnTracks.getState().tracks.map((t) => t.title)).toEqual(['Mine']);
    resetOwnTracksForTests();
    await loadOwnTracks();
    expect(useOwnTracks.getState().tracks.map((t) => t.id)).toEqual(['own-abcdefghijk']);
  });

  it('removes a song from the list and the device', async () => {
    await addOwnTrack(song);
    await removeOwnTrack('own-abcdefghijk');
    expect(useOwnTracks.getState().tracks).toEqual([]);
    expect(db.records.size).toBe(0);
  });

  it('reads a failing storage as no songs, and says when a save failed', async () => {
    db.fail = true;
    await loadOwnTracks();
    expect(useOwnTracks.getState()).toEqual({ tracks: [], loaded: true });
    expect(await addOwnTrack(song)).toBe('failed');
    expect(useOwnTracks.getState().tracks).toEqual([]);
  });
});
