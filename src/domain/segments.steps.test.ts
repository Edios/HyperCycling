import { describe, expect, it } from 'vitest';
import { snapshotFits } from '../client/setup/model';
import { builtinWorkouts } from '../client/data/builtin';
import { effortToFtpPct } from './effort';
import { flattenWorkout, intensityAt, positionOf, stepAt, type Segment } from './segments';
import { DEFAULT_SETTINGS, resolveResistanceMode, settingsSchema } from './settings';
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

const rampBlock: Block = {
  kind: 'ramp',
  id: 'ramp',
  durationSec: 180,
  from: { ftpPct: 100 },
  to: { ftpPct: 125 },
};
const vo2 = wk([rampBlock]);

describe('flattenWorkout resistance modes', () => {
  it('knob turns a ramp into steps that never jump more than two effort levels', () => {
    const [seg] = flattenWorkout(vo2, undefined, 'knob');
    const steps = seg?.steps ?? [];
    expect(steps.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < steps.length; i++) {
      expect(Math.abs((steps[i]?.effort ?? 0) - (steps[i - 1]?.effort ?? 0))).toBeLessThanOrEqual(
        2,
      );
    }
    expect(stepAt(seg as Segment, 0).count).toBe(steps.length);
    expect(steps.reduce((s, x) => s + x.durationSec, 0)).toBe(180);
  });

  it('smart returns no steps and keeps the linear intensity', () => {
    const [seg] = flattenWorkout(vo2, undefined, 'smart');
    expect(seg?.steps).toBeUndefined();
    const at = (t: number): number => intensityAt(seg as Segment, t).ftpPct;
    expect([0, 45, 90, 135, 180].map(at)).toEqual([100, 106.25, 112.5, 118.75, 125]);
  });

  it('the default (no mode argument) is smart so existing callers do not change', () => {
    expect(flattenWorkout(vo2)[0]?.steps).toBeUndefined();
  });

  it('knobPower quantises in %FTP', () => {
    const [seg] = flattenWorkout(vo2, undefined, 'knobPower');
    expect(seg?.steps?.map((s) => s.ftpPct)).toEqual([100, 108, 117, 125]);
  });

  it('intensityAt returns the step value inside a stepped segment', () => {
    const [seg] = flattenWorkout(vo2, undefined, 'knob');
    const second = seg?.steps?.[1];
    expect(second).toBeDefined();
    const at = intensityAt(seg as Segment, (second?.offsetSec ?? 0) + 1);
    expect(at.effort).toBe(second?.effort);
    expect(at.ftpPct).toBe(second?.ftpPct);
    expect(at.ftpPct).toBe(effortToFtpPct(second?.effort ?? 1));
  });

  it('stepAt reports the index and the time to the next step; last step has null', () => {
    const [seg] = flattenWorkout(vo2, undefined, 'knob');
    const s = seg as Segment;
    const n = s.steps?.length ?? 0;
    const first = stepAt(s, 0);
    expect(first.index).toBe(0);
    expect(first.nextInSec).toBe(s.steps?.[1]?.offsetSec);
    const last = stepAt(s, 179.5);
    expect(last.index).toBe(n - 1);
    expect(last.nextInSec).toBeNull();
  });

  it('stepAt on a steady segment is one step with no next', () => {
    const [seg] = flattenWorkout(
      wk([{ kind: 'steady', id: 's', durationSec: 60, intensity: { effort: 5 } }]),
    );
    expect(stepAt(seg as Segment, 10)).toEqual({ index: 0, count: 1, nextInSec: null });
  });

  it('RampBlock.steps = 1 holds one step', () => {
    const [seg] = flattenWorkout(wk([{ ...rampBlock, steps: 1 } as Block]), undefined, 'knob');
    expect(seg?.steps).toHaveLength(1);
  });

  it('RampBlock.steps = 4 gives four steps', () => {
    const [seg] = flattenWorkout(wk([{ ...rampBlock, steps: 4 } as Block]), undefined, 'knobPower');
    expect(seg?.steps).toHaveLength(4);
  });

  it('short, zero-delta and descending ramps never give a zero-length step', () => {
    const w = wk([
      { kind: 'ramp', id: 'a', durationSec: 40, from: { effort: 3 }, to: { effort: 8 } },
      { kind: 'ramp', id: 'b', durationSec: 120, from: { effort: 5 }, to: { effort: 5 } },
      { kind: 'ramp', id: 'c', durationSec: 240, from: { effort: 8 }, to: { effort: 3 } },
    ]);
    const segs = flattenWorkout(w, undefined, 'knob');
    for (const s of segs) {
      expect(s.steps?.length).toBeGreaterThanOrEqual(1);
      expect(s.steps?.every((x) => x.durationSec > 0)).toBe(true);
      expect(s.steps?.reduce((t, x) => t + x.durationSec, 0)).toBe(s.durationSec);
    }
    expect(segs[0]?.steps).toHaveLength(1);
    expect(segs[2]?.steps?.map((x) => x.effort)).toEqual([8, 7, 6, 5, 4, 3]);
  });

  it('segment count and boundaries are identical in every mode for every built-in workout', () => {
    for (const w of builtinWorkouts) {
      const smart = flattenWorkout(w, undefined, 'smart');
      for (const mode of ['knob', 'knobPower'] as const) {
        const stepped = flattenWorkout(w, undefined, mode);
        expect(stepped.length, w.id).toBe(smart.length);
        expect(
          stepped.map((s) => [s.blockId, s.startSec, s.durationSec, s.rep]),
          w.id,
        ).toEqual(smart.map((s) => [s.blockId, s.startSec, s.durationSec, s.rep]));
        for (const s of stepped) {
          if (s.kind === 'steady') expect(s.steps, w.id).toBeUndefined();
        }
      }
    }
  });
});

