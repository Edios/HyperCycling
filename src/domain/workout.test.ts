import { describe, expect, it } from 'vitest';
import { newId } from './ids';
import {
  duplicateWorkout,
  totalDurationSec,
  workoutSchema,
  type Block,
  type Workout,
} from './workout';

const track = { provider: 'youtube', id: 'abc', title: 'Song', startAtSec: 0 } as const;

function makeWorkout(overrides: Partial<Workout> = {}): Workout {
  return {
    id: 'w1',
    name: 'Test',
    description: 'desc',
    category: 'progres',
    tags: ['a'],
    source: { kind: 'builtin' },
    blocks: [
      { kind: 'steady', id: 'b1', durationSec: 120, intensity: { effort: 4 } },
      {
        kind: 'repeat',
        id: 'r1',
        times: 3,
        blocks: [
          { kind: 'steady', id: 'r1a', durationSec: 60, intensity: { effort: 8 }, rpm: 90 },
          { kind: 'ramp', id: 'r1b', durationSec: 30, from: { ftpPct: 50 }, to: { effort: 3 } },
        ],
      },
    ],
    musicCues: [{ blockId: 'r1a', rep: 2, track }],
    fallbackPlaylist: [track],
    schemaVersion: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('workoutSchema', () => {
  it('parses a valid workout', () => {
    expect(workoutSchema.safeParse(makeWorkout()).success).toBe(true);
  });
  it('accepts localized and musicHints', () => {
    const w = makeWorkout({
      localized: { pl: { name: 'Test PL', description: 'opis' } },
      musicHints: { b1: 'calm song' },
    });
    expect(workoutSchema.safeParse(w).success).toBe(true);
  });
  it('rejects a block without intensity', () => {
    const w = makeWorkout({
      blocks: [{ kind: 'steady', id: 'b1', durationSec: 10, intensity: {} }],
    });
    expect(workoutSchema.safeParse(w).success).toBe(false);
  });
  it('rejects a ramp with empty endpoint', () => {
    const w = makeWorkout({
      blocks: [{ kind: 'ramp', id: 'b1', durationSec: 10, from: {}, to: { effort: 3 } }],
    });
    expect(workoutSchema.safeParse(w).success).toBe(false);
  });
  it('rejects a cue to an unknown block', () => {
    const w = makeWorkout({ musicCues: [{ blockId: 'nope', rep: 1, track }] });
    expect(workoutSchema.safeParse(w).success).toBe(false);
  });
  it('rejects bad numeric ranges', () => {
    const steady = (extra: object): Block => ({
      kind: 'steady',
      id: 'x',
      durationSec: 10,
      intensity: { effort: 3 },
      ...extra,
    });
    for (const bad of [
      steady({ durationSec: 0 }),
      steady({ durationSec: 14401 }),
      steady({ durationSec: 1.5 }),
      steady({ rpm: 29 }),
      steady({ rpm: 151 }),
    ]) {
      expect(workoutSchema.safeParse(makeWorkout({ blocks: [bad], musicCues: [] })).success).toBe(
        false,
      );
    }
  });
  it('rejects bad repeat and name and cue rep', () => {
    const child = { kind: 'steady', id: 'c', durationSec: 10, intensity: { effort: 3 } } as const;
    const rep = (times: number, blocks: Block[] = [child]): Block =>
      ({ kind: 'repeat', id: 'r', times, blocks }) as Block;
    expect(workoutSchema.safeParse(makeWorkout({ blocks: [rep(1)], musicCues: [] })).success).toBe(
      false,
    );
    expect(workoutSchema.safeParse(makeWorkout({ blocks: [rep(51)], musicCues: [] })).success).toBe(
      false,
    );
    expect(
      workoutSchema.safeParse(makeWorkout({ blocks: [rep(2, [])], musicCues: [] })).success,
    ).toBe(false);
    expect(workoutSchema.safeParse(makeWorkout({ name: '' })).success).toBe(false);
    expect(workoutSchema.safeParse(makeWorkout({ name: 'x'.repeat(81) })).success).toBe(false);
    expect(
      workoutSchema.safeParse(makeWorkout({ musicCues: [{ blockId: 'b1', rep: 0, track }] }))
        .success,
    ).toBe(false);
    expect(workoutSchema.safeParse({ ...makeWorkout(), schemaVersion: 2 }).success).toBe(false);
  });
});

describe('totalDurationSec', () => {
  it('counts repeats: 3 x (60+30) + 120 = 390', () => {
    expect(totalDurationSec(makeWorkout())).toBe(390);
  });
});

describe('newId', () => {
  it('returns unique uuids', () => {
    expect(newId()).not.toBe(newId());
    expect(newId()).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('duplicateWorkout', () => {
  it('gives new ids, remaps cues, marks as user', () => {
    const w = makeWorkout({ musicHints: { r1a: 'hint' } });
    const d = duplicateWorkout(w, ' (copy)');
    expect(d.id).not.toBe(w.id);
    expect(d.name).toBe('Test (copy)');
    expect(d.source).toEqual({ kind: 'user' });
    const ids = (bs: Block[]): string[] =>
      bs.flatMap((b) => (b.kind === 'repeat' ? [b.id, ...ids(b.blocks)] : [b.id]));
    const oldIds = ids(w.blocks);
    const newIds = ids(d.blocks);
    expect(newIds).toHaveLength(oldIds.length);
    expect(newIds.some((i) => oldIds.includes(i))).toBe(false);
    const repeat = d.blocks[1];
    if (repeat?.kind !== 'repeat') throw new Error('expected repeat');
    const newR1a = repeat.blocks[0]?.id;
    expect(d.musicCues[0]?.blockId).toBe(newR1a);
    expect(d.musicHints).toEqual({ [newR1a ?? '']: 'hint' });
    expect(workoutSchema.safeParse(d).success).toBe(true);
    // original untouched
    expect(w.blocks[0]?.id).toBe('b1');
    expect(w.musicCues[0]?.blockId).toBe('r1a');
  });
  it('works without musicHints and drops source.file', () => {
    const w = makeWorkout({ source: { kind: 'import', file: 'x.zwo' } });
    const d = duplicateWorkout(w, ' 2');
    expect(d.source).toEqual({ kind: 'user' });
    expect(d.musicHints).toBeUndefined();
  });
});
