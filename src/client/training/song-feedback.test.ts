import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ records: new Map<string, unknown>(), fail: false }));
vi.mock('../data/repositories', () => ({
  getRepositories: () =>
    db.fail
      ? Promise.reject(new Error('storage is gone'))
      : Promise.resolve({
          songFeedback: {
            put: (r: { id: string }) => {
              db.records.set(r.id, r);
              return Promise.resolve();
            },
          },
        }),
}));

import type { Segment } from '../../domain/segments';
import type { TrackRef } from '../../domain/workout';
import { rateSong, resetSongFeedbackForTests, useSongFeedback } from './song-feedback';

const segment: Segment = {
  index: 0,
  startSec: 0,
  durationSec: 60,
  kind: 'steady',
  ftpPctStart: 85,
  ftpPctEnd: 85,
  effortStart: 6,
  effortEnd: 6,
  rpm: 90,
  blockId: 'b',
  rep: 1,
  reps: 1,
};
const track: TrackRef = {
  provider: 'youtube',
  id: 'abcdefghijk',
  title: 'Song',
  bpm: 176,
  startAtSec: 0,
};
const ride = { rideStartedAt: '2026-11-26T17:40:00.000Z', workoutId: 'w1' };

beforeEach(() => {
  db.records.clear();
  db.fail = false;
  resetSongFeedbackForTests();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('rateSong', () => {
  it('stores a thumb with its context, and the next tap on the same song updates the same record', async () => {
    await rateSong({ ...ride, track, segment }, 'up');
    await rateSong({ ...ride, track, segment: { ...segment, effortStart: 9 } }, 'love');
    expect(db.records.size).toBe(1);
    const r = [...db.records.values()][0];
    // The context is the one of the first tap: when the rider judged the song.
    expect(r).toMatchObject({
      rating: 'up',
      love: true,
      context: { effort: 6, relation: 'exact' },
    });
    expect(useSongFeedback.getState().byTrack['youtube:abcdefghijk']).toMatchObject({
      rating: 'up',
    });
  });

  it('keeps the rating on screen when the device refuses it, and says so', async () => {
    db.fail = true;
    expect(await rateSong({ ...ride, track, segment }, 'down')).toBe(false);
    expect(useSongFeedback.getState().byTrack['youtube:abcdefghijk']?.rating).toBe('down');
  });
});
