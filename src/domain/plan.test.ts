import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLAN_SETTINGS,
  canCountFreestyle,
  nextSession,
  optionalExtraSlot,
  planProgressSchema,
  planProgressSchemaFor,
  planSchema,
  planSettingsSchema,
  recordEntry,
  suggestCountTowardPlan,
  weekStatus,
  weeklyLoad,
  type Plan,
  type PlanProgress,
  type PlanSettings,
  type ProgressEntry,
} from './plan';
import type { Block, Workout } from './workout';

function plan(over: Partial<Plan> = {}): Plan {
  return {
    id: 'p',
    name: 'Plan',
    description: '',
    level: 'any',
    loop: false,
    weeks: [
      {
        light: false,
        sessions: [
          { slot: 'progres', workoutId: 'w1p' },
          { slot: 'freestyle', workoutId: 'w1f' },
        ],
        progresAlt: 'w1alt',
      },
      {
        light: true,
        sessions: [
          { slot: 'progres', workoutId: 'w2p' },
          { slot: 'freestyle', workoutId: 'w2f' },
        ],
      },
    ],
    ...over,
  };
}

function progress(
  settings: Partial<PlanSettings> = {},
  entries: ProgressEntry[] = [],
): PlanProgress {
  return {
    id: 'p',
    planId: 'p',
    startedAt: '2026-01-01T00:00:00.000Z',
    settings: { ...DEFAULT_PLAN_SETTINGS, ...settings },
    entries,
  };
}

function entry(
  week: number,
  slot: 'progres' | 'freestyle',
  status: 'done' | 'skipped' = 'done',
  cycle?: number,
): ProgressEntry {
  const e: ProgressEntry = { week, slot, workoutId: 'x', status, at: '2026-01-02T00:00:00.000Z' };
  if (cycle !== undefined) e.cycle = cycle;
  return e;
}

const bothWeeksDone = [1, 2].flatMap((w) => [entry(w, 'progres'), entry(w, 'freestyle')]);

describe('nextSession', () => {
  it('empty progress suggests week 1 progres', () => {
    expect(nextSession(plan(), progress())).toEqual({
      week: 1,
      slot: 'progres',
      workoutId: 'w1p',
      cycle: 1,
    });
  });
  it('after progres done suggests freestyle', () => {
    expect(nextSession(plan(), progress({}, [entry(1, 'progres')]))).toMatchObject({
      week: 1,
      slot: 'freestyle',
      workoutId: 'w1f',
    });
  });
  it('freestyle done first still suggests progres', () => {
    expect(nextSession(plan(), progress({}, [entry(1, 'freestyle')]))).toMatchObject({
      week: 1,
      slot: 'progres',
    });
  });
  it('both closed moves to week 2', () => {
    const p = progress({}, [entry(1, 'progres'), entry(1, 'freestyle')]);
    expect(nextSession(plan(), p)).toMatchObject({ week: 2, slot: 'progres', workoutId: 'w2p' });
  });
  it('skipped counts as closed', () => {
    const p = progress({}, [entry(1, 'progres', 'skipped'), entry(1, 'freestyle', 'skipped')]);
    expect(nextSession(plan(), p)).toMatchObject({ week: 2 });
  });
  it('finished plan returns null', () => {
    expect(nextSession(plan(), progress({}, bothWeeksDone))).toBeNull();
  });
  it('weeks before startWeek are skipped without entries', () => {
    expect(nextSession(plan(), progress({ startWeek: 2 }))).toMatchObject({ week: 2 });
  });
  it('doubleProgres serves the freestyle slot with progresAlt', () => {
    const p = progress({ layout: 'doubleProgres' }, [entry(1, 'progres')]);
    expect(nextSession(plan(), p)).toMatchObject({ slot: 'freestyle', workoutId: 'w1alt' });
  });
  it('doubleProgres falls back to the week progres without progresAlt', () => {
    const p = progress({ layout: 'doubleProgres' }, [
      entry(1, 'progres'),
      entry(1, 'freestyle'),
      entry(2, 'progres'),
    ]);
    expect(nextSession(plan(), p)).toMatchObject({
      week: 2,
      slot: 'freestyle',
      workoutId: 'w2p',
    });
  });
  it('week without a freestyle session has only the progres slot open', () => {
    const pl = plan({
      weeks: [{ light: false, sessions: [{ slot: 'progres', workoutId: 'a' }] }],
    });
    expect(weekStatus(pl, progress(), 1)).toEqual({ progres: 'open', freestyle: 'skipped' });
    expect(nextSession(pl, progress({}, [entry(1, 'progres')]))).toBeNull();
  });
  it('week without a progres session has only freestyle open', () => {
    const pl = plan({
      weeks: [{ light: false, sessions: [{ slot: 'freestyle', workoutId: 'f' }] }],
    });
    expect(nextSession(pl, progress())).toMatchObject({ slot: 'freestyle', workoutId: 'f' });
  });
  it('loop plan restarts at week 1 of the next cycle', () => {
    const pl = plan({ loop: true });
    const next = nextSession(pl, progress({}, bothWeeksDone));
    expect(next).toEqual({ week: 1, slot: 'progres', workoutId: 'w1p', cycle: 2 });
    const rec = recordEntry(progress({}, bothWeeksDone), { ...entry(1, 'progres'), cycle: 2 });
    expect(nextSession(pl, rec)).toMatchObject({ week: 1, slot: 'freestyle', cycle: 2 });
    expect(weekStatus(pl, rec, 1)).toEqual({ progres: 'done', freestyle: 'open' });
  });
  it('startWeek applies only to the first cycle', () => {
    const pl = plan({ loop: true });
    const e = [entry(2, 'progres'), entry(2, 'freestyle')];
    expect(nextSession(pl, progress({ startWeek: 2 }, e))).toMatchObject({ week: 1, cycle: 2 });
  });
});

