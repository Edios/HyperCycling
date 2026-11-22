import { beforeEach, describe, expect, it, vi } from 'vitest';
import raw from '../../content/soundtrack/catalog.json';
import { parseCatalog } from '../../domain/soundtrack-catalog';
import { planSoundtrack } from '../../domain/soundtrack-plan';
import { planRecord, type SoundtrackPlanRecord } from '../../domain/soundtrack-store';
import { FIRST_VISIT_PREFS } from '../../domain/soundtrack-wizard';

const db = vi.hoisted(() => ({
  records: new Map<string, unknown>(),
  fail: false,
  gets: 0,
}));
vi.mock('../data/repositories', () => ({
  getRepositories: () =>
    db.fail
      ? Promise.reject(new Error('storage is gone'))
      : Promise.resolve({
          soundtrackPlans: {
            get: (id: string) => {
              db.gets++;
              return Promise.resolve(db.records.get(id));
            },
            put: (r: { id: string }) => {
              db.records.set(r.id, r);
              return Promise.resolve();
            },
            remove: (id: string) => {
              db.records.delete(id);
              return Promise.resolve();
            },
          },
        }),
}));

import { builtinWorkouts } from '../data/builtin';
import {
  confirmPlan,
  forgetPlan,
  loadSavedPlan,
  resetSoundtrackSessionForTests,
  useSoundtrackSession,
} from './session';

const catalog = parseCatalog(raw).tracks;
const workout = builtinWorkouts.find((w) => w.id === 'class-endurance-45')!;
const plan = planSoundtrack(workout, catalog, FIRST_VISIT_PREFS);
const other = planSoundtrack(workout, catalog, { ...FIRST_VISIT_PREFS, seed: 9 });
const NOW = new Date('2026-11-23T11:00:00.000Z');

const plans = () => useSoundtrackSession.getState().plans;

beforeEach(() => {
  db.records.clear();
  db.fail = false;
  db.gets = 0;
  resetSoundtrackSessionForTests();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('confirmPlan', () => {
  it('takes the plan over at once and writes a record stamped with the time', async () => {
    const saved = await confirmPlan(plan, NOW);
    expect(saved).toBe(true);
    expect(plans()[workout.id]).toBe(plan);
    const rec = db.records.get(workout.id) as SoundtrackPlanRecord;
    expect(rec).toEqual(planRecord(plan, NOW));
    expect(rec.createdAt).toBe('2026-11-23T11:00:00.000Z');
    expect(useSoundtrackSession.getState().saveFailed).toBe(false);
  });

  it('replaces the earlier plan of the workout', async () => {
    await confirmPlan(plan, NOW);
    await confirmPlan(other, new Date('2026-11-24T08:00:00.000Z'));
    expect(db.records.size).toBe(1);
    expect((db.records.get(workout.id) as SoundtrackPlanRecord).plan).toEqual(other);
    expect(plans()[workout.id]).toBe(other);
  });

  it('keeps the plan for this visit and says so when the write fails', async () => {
    db.fail = true;
    expect(await confirmPlan(plan, NOW)).toBe(false);
    expect(plans()[workout.id]).toBe(plan);
    expect(useSoundtrackSession.getState().saveFailed).toBe(true);
    db.fail = false;
    expect(await confirmPlan(plan, NOW)).toBe(true);
    expect(useSoundtrackSession.getState().saveFailed).toBe(false);
  });
});

describe('loadSavedPlan', () => {
  it('puts the saved plan in the session, once per visit', async () => {
    db.records.set(workout.id, planRecord(plan, NOW));
    await loadSavedPlan(workout.id);
    expect(plans()[workout.id]).toEqual(plan);
    await loadSavedPlan(workout.id);
    expect(db.gets).toBe(1);
  });

  it('does nothing for a workout with no saved plan', async () => {
    await loadSavedPlan(workout.id);
    expect(plans()).toEqual({});
    expect(useSoundtrackSession.getState().loaded[workout.id]).toBe(true);
  });

  it('never overwrites a plan the rider made in this visit', async () => {
    db.records.set(workout.id, planRecord(plan, NOW));
    const slow = loadSavedPlan(workout.id);
    useSoundtrackSession.getState().setPlan(workout.id, other); // made while the read was on its way
    await slow;
    expect(plans()[workout.id]).toBe(other);
  });

  it('is not an error when the storage fails: the workout has no music matched', async () => {
    db.fail = true;
    await expect(loadSavedPlan(workout.id)).resolves.toBeUndefined();
    expect(plans()).toEqual({});
  });

  it('does not bring back a plan the rider removed', async () => {
    await confirmPlan(plan, NOW);
    await forgetPlan(workout.id);
    await loadSavedPlan(workout.id);
    expect(plans()).toEqual({});
  });
});

describe('forgetPlan', () => {
  it('removes the plan from memory and from the device', async () => {
    await confirmPlan(plan, NOW);
    expect(await forgetPlan(workout.id)).toBe(true);
    expect(plans()).toEqual({});
    expect(db.records.size).toBe(0);
  });

  it('forgets it in memory even when the device cannot be reached', async () => {
    await confirmPlan(plan, NOW);
    db.fail = true;
    expect(await forgetPlan(workout.id)).toBe(false);
    expect(plans()).toEqual({});
  });
});