describe('position is resolved at flatten time', () => {
  it('defaults to seated and keeps an explicit standing', () => {
    const segs = flattenWorkout(
      wk([
        { kind: 'steady', id: 'a', durationSec: 30, intensity: { effort: 4 } },
        {
          kind: 'steady',
          id: 'b',
          durationSec: 30,
          intensity: { effort: 7 },
          position: 'standing',
        },
      ]),
    );
    expect(segs.map((s) => s.position)).toEqual(['seated', 'standing']);
  });

  it('positionOf tolerates an old segment without position', () => {
    const old = { ...(flattenWorkout(vo2)[0] as Segment) };
    delete old.position;
    expect(positionOf(old)).toBe('seated');
  });
});

describe('resistanceMode setting', () => {
  it('fresh profiles default to knob', () => {
    expect(DEFAULT_SETTINGS.resistanceMode).toBe('knob');
  });

  it('a stored settings object without the field resolves to smart', () => {
    const stored = { ...DEFAULT_SETTINGS };
    delete stored.resistanceMode;
    expect(resolveResistanceMode(stored)).toBe('smart');
    expect(settingsSchema.safeParse(stored).success).toBe(true);
  });

  it('an unknown stored value falls back to smart and does not fail parsing', () => {
    const parsed = settingsSchema.safeParse({ ...DEFAULT_SETTINGS, resistanceMode: 'turbo' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && resolveResistanceMode(parsed.data)).toBe('smart');
  });
});

describe('resume safety (Review Focus 2)', () => {
  it('a snapshot saved before the update still fits the stepped segments at the same index', () => {
    const w = builtinWorkouts.find((x) => x.blocks.some((b) => b.kind === 'ramp')) ?? vo2;
    const old = flattenWorkout(w, undefined, 'smart');
    const idx = Math.min(1, old.length - 1);
    const snap = { segmentIndex: idx, workoutElapsedSec: (old[idx]?.startSec ?? 0) + 5 };
    expect(snapshotFits(old, snap)).toBe(true);
    for (const mode of ['knob', 'knobPower'] as const) {
      const neu = flattenWorkout(w, undefined, mode);
      expect(neu.length).toBe(old.length);
      expect(snapshotFits(neu, snap)).toBe(true);
    }
  });
});