describe('recordEntry', () => {
  it('replaces the entry for the same week and slot without mutating', () => {
    const p = progress({}, [entry(1, 'progres', 'skipped')]);
    const next = recordEntry(p, entry(1, 'progres', 'done'));
    expect(next.entries).toHaveLength(1);
    expect(next.entries[0]?.status).toBe('done');
    expect(p.entries[0]?.status).toBe('skipped');
    expect(next).not.toBe(p);
  });
  it('keeps entries of other slots and cycles', () => {
    const p = progress({}, [entry(1, 'freestyle'), entry(1, 'progres', 'done', 1)]);
    const next = recordEntry(p, { ...entry(1, 'progres'), cycle: 2 });
    expect(next.entries).toHaveLength(3);
  });
});

describe('canCountFreestyle', () => {
  it('returns the current week when its freestyle slot is open', () => {
    expect(canCountFreestyle(plan(), progress())).toEqual({ week: 1 });
    expect(canCountFreestyle(plan(), progress({}, [entry(1, 'progres')]))).toEqual({ week: 1 });
  });
  it('returns null when freestyle is closed, plan finished, or layout has no freestyle', () => {
    expect(canCountFreestyle(plan(), progress({}, [entry(1, 'freestyle')]))).toBeNull();
    expect(canCountFreestyle(plan(), progress({}, bothWeeksDone))).toBeNull();
    expect(canCountFreestyle(plan(), progress({ layout: 'doubleProgres' }))).toBeNull();
  });
  it('works in plusFreestyle layout', () => {
    expect(canCountFreestyle(plan(), progress({ layout: 'plusFreestyle' }))).toEqual({ week: 1 });
  });
});

