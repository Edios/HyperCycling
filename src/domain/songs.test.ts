import { describe, expect, it } from 'vitest';
import {
  compileSongCues,
  duplicateWorkout,
  repairSongs,
  songDurationSec,
  workoutSchema,
  type Workout,
} from './workout';

const track = { provider: 'youtube', id: 'abc', title: 'Song', startAtSec: 0 } as const;
const steady = (id: string, durationSec = 60) =>
  ({ kind: 'steady', id, durationSec, intensity: { effort: 4 } }) as const;

function make(): Workout {
  return {
    id: 'w',
    name: 'Class',
    description: 'd',
    category: 'freestyle',
    tags: ['music'],
    source: { kind: 'user' },
    blocks: [
      steady('a'),
      steady('b'),
      { kind: 'repeat', id: 'r', times: 2, blocks: [steady('r1', 30), steady('r2', 30)] },
      steady('c'),
    ],
    musicCues: [],
    fallbackPlaylist: [],
    format: 'songs',
    songs: [
      { id: 's1', firstBlockId: 'a', lastBlockId: 'b', bpm: [120, 128], track },
      { id: 's2', firstBlockId: 'r', lastBlockId: 'c', hint: 'chorus sprints' },
    ],
    schemaVersion: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('song slots', () => {
  it('accepts a valid class workout and old workouts without songs', () => {
    expect(workoutSchema.safeParse(make()).success).toBe(true);
    const old: Partial<Workout> = make();
    delete old.songs;
    delete old.format;
    expect(workoutSchema.safeParse(old).success).toBe(true);
  });

  it('rejects unknown, child, inverted, overlapping and duplicate slots', () => {
    const bad = (songs: Workout['songs']) => workoutSchema.safeParse({ ...make(), songs }).success;
    expect(bad([{ id: 'x', firstBlockId: 'nope', lastBlockId: 'a' }])).toBe(false);
    expect(bad([{ id: 'x', firstBlockId: 'r1', lastBlockId: 'c' }])).toBe(false);
    expect(bad([{ id: 'x', firstBlockId: 'b', lastBlockId: 'a' }])).toBe(false);
    expect(
      bad([
        { id: 'x', firstBlockId: 'a', lastBlockId: 'b' },
        { id: 'y', firstBlockId: 'b', lastBlockId: 'c' },
      ]),
    ).toBe(false);
    expect(
      bad([
        { id: 'x', firstBlockId: 'a', lastBlockId: 'a' },
        { id: 'x', firstBlockId: 'b', lastBlockId: 'b' },
      ]),
    ).toBe(false);
  });

  it('duplicate remaps slot block ids and gives fresh slot ids', () => {
    const copy = duplicateWorkout(make(), ' copy');
    expect(workoutSchema.safeParse(copy).success).toBe(true);
    expect(copy.songs?.[0]?.firstBlockId).toBe(copy.blocks[0]?.id);
    expect(copy.songs?.[1]?.lastBlockId).toBe(copy.blocks[3]?.id);
    expect(copy.songs?.[0]?.id).not.toBe('s1');
  });

  it('repair shrinks a slot when its edge block is deleted and drops an emptied one', () => {
    const w = make();
    const old = w.blocks.map((b) => b.id);
    w.blocks = w.blocks.filter((b) => b.id !== 'a');
    repairSongs(w, old);
    expect(w.songs?.[0]).toMatchObject({ firstBlockId: 'b', lastBlockId: 'b' });
    w.blocks = w.blocks.filter((b) => b.id !== 'b');
    repairSongs(w, w.blocks.length ? ['b', ...w.blocks.map((b) => b.id)] : []);
    expect(w.songs?.map((s) => s.id)).toEqual(['s2']);
    expect(workoutSchema.safeParse(w).success).toBe(true);
  });

  it('repair drops slots broken by a move and clears songs when none are left', () => {
    const w = make();
    const old = w.blocks.map((b) => b.id);
    w.blocks = [w.blocks[3]!, w.blocks[0]!, w.blocks[1]!, w.blocks[2]!];
    repairSongs(w, old);
    expect(workoutSchema.safeParse(w).success).toBe(true);
    const only = make();
    only.songs = [{ id: 's', firstBlockId: 'a', lastBlockId: 'a' }];
    const order = only.blocks.map((b) => b.id);
    only.blocks = only.blocks.slice(1);
    repairSongs(only, order);
    expect(only.songs).toBeUndefined();
    expect(only.format).toBeUndefined();
  });

  it('compiles pinned tracks to music cues and measures slot duration', () => {
    const w = make();
    expect(compileSongCues(w)).toEqual([{ blockId: 'a', rep: 1, track }]);
    expect(songDurationSec(w, w.songs![1]!)).toBe(2 * 60 + 60);
  });
});
