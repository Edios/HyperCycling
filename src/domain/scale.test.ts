import { describe, expect, it } from 'vitest';
import { scaleWorkout } from './scale';
import {
  totalDurationSec,
  workoutSchema,
  type Block,
  type RepeatBlock,
  type Workout,
  type WorkoutScaling,
} from './workout';

function wk(blocks: Block[], scaling?: WorkoutScaling): Workout {
  const w: Workout = {
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
  if (scaling) w.scaling = scaling;
  return w;
}

function fixture(scaling: Partial<WorkoutScaling> = {}): Workout {
  return wk(
    [
      { kind: 'steady', id: 'wu', durationSec: 600, intensity: { ftpPct: 60 } },
      {
        kind: 'repeat',
        id: 'main',
        times: 6,
        blocks: [
          { kind: 'steady', id: 'hard', durationSec: 180, intensity: { ftpPct: 92 } },
          { kind: 'steady', id: 'easy', durationSec: 120, intensity: { ftpPct: 55 } },
        ],
      },
      { kind: 'steady', id: 'cd', durationSec: 300, intensity: { ftpPct: 50 } },
    ],
    {
      warmupBlockId: 'wu',
      cooldownBlockId: 'cd',
      flexRepeatId: 'main',
      minTimes: 3,
      maxTimes: 8,
      ...scaling,
    },
  );
}

function times(w: Workout): number {
  const r = w.blocks.find((b): b is RepeatBlock => b.kind === 'repeat');
  return r?.times ?? 0;
}
function dur(w: Workout, id: string): number {
  const b = w.blocks.find((x) => x.id === id);
  return b && b.kind !== 'repeat' ? b.durationSec : -1;
}

describe('scaleWorkout durations', () => {
  it('45 -> 30 removes reps down to minTimes', () => {
    const out = scaleWorkout(fixture(), { targetMinutes: 30, difficultyPct: 0 });
    expect(times(out)).toBe(3);
    expect(totalDurationSec(out)).toBe(1800);
    expect(dur(out, 'wu')).toBe(600);
  });
  it('never goes below minTimes, then shrinks warm-up and cool-down', () => {
    const out = scaleWorkout(fixture({ minTimes: 5 }), { targetMinutes: 30, difficultyPct: 0 });
    expect(times(out)).toBe(5);
    expect(dur(out, 'wu')).toBe(300);
    expect(dur(out, 'cd')).toBe(180);
    expect(totalDurationSec(out)).toBe(1980);
  });
  it('45 -> 60 adds reps up to maxTimes', () => {
    const out = scaleWorkout(fixture(), { targetMinutes: 60, difficultyPct: 0 });
    expect(times(out)).toBe(8);
    expect(dur(out, 'wu')).toBe(900);
    expect(totalDurationSec(out)).toBe(3600);
  });
  it('lengthens warm-up first, then cool-down, once reps are maxed', () => {
    const out = scaleWorkout(fixture({ maxTimes: 7 }), { targetMinutes: 60, difficultyPct: 0 });
    expect(times(out)).toBe(7);
    expect(dur(out, 'wu')).toBe(900);
    expect(dur(out, 'cd')).toBe(600);
    expect(totalDurationSec(out)).toBe(3600);
  });
  it('caps warm-up and cool-down at their maximum', () => {
    const out = scaleWorkout(fixture({ maxTimes: 6 }), { targetMinutes: 60, difficultyPct: 0 });
    expect(dur(out, 'wu')).toBe(900);
    expect(dur(out, 'cd')).toBe(600);
    expect(totalDurationSec(out)).toBe(3300);
  });
  it('picks the closest rep count when an exact fit is impossible', () => {
    const w = fixture();
    const first = w.blocks[0];
    if (first?.kind === 'steady') first.durationSec = 590; // 590 + 300k + 300 never hits 2700
    const out = scaleWorkout(w, { targetMinutes: 45, difficultyPct: 0 });
    expect(Math.abs(totalDurationSec(out) - 2700)).toBeLessThanOrEqual(15);
  });
  it('uses the repeat as-is when flex bounds are omitted (min 2, max current)', () => {
    const out = scaleWorkout(fixture({ minTimes: undefined, maxTimes: undefined }), {
      targetMinutes: 30,
      difficultyPct: 0,
    });
    expect(times(out)).toBe(3);
    const grown = scaleWorkout(fixture({ minTimes: undefined, maxTimes: undefined }), {
      targetMinutes: 60,
      difficultyPct: 0,
    });
    expect(times(grown)).toBe(6);
  });
  it('works without a flex repeat', () => {
    const w = fixture();
    delete w.scaling?.flexRepeatId;
    const out = scaleWorkout(w, { targetMinutes: 30, difficultyPct: 0 });
    expect(times(out)).toBe(6);
    expect(dur(out, 'wu')).toBe(300);
    expect(dur(out, 'cd')).toBe(180);
  });
  it('does not shrink a warm-up that is already shorter than the minimum', () => {
    const w = fixture({ minTimes: 6 });
    const first = w.blocks[0];
    if (first?.kind === 'steady') first.durationSec = 240;
    const out = scaleWorkout(w, { targetMinutes: 30, difficultyPct: 0 });
    expect(dur(out, 'wu')).toBe(240);
  });
  it('stretches a ramp warm-up', () => {
    const w = fixture();
    w.blocks[0] = {
      kind: 'ramp',
      id: 'wu',
      durationSec: 600,
      from: { ftpPct: 45 },
      to: { ftpPct: 70 },
    };
    const out = scaleWorkout(w, { targetMinutes: 60, difficultyPct: 0 });
    expect(dur(out, 'wu')).toBe(900);
  });
  it('drops music cues that point past the new rep count', () => {
    const w = fixture();
    const track = { provider: 'youtube' as const, id: 'a', title: 't', startAtSec: 0 };
    w.musicCues = [
      { blockId: 'hard', rep: 2, track },
      { blockId: 'hard', rep: 6, track },
    ];
    const out = scaleWorkout(w, { targetMinutes: 30, difficultyPct: 0 });
    expect(out.musicCues.map((c) => c.rep)).toEqual([2]);
    expect(workoutSchema.safeParse(out).success).toBe(true);
  });
});

describe('scaleWorkout difficulty', () => {
  it('+5 percent turns 92 into 97 and leaves warm-up and cool-down alone', () => {
    const out = scaleWorkout(fixture(), { targetMinutes: 45, difficultyPct: 5 });
    const main = out.blocks[1] as RepeatBlock;
    expect(main.blocks[0]).toMatchObject({ intensity: { ftpPct: 97 } });
    expect(main.blocks[1]).toMatchObject({ intensity: { ftpPct: 58 } });
    expect(out.blocks[0]).toMatchObject({ intensity: { ftpPct: 60 } });
    expect(out.blocks[2]).toMatchObject({ intensity: { ftpPct: 50 } });
  });
  it('-5 percent lowers intensity', () => {
    const out = scaleWorkout(fixture(), { targetMinutes: 45, difficultyPct: -5 });
    expect((out.blocks[1] as RepeatBlock).blocks[0]).toMatchObject({ intensity: { ftpPct: 87 } });
  });
  it('converts effort-only intensities via the default table and stores ftpPct', () => {
    const w = fixture();
    (w.blocks[1] as RepeatBlock).blocks[0] = {
      kind: 'steady',
      id: 'hard',
      durationSec: 180,
      intensity: { effort: 8 },
    };
    const out = scaleWorkout(w, { targetMinutes: 45, difficultyPct: 5 });
    const scaled = (out.blocks[1] as RepeatBlock).blocks[0];
    expect(scaled).toMatchObject({ intensity: { ftpPct: 105 } });
    expect(scaled && 'intensity' in scaled && scaled.intensity.effort).toBeUndefined();
  });
  it('ftpPct wins over effort when both are present', () => {
    const w = fixture();
    (w.blocks[1] as RepeatBlock).blocks[0] = {
      kind: 'steady',
      id: 'hard',
      durationSec: 180,
      intensity: { effort: 5, ftpPct: 100 },
    };
    const out = scaleWorkout(w, { targetMinutes: 45, difficultyPct: 5 });
    expect((out.blocks[1] as RepeatBlock).blocks[0]).toMatchObject({ intensity: { ftpPct: 105 } });
  });
  it('scales ramps on both ends and clamps to the schema range', () => {
    const w = fixture();
    (w.blocks[1] as RepeatBlock).blocks[0] = {
      kind: 'ramp',
      id: 'hard',
      durationSec: 180,
      from: { effort: 5 },
      to: { ftpPct: 198 },
    };
    const out = scaleWorkout(w, { targetMinutes: 45, difficultyPct: 5 });
    expect((out.blocks[1] as RepeatBlock).blocks[0]).toMatchObject({
      from: { ftpPct: 82 },
      to: { ftpPct: 200 },
    });
  });
  it('zero difficulty and matching target return an equal workout', () => {
    const w = fixture();
    expect(scaleWorkout(w, { targetMinutes: 45, difficultyPct: 0 })).toEqual(w);
  });
  it('without scaling only difficulty is applied, to every block', () => {
    const w = wk([
      { kind: 'steady', id: 'a', durationSec: 600, intensity: { ftpPct: 60 } },
      { kind: 'steady', id: 'b', durationSec: 600, intensity: { ftpPct: 92 } },
    ]);
    const out = scaleWorkout(w, { targetMinutes: 30, difficultyPct: 5 });
    expect(out.blocks.map((b) => (b.kind === 'steady' ? b.intensity.ftpPct : -1))).toEqual([
      63, 97,
    ]);
    expect(totalDurationSec(out)).toBe(1200);
    expect(out.scaling).toBeUndefined();
  });
  it('does not mutate its input', () => {
    const w = fixture();
    const snapshot = structuredClone(w);
    const out = scaleWorkout(w, { targetMinutes: 30, difficultyPct: 5 });
    expect(w).toEqual(snapshot);
    expect(out).not.toBe(w);
  });
});

describe('workout scaling schema', () => {
  it('accepts a valid scaling block', () => {
    expect(workoutSchema.safeParse(fixture()).success).toBe(true);
  });
  it('rejects unknown ids, non-repeat flex id, and inverted bounds', () => {
    expect(workoutSchema.safeParse(fixture({ warmupBlockId: 'nope' })).success).toBe(false);
    expect(workoutSchema.safeParse(fixture({ cooldownBlockId: 'main' })).success).toBe(false);
    expect(workoutSchema.safeParse(fixture({ flexRepeatId: 'wu' })).success).toBe(false);
    expect(workoutSchema.safeParse(fixture({ minTimes: 9, maxTimes: 4 })).success).toBe(false);
  });
});
