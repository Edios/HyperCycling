import { describe, expect, it } from 'vitest';
import { flattenWorkout, intensityAt, segmentAt, type Segment } from './segments';
import type { Block, Workout } from './workout';

function wk(blocks: Block[]): Workout {
  return {
    id: 'w',
    name: 'n',
    description: '',
    category: 'progres',
    tags: [],
    source: { kind: 'user' },
    blocks,
    musicCues: [],
    fallbackPlaylist: [],
    schemaVersion: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const repeatWorkout = wk([
  {
    kind: 'repeat',
    id: 'r',
    times: 3,
    blocks: [
      { kind: 'steady', id: 'hard', durationSec: 20, intensity: { effort: 8 } },
      { kind: 'steady', id: 'easy', durationSec: 10, intensity: { effort: 2 } },
    ],
  },
]);

describe('flattenWorkout', () => {
  it('expands repeats', () => {
    const s = flattenWorkout(repeatWorkout);
    expect(s).toHaveLength(6);
    expect(s.map((x) => x.startSec)).toEqual([0, 20, 30, 50, 60, 80]);
    expect(s.map((x) => x.rep)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(s.every((x) => x.reps === 3)).toBe(true);
    expect(s.map((x) => x.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(s[0]?.blockId).toBe('hard');
    expect(s[0]?.ftpPctStart).toBe(100);
    expect(s[1]?.effortStart).toBe(2);
  });
  it('handles steady with ftpPct only, passes through metadata', () => {
    const [seg] = flattenWorkout(
      wk([
        {
          kind: 'steady',
          id: 'a',
          durationSec: 60,
          intensity: { ftpPct: 73 },
          rpm: 90,
          position: 'standing',
          cue: 'go',
          label: 'L',
        },
      ]),
    );
    expect(seg).toMatchObject({
      kind: 'steady',
      ftpPctStart: 73,
      ftpPctEnd: 73,
      effortStart: 4,
      effortEnd: 4,
      rpm: 90,
      position: 'standing',
      cue: 'go',
      label: 'L',
      rep: 1,
      reps: 1,
    });
  });
  it('ftpPct wins over effort when both given', () => {
    const [seg] = flattenWorkout(
      wk([{ kind: 'steady', id: 'a', durationSec: 5, intensity: { effort: 8, ftpPct: 95 } }]),
    );
    expect(seg?.ftpPctStart).toBe(95);
    expect(seg?.effortStart).toBe(7);
  });
  it('flattens a ramp with mixed endpoints', () => {
    const [seg] = flattenWorkout(
      wk([{ kind: 'ramp', id: 'r', durationSec: 600, from: { ftpPct: 40 }, to: { effort: 4 } }]),
    );
    expect(seg).toMatchObject({
      kind: 'ramp',
      ftpPctStart: 40,
      ftpPctEnd: 70,
      effortStart: 1,
      effortEnd: 4,
    });
  });
  it('throws on intensity with neither field', () => {
    expect(() =>
      flattenWorkout(wk([{ kind: 'steady', id: 'a', durationSec: 5, intensity: {} }])),
    ).toThrow();
  });
  it('returns empty for empty workout', () => expect(flattenWorkout(wk([]))).toEqual([]));
});

describe('intensityAt', () => {
  const ramp = flattenWorkout(
    wk([{ kind: 'ramp', id: 'r', durationSec: 600, from: { ftpPct: 40 }, to: { ftpPct: 73 } }]),
  )[0] as Segment;
  it('interpolates linearly', () => {
    expect(intensityAt(ramp, 300).ftpPct).toBe(56.5);
    expect(intensityAt(ramp, 0)).toEqual({ ftpPct: 40, effort: 1 });
    expect(intensityAt(ramp, 600).effort).toBe(4);
  });
  it('clamps elapsed', () => {
    expect(intensityAt(ramp, -10).ftpPct).toBe(40);
    expect(intensityAt(ramp, 9999).ftpPct).toBe(73);
  });
  it('steady returns constant', () => {
    const s = flattenWorkout(repeatWorkout)[0] as Segment;
    expect(intensityAt(s, 10)).toEqual({ ftpPct: 100, effort: 8 });
  });
});

describe('segmentAt', () => {
  const segs = flattenWorkout(repeatWorkout);
  it('finds the segment inside', () => {
    expect(segmentAt(segs, 0)).toBe(0);
    expect(segmentAt(segs, 19.9)).toBe(0);
    expect(segmentAt(segs, 45)).toBe(2);
  });
  it('exact boundary returns the next segment', () => {
    expect(segmentAt(segs, 20)).toBe(1);
    expect(segmentAt(segs, 30)).toBe(2);
  });
  it('negative → 0, past end → last, empty → -1', () => {
    expect(segmentAt(segs, -5)).toBe(0);
    expect(segmentAt(segs, 90)).toBe(5);
    expect(segmentAt(segs, 95)).toBe(5);
    expect(segmentAt([], 3)).toBe(-1);
  });
});
