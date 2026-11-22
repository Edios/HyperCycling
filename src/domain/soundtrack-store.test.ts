import { describe, expect, it } from 'vitest';
import raw from '../content/soundtrack/catalog.json';
import { builtinWorkouts } from '../client/data/builtin';
import { parseExportBundleObject } from './export-bundle';
import { parseCatalog } from './soundtrack-catalog';
import { planSoundtrack } from './soundtrack-plan';
import {
  planRecord,
  soundtrackPlanRecordSchema,
  soundtrackPlanSchema,
  SOUNDTRACK_RECORD_VERSION,
} from './soundtrack-store';
import { FIRST_VISIT_PREFS } from './soundtrack-wizard';

const catalog = parseCatalog(raw).tracks;
const workout = builtinWorkouts.find((w) => w.id === 'class-endurance-45')!;
const plan = planSoundtrack(workout, catalog, FIRST_VISIT_PREFS);
const NOW = new Date('2026-11-23T10:30:00.000Z');

describe('planRecord', () => {
  it('is one record per workout, stamped with the time of the confirmation', () => {
    const rec = planRecord(plan, NOW);
    expect(rec).toEqual({
      id: 'class-endurance-45',
      schemaVersion: SOUNDTRACK_RECORD_VERSION,
      createdAt: '2026-11-23T10:30:00.000Z',
      plan,
    });
    expect(plan).not.toHaveProperty('createdAt'); // the planner has no clock
  });
});

describe('soundtrackPlanRecordSchema', () => {
  it('accepts what the planner makes, for every built-in workout', () => {
    for (const w of builtinWorkouts) {
      const p = planSoundtrack(w, catalog, FIRST_VISIT_PREFS);
      const r = soundtrackPlanRecordSchema.safeParse(planRecord(p, NOW));
      expect(r.success, `${w.id}: ${r.success ? '' : r.error.issues[0]?.path.join('.')}`).toBe(
        true,
      );
    }
  });

  it('returns the record as it was written (nothing added or dropped)', () => {
    const rec = planRecord(plan, NOW);
    expect(soundtrackPlanRecordSchema.parse(JSON.parse(JSON.stringify(rec)))).toEqual(rec);
  });

  it('refuses another version, a plan of another workout and a bad time', () => {
    const rec = planRecord(plan, NOW);
    expect(soundtrackPlanRecordSchema.safeParse({ ...rec, schemaVersion: 2 }).success).toBe(false);
    expect(soundtrackPlanRecordSchema.safeParse({ ...rec, id: 'other' }).success).toBe(false);
    expect(soundtrackPlanRecordSchema.safeParse({ ...rec, createdAt: 'yesterday' }).success).toBe(
      false,
    );
  });

  it('refuses a plan that is not valid: bad upload id, too many songs, unknown fit', () => {
    const bad = (mutate: (p: ReturnType<typeof structuredClone<typeof plan>>) => void) => {
      const p = structuredClone(plan);
      mutate(p);
      return soundtrackPlanSchema.safeParse(p).success;
    };
    expect(bad(() => undefined)).toBe(true);
    expect(bad((p) => (p.sections[0]!.picks[0]!.upload = 'short'))).toBe(false);
    expect(bad((p) => (p.sections[0]!.picks[0]!.fit = 'loud' as never))).toBe(false);
    expect(bad((p) => (p.fingerprint = 'XYZ'))).toBe(false);
    expect(
      bad((p) => {
        const pick = p.sections[0]!.picks[0]!;
        p.sections[0]!.picks = Array.from({ length: 14 }, () => pick);
      }),
    ).toBe(false);
    expect(bad((p) => (p.prefs.continuity = 'always' as never))).toBe(false);
    expect(bad((p) => (p.prefs.categories = ['jazz' as never]))).toBe(false);
    expect(bad((p) => (p.sections[0]!.durationSec = -1))).toBe(false);
  });
});

describe('the export bundle with music plans', () => {
  const base = {
    app: 'hypercycling',
    schemaVersion: 1,
    exportedAt: '2026-11-23T10:30:00.000Z',
    workouts: [],
    players: [],
    planProgress: [],
    sessionLogs: [],
    settings: null,
  };

  it('accepts a backup of an older build (no plans) and one with plans', () => {
    expect(parseExportBundleObject(base).ok).toBe(true);
    const withPlans = parseExportBundleObject({
      ...base,
      soundtrackPlans: [planRecord(plan, NOW)],
    });
    expect(withPlans.ok).toBe(true);
    if (withPlans.ok) expect(withPlans.bundle.soundtrackPlans).toEqual([planRecord(plan, NOW)]);
  });

  it('refuses a broken plan and the same workout twice', () => {
    const broken = { ...planRecord(plan, NOW), schemaVersion: 9 };
    expect(parseExportBundleObject({ ...base, soundtrackPlans: [broken] }).ok).toBe(false);
    const twice = parseExportBundleObject({
      ...base,
      soundtrackPlans: [planRecord(plan, NOW), planRecord(plan, NOW)],
    });
    expect(twice).toMatchObject({ ok: false, reason: 'invalid' });
  });
});
