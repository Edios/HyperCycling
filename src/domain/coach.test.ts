import { describe, expect, it } from 'vitest';
import { cueForTransition } from './coach';
import type { Segment } from './segments';

function seg(over: Partial<Segment> = {}): Segment {
  return {
    index: 0,
    startSec: 0,
    durationSec: 60,
    kind: 'steady',
    ftpPctStart: 70,
    ftpPctEnd: 70,
    effortStart: 4,
    effortEnd: 4,
    blockId: 'b',
    rep: 1,
    reps: 1,
    ...over,
  };
}

describe('cueForTransition', () => {
  it('returns null for the first segment without a custom cue', () => {
    expect(cueForTransition(undefined, seg())).toBeNull();
  });

  it('fires a custom cue even for the first segment', () => {
    expect(cueForTransition(undefined, seg({ cue: 'Go!' }))).toEqual({ kind: 'custom', text: 'Go!' });
  });

  it('custom cue beats attack', () => {
    const prev = seg({ effortEnd: 3 });
    const next = seg({ effortStart: 8, cue: 'Hold' });
    expect(cueForTransition(prev, next)).toEqual({ kind: 'custom', text: 'Hold' });
  });

  it('attack when effort jumps by 3 or more', () => {
    expect(cueForTransition(seg({ effortEnd: 4 }), seg({ effortStart: 7 }))).toEqual({ kind: 'attack' });
    expect(cueForTransition(seg({ effortEnd: 4 }), seg({ effortStart: 6 }))).toBeNull();
  });

  it('attack beats position change', () => {
    const prev = seg({ effortEnd: 3, position: 'seated' });
    const next = seg({ effortStart: 8, position: 'standing' });
    expect(cueForTransition(prev, next)).toEqual({ kind: 'attack' });
  });

  it('standUp / sitDown on position change', () => {
    expect(cueForTransition(seg({ position: 'seated' }), seg({ position: 'standing' }))).toEqual({
      kind: 'standUp',
    });
    expect(cueForTransition(seg({ position: 'standing' }), seg({ position: 'seated' }))).toEqual({
      kind: 'sitDown',
    });
  });

  it('no position cue when either is undefined or equal', () => {
    expect(cueForTransition(seg(), seg({ position: 'standing' }))).toBeNull();
    expect(cueForTransition(seg({ position: 'seated' }), seg())).toBeNull();
    expect(cueForTransition(seg({ position: 'seated' }), seg({ position: 'seated' }))).toBeNull();
  });

  it('position change beats cadence', () => {
    const prev = seg({ position: 'seated', rpm: 90 });
    const next = seg({ position: 'standing', rpm: 60 });
    expect(cueForTransition(prev, next)).toEqual({ kind: 'standUp' });
  });

  it('numeric cadence by default when rpm differs by 15 or more', () => {
    expect(cueForTransition(seg({ rpm: 80 }), seg({ rpm: 95 }))).toEqual({ kind: 'cadence', rpm: 95 });
    expect(cueForTransition(seg({ rpm: 95 }), seg({ rpm: 80 }))).toEqual({ kind: 'cadence', rpm: 80 });
    expect(cueForTransition(seg({ rpm: 80 }), seg({ rpm: 94 }))).toBeNull();
  });

  it('no cadence cue when either rpm is undefined', () => {
    expect(cueForTransition(seg(), seg({ rpm: 100 }))).toBeNull();
    expect(cueForTransition(seg({ rpm: 100 }), seg())).toBeNull();
  });

  it('relative cadence cues when numericCadence is false', () => {
    const opts = { numericCadence: false };
    expect(cueForTransition(seg({ rpm: 80 }), seg({ rpm: 100 }), opts)).toEqual({ kind: 'cadenceUp' });
    expect(cueForTransition(seg({ rpm: 100 }), seg({ rpm: 80 }), opts)).toEqual({ kind: 'cadenceDown' });
    expect(cueForTransition(seg({ rpm: 80 }), seg({ rpm: 90 }), opts)).toBeNull();
  });

  it('explicit numericCadence true behaves like default', () => {
    expect(cueForTransition(seg({ rpm: 80 }), seg({ rpm: 100 }), { numericCadence: true })).toEqual({
      kind: 'cadence',
      rpm: 100,
    });
  });

  it('returns null inside repeats after the first rep, even with custom cue', () => {
    const prev = seg({ effortEnd: 2, rep: 1, reps: 8 });
    expect(cueForTransition(prev, seg({ effortStart: 9, rep: 2, reps: 8 }))).toBeNull();
    expect(cueForTransition(prev, seg({ rep: 2, reps: 8, cue: 'x' }))).toBeNull();
  });

  it('fires on rep 1 of a repeat', () => {
    const prev = seg({ effortEnd: 2 });
    expect(cueForTransition(prev, seg({ effortStart: 9, rep: 1, reps: 8 }))).toEqual({ kind: 'attack' });
  });
});
