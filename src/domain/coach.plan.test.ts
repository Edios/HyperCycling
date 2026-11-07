import { describe, expect, it } from 'vitest';
import { buildCuePlan, cuePlanAt, PRE_LEAD_SEC } from './coach';
import type { Segment } from './segments';

function seg(i: number, start: number, dur: number, over: Partial<Segment> = {}): Segment {
  return {
    index: i,
    startSec: start,
    durationSec: dur,
    kind: 'steady',
    ftpPctStart: 60,
    ftpPctEnd: 60,
    effortStart: 4,
    effortEnd: 4,
    position: 'seated',
    blockId: `b${i}`,
    rep: 1,
    reps: 1,
    ...over,
  };
}

describe('buildCuePlan', () => {
  it('announces a position change 10 s ahead, before the command boundary', () => {
    const segs = [seg(0, 0, 60), seg(1, 60, 60, { position: 'standing' })];
    const plan = buildCuePlan(segs);
    const pre = plan.find((e) => e.cue.kind === 'pre');
    expect(pre).toMatchObject({ atSec: 60 - PRE_LEAD_SEC, cue: { change: 'standUp', inSec: 10 } });
    expect(pre!.atSec).toBeLessThan(60);
  });

  it('orders pre-cue < boundary < closing, entries ascending', () => {
    const segs = [
      seg(0, 0, 60),
      seg(1, 60, 80, { effortStart: 8, effortEnd: 8 }),
      seg(2, 140, 60),
    ];
    const plan = buildCuePlan(segs);
    const pre = plan.find((e) => e.cue.kind === 'pre');
    const closing = plan.find((e) => e.cue.kind === 'closing');
    expect(pre && closing).toBeTruthy();
    expect(pre!.atSec).toBe(50);
    expect(closing!.atSec).toBeGreaterThan(60);
    expect(closing!.atSec).toBeLessThan(140 - PRE_LEAD_SEC);
    for (let i = 1; i < plan.length; i++) {
      expect(plan[i]!.atSec).toBeGreaterThanOrEqual(plan[i - 1]!.atSec);
    }
  });

  it('shortens the lead on a short block and skips blocks too short to hold one', () => {
    const shortOne = buildCuePlan([seg(0, 0, 14), seg(1, 14, 30, { position: 'standing' })]);
    expect(shortOne[0]).toMatchObject({ atSec: 7, cue: { kind: 'pre', inSec: 7 } });
    const tiny = buildCuePlan([seg(0, 0, 5), seg(1, 5, 30, { position: 'standing' })]);
    expect(tiny.some((e) => e.cue.kind === 'pre')).toBe(false);
  });

  it('never places a pre-cue inside the previous block', () => {
    const segs = [seg(0, 0, 12), seg(1, 12, 12, { position: 'standing' })];
    for (const e of buildCuePlan(segs)) expect(e.atSec).toBeGreaterThanOrEqual(0);
    const pre = buildCuePlan(segs).find((e) => e.cue.kind === 'pre');
    expect(pre!.atSec).toBeGreaterThanOrEqual(0);
    expect(pre!.atSec).toBeGreaterThanOrEqual(6); // at least half the block remains announced
  });

  it('leaves authored cues and repeat reps alone', () => {
    const segs = [seg(0, 0, 60), seg(1, 60, 60, { cue: 'hello', position: 'standing' })];
    expect(buildCuePlan(segs).some((e) => e.cue.kind === 'pre')).toBe(false);
    const reps = [seg(0, 0, 60), seg(1, 60, 20, { rep: 2, reps: 3, position: 'standing' })];
    expect(buildCuePlan(reps).some((e) => e.cue.kind === 'pre')).toBe(false);
  });

  it('keeps one change at a time: entries are at least 5 s apart', () => {
    const segs = [
      seg(0, 0, 20),
      seg(1, 20, 20, { position: 'standing' }),
      seg(2, 40, 20, { position: 'seated', effortStart: 8, effortEnd: 8 }),
    ];
    const plan = buildCuePlan(segs);
    for (let i = 1; i < plan.length; i++) {
      expect(plan[i]!.atSec - plan[i - 1]!.atSec).toBeGreaterThanOrEqual(5);
    }
  });

  it('announces the closing silence before it starts', () => {
    const segs = [seg(0, 0, 200), seg(1, 200, 100)];
    const plan = buildCuePlan(segs, { silenceLastSec: 60 });
    const s = plan.find((e) => e.cue.kind === 'silenceAhead');
    expect(s).toMatchObject({ atSec: 300 - 60 - 10, cue: { inSec: 10 } });
    expect(buildCuePlan(segs).some((e) => e.cue.kind === 'silenceAhead')).toBe(false);
  });

  it('numericCadence false gives cadenceUp/Down pre-cues', () => {
    const segs = [seg(0, 0, 60, { rpm: 70 }), seg(1, 60, 60, { rpm: 100 })];
    expect(buildCuePlan(segs, { numericCadence: false })[0]?.cue).toMatchObject({
      kind: 'pre',
      change: 'cadenceUp',
    });
    expect(buildCuePlan(segs)[0]?.cue).toMatchObject({ kind: 'preCadence', rpm: 100 });
  });
});

describe('cuePlanAt', () => {
  const segs = [seg(0, 0, 60), seg(1, 60, 60, { position: 'standing' })];
  const plan = buildCuePlan(segs);

  it('is driven by the training clock: before, inside and after the window', () => {
    expect(cuePlanAt(plan, 49)).toBeNull();
    expect(cuePlanAt(plan, 50)?.cue.kind).toBe('pre');
    expect(cuePlanAt(plan, 51)?.cue.kind).toBe('pre');
    expect(cuePlanAt(plan, 55)).toBeNull(); // stale: a seek past it must not replay it
  });
});
