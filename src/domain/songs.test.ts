import { describe, expect, it } from 'vitest';
import {
  compileSongCues,
  cooldownBlockOf,
  effectiveMusicCues,
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

  it('trims a later slot instead of dropping it when an earlier one grows over its start', () => {
    const w = make();
    const old = w.blocks.map((b) => b.id);
    // Drag b behind the repeat: a, r, b, c. Slot s1 (a..b) now covers r; s2 (r..c) keeps c.
    w.blocks = [w.blocks[0]!, w.blocks[2]!, w.blocks[1]!, w.blocks[3]!];
    repairSongs(w, old);
    expect(w.songs?.map((s) => [s.id, s.firstBlockId, s.lastBlockId])).toEqual([
      ['s1', 'a', 'b'],
      ['s2', 'c', 'c'],
    ]);
    expect(w.songs?.[1]?.hint).toBe('chorus sprints');
    expect(workoutSchema.safeParse(w).success).toBe(true);
  });

  it('compiles pinned tracks to music cues and measures slot duration', () => {
    const w = make();
    expect(compileSongCues(w)).toEqual([{ blockId: 'a', rep: 1, track }]);
    expect(songDurationSec(w, w.songs![1]!)).toBe(2 * 60 + 60);
  });
});

describe('effectiveMusicCues (M19c two lanes)', () => {
  const cd = { provider: 'youtube', id: 'cool', title: 'Cool', startAtSec: 5 } as const;

  it('old workouts (no songs, no cooldownTrack) play exactly their stored cues', () => {
    const w = make();
    delete w.songs;
    delete w.format;
    w.musicCues = [{ blockId: 'a', rep: 1, track }];
    expect(workoutSchema.parse(JSON.parse(JSON.stringify(w)))).toBeTruthy();
    expect(effectiveMusicCues(w)).toEqual(w.musicCues);
  });

  it('adds pinned slot tracks but never over an explicit cue', () => {
    const w = make();
    expect(effectiveMusicCues(w).map((c) => c.blockId)).toEqual(['a']);
    w.musicCues = [{ blockId: 'a', rep: 1, track: { ...track, id: 'own' } }];
    const cues = effectiveMusicCues(w);
    expect(cues).toHaveLength(1);
    expect(cues[0]?.track.id).toBe('own');
  });

  it('cooldown track starts at the last block and overrides a cue there', () => {
    const w = make();
    w.cooldownTrack = cd;
    w.musicCues = [{ blockId: 'c', rep: 1, track }];
    const cues = effectiveMusicCues(w);
    expect(cues.find((c) => c.blockId === 'c')?.track.id).toBe('cool');
    expect(cues.filter((c) => c.blockId === 'c')).toHaveLength(1);
  });

  it('cooldown follows scaling.cooldownBlockId and a repeat uses its first child', () => {
    const w = make();
    w.cooldownTrack = cd;
    w.scaling = { warmupBlockId: 'a', cooldownBlockId: 'r' };
    expect(cooldownBlockOf(w)?.id).toBe('r');
    expect(effectiveMusicCues(w).some((c) => c.blockId === 'r1' && c.track.id === 'cool')).toBe(
      true,
    );
  });

  it('single-block workout has no cooldown block; track is ignored; schema accepts the field', () => {
    const w = make();
    w.blocks = [steady('a')];
    delete w.songs;
    delete w.format;
    w.cooldownTrack = cd;
    expect(cooldownBlockOf(w)).toBeUndefined();
    expect(effectiveMusicCues(w)).toEqual([]);
    expect(workoutSchema.safeParse(w).success).toBe(true);
  });
});
