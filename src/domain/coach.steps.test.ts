import { describe, expect, it } from 'vitest';
import { PRE_CUE_SEC, RESISTANCE_COMMAND_SEC, resistanceCommand, stepPreCue } from './coach';
import { flattenWorkout, type Segment } from './segments';
import type { Workout } from './workout';

function ramp(from: number, to: number, durationSec: number, rpm?: number): Segment {
  const w: Workout = {
    id: 'w',
    name: 'n',
    description: '',
    category: 'progres',
    tags: [],
    source: { kind: 'user' },
    blocks: [
      {
        kind: 'ramp',
        id: 'r',
        durationSec,
        from: { effort: from as 3 },
        to: { effort: to as 8 },
        ...(rpm !== undefined ? { rpm } : {}),
      },
    ],
    musicCues: [],
    fallbackPlaylist: [],
    schemaVersion: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  return flattenWorkout(w, undefined, 'knob')[0] as Segment;
}

describe('stepPreCue', () => {
  const seg = ramp(3, 8, 240, 90); // six steps of 40 s: efforts 3..8

  it('fires 5 s before a step boundary with the target effort and rpm', () => {
    const r = stepPreCue(seg, 40 - PRE_CUE_SEC);
    expect(r).toEqual({
      key: '0:1',
      cue: { kind: 'addResistance', effort: 4, rpm: 90, inSec: PRE_CUE_SEC },
    });
  });

  it('is silent earlier than the lead time and at the very start of a step', () => {
    expect(stepPreCue(seg, 10)).toBeNull();
    expect(stepPreCue(seg, 40 - PRE_CUE_SEC - 1)).toBeNull();
    expect(stepPreCue(seg, 41)).toBeNull();
  });

  it('keeps the same key for the whole lead window so the caller can announce it once', () => {
    const a = stepPreCue(seg, 35);
    const b = stepPreCue(seg, 38.5);
    expect(a?.key).toBe(b?.key);
  });

  it('has no cue before the last step ends (next block is announced by the transition)', () => {
    expect(stepPreCue(seg, 238)).toBeNull();
  });

  it('says reduce resistance on a descending ramp', () => {
    const down = ramp(8, 3, 240);
    const r = stepPreCue(down, 35);
    expect(r?.cue).toEqual({ kind: 'reduceResistance', effort: 7, inSec: PRE_CUE_SEC });
  });

  it('is silent on a non-stepped or single-step segment', () => {
    expect(stepPreCue(ramp(3, 8, 40), 35)).toBeNull();
    const steady = { ...seg, steps: undefined } as Segment;
    expect(stepPreCue(steady, 35)).toBeNull();
  });

  it('never gives more than one cue per 30 s on an 8-step ramp', () => {
    const long = ramp(1, 10, 480);
    const keys = new Set<string>();
    const times: number[] = [];
    for (let t = 0; t < 480; t += 0.5) {
      const r = stepPreCue(long, t);
      if (r && !keys.has(r.key)) {
        keys.add(r.key);
        times.push(t);
      }
    }
    for (let i = 1; i < times.length; i++) {
      expect((times[i] ?? 0) - (times[i - 1] ?? 0)).toBeGreaterThanOrEqual(30);
    }
  });
});

describe('resistanceCommand', () => {
  const block = (effort: number, rpm?: number): Segment =>
    ({
      index: 1,
      startSec: 0,
      durationSec: 120,
      effortStart: effort,
      effortEnd: effort,
      rep: 1,
      reps: 1,
      ...(rpm !== undefined ? { rpm } : {}),
    }) as Segment;

  it('has nothing to compare with in the first block', () => {
    expect(resistanceCommand(undefined, block(5), 0)).toBeNull();
  });
  it('follows the change of effort from the previous block', () => {
    expect(resistanceCommand(block(4), block(6), 0)).toBe('add');
    expect(resistanceCommand(block(6), block(4), 0)).toBe('ease');
    expect(resistanceCommand(block(5), block(5), 0)).toBe('hold');
  });
  it('counts 15 rpm as one effort level', () => {
    // Same effort, faster legs: less resistance. Same effort, slower legs: more.
    expect(resistanceCommand(block(5, 80), block(5, 95), 0)).toBe('ease');
    expect(resistanceCommand(block(5, 95), block(5, 80), 0)).toBe('add');
    // The extra effort comes from the cadence alone: leave the knob.
    expect(resistanceCommand(block(4, 80), block(5, 95), 0)).toBe('hold');
    // A small cadence change does not count.
    expect(resistanceCommand(block(5, 80), block(5, 90), 0)).toBe('hold');
    // A climb: harder and slower is clearly more resistance.
    expect(resistanceCommand(block(5, 90), block(7, 60), 0)).toBe('add');
  });
  it('settles on hold once the change had time to happen', () => {
    expect(resistanceCommand(block(4), block(6), RESISTANCE_COMMAND_SEC - 1)).toBe('add');
    expect(resistanceCommand(block(4), block(6), RESISTANCE_COMMAND_SEC)).toBe('hold');
  });
  it('inside a stepped ramp compares with the previous step, also in the first block', () => {
    const seg = ramp(3, 8, 240, 90); // six steps of 40 s: efforts 3..8
    expect(resistanceCommand(undefined, seg, 0)).toBeNull();
    expect(resistanceCommand(undefined, seg, 40)).toBe('add');
    expect(resistanceCommand(undefined, seg, 40 + RESISTANCE_COMMAND_SEC)).toBe('hold');
    const down = ramp(8, 3, 240, 90);
    expect(resistanceCommand(undefined, down, 40)).toBe('ease');
  });
  it('enters a block from the last step of a stepped ramp', () => {
    expect(resistanceCommand(ramp(3, 8, 240), block(6), 0)).toBe('ease');
  });
});