describe('weekStatus / optionalExtraSlot', () => {
  it('reports open, done and skipped', () => {
    const p = progress({}, [entry(1, 'progres'), entry(1, 'freestyle', 'skipped')]);
    expect(weekStatus(plan(), p, 1)).toEqual({ progres: 'done', freestyle: 'skipped' });
    expect(weekStatus(plan(), p, 2)).toEqual({ progres: 'open', freestyle: 'open' });
  });
  it('weeks before startWeek are skipped', () => {
    expect(weekStatus(plan(), progress({ startWeek: 2 }), 1)).toEqual({
      progres: 'skipped',
      freestyle: 'skipped',
    });
  });
  it('plusFreestyle has a non-blocking extra slot', () => {
    expect(optionalExtraSlot(plan(), progress({ layout: 'plusFreestyle' }))).toBe(true);
    expect(optionalExtraSlot(plan(), progress())).toBe(false);
  });
});

describe('suggestCountTowardPlan', () => {
  it('requires at least 80 percent', () => {
    expect(suggestCountTowardPlan(2160, 2700)).toBe(true);
    expect(suggestCountTowardPlan(2000, 2700)).toBe(false);
    expect(suggestCountTowardPlan(10, 0)).toBe(false);
  });
});

function wk(id: string, blocks: Block[]): Workout {
  return {
    id,
    name: id,
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

describe('weeklyLoad', () => {
  it('sums minutes at or above 85 percent, using ramp averages', () => {
    const workouts: Record<string, Workout> = {
      w1p: wk('w1p', [
        { kind: 'steady', id: 'a', durationSec: 600, intensity: { ftpPct: 60 } },
        { kind: 'steady', id: 'b', durationSec: 300, intensity: { effort: 6 } },
        { kind: 'ramp', id: 'c', durationSec: 100, from: { ftpPct: 70 }, to: { ftpPct: 100 } },
      ]),
      w1f: wk('w1f', [{ kind: 'steady', id: 'd', durationSec: 100, intensity: { ftpPct: 90 } }]),
      w2p: wk('w2p', [{ kind: 'steady', id: 'e', durationSec: 600, intensity: { ftpPct: 50 } }]),
      w2f: wk('w2f', [{ kind: 'steady', id: 'f', durationSec: 1000, intensity: { ftpPct: 120 } }]),
    };
    // week 1: 300 (85 exactly) + 100 (ramp avg 85) + 100 = 500 s = 8.3 min
    expect(weeklyLoad(plan(), (id) => workouts[id] as Workout)).toEqual([8.3, 16.7]);
  });
});

describe('schemas', () => {
  it('accepts a valid plan and rejects bad ones', () => {
    expect(planSchema.safeParse(plan()).success).toBe(true);
    expect(planSchema.safeParse(plan({ weeks: [] })).success).toBe(false);
    expect(planSchema.safeParse(plan({ level: 'pro' as never })).success).toBe(false);
    const withLoc = plan({ localized: { pl: { name: 'a', description: 'b' } } });
    expect(planSchema.safeParse(withLoc).success).toBe(true);
  });
  it('validates settings', () => {
    const d = DEFAULT_PLAN_SETTINGS;
    expect(planSettingsSchema.safeParse(d).success).toBe(true);
    expect(planSettingsSchema.safeParse({ ...d, sessionMinutes: 50 }).success).toBe(false);
    expect(planSettingsSchema.safeParse({ ...d, difficulty: 3 }).success).toBe(false);
    expect(planSettingsSchema.safeParse({ ...d, layout: 'x' }).success).toBe(false);
    expect(planSettingsSchema.safeParse({ ...d, startWeek: 0 }).success).toBe(false);
    expect(planSettingsSchema.safeParse({ ...d, startWeek: 1.5 }).success).toBe(false);
  });
  it('validates progress, and startWeek and entries against the plan length', () => {
    expect(planProgressSchema.safeParse(progress()).success).toBe(true);
    expect(planProgressSchema.safeParse({ ...progress(), entries: [{ week: 0 }] }).success).toBe(
      false,
    );
    const schema = planProgressSchemaFor(plan());
    expect(schema.safeParse(progress({ startWeek: 2 })).success).toBe(true);
    expect(schema.safeParse(progress({ startWeek: 3 })).success).toBe(false);
    expect(schema.safeParse(progress({}, [entry(3, 'progres')])).success).toBe(false);
  });
});
