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
import { loadSoundtrackHistory, SOUNDTRACK_HISTORY_KEY } from './history';
import {
  confirmPlan,
  drawNewOrder,
  forgetPlan,
  loadSavedPlan,
  replaySavedOrder,
  saveSongOrder,
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
  localStorage.removeItem(SOUNDTRACK_HISTORY_KEY);
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

  it('makes its songs the newest ride of the history (the next plans rotate away from them)', async () => {
    await confirmPlan(plan, NOW);
    const rides = loadSoundtrackHistory();
    expect(rides).toHaveLength(1);
    expect(rides[0]).toEqual({
      at: '2026-11-23T11:00:00.000Z',
      workoutId: workout.id,
      ids: plan.sections.flatMap((s) => s.picks.map((p) => p.ref.id)),
    });
    // The history is a device choice: also kept when the plan store fails.
    localStorage.removeItem(SOUNDTRACK_HISTORY_KEY);
    db.fail = true;
    await confirmPlan(other, NOW);
    expect(loadSoundtrackHistory()[0]?.ids).toEqual(
      other.sections.flatMap((s) => s.picks.map((p) => p.ref.id)),
    );
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

describe('the song order of the next ride (play the last one again, or draw a new one)', () => {
  const ids = (p: { sections: { picks: { ref: { id: string } }[] }[] }) =>
    p.sections.flatMap((s) => s.picks.map((x) => x.ref.id));
  const drawn = () => useSoundtrackSession.getState().drawn;

  it('draws a new order in memory only: the saved plan and its record stay', async () => {
    await confirmPlan(plan, NOW);
    expect(drawNewOrder(workout, catalog)).toBe(true);
    const fresh = plans()[workout.id]!;
    expect(fresh).not.toBe(plan);
    expect(fresh.prefs.seed).not.toBe(plan.prefs.seed);
    // The same choices (kinds of music, continuity), another order of songs.
    expect({ ...fresh.prefs, seed: 0 }).toEqual({ ...plan.prefs, seed: 0 });
    expect(ids(fresh)).not.toEqual(ids(plan));
    expect(drawn()[workout.id]).toBe(true);
    expect((db.records.get(workout.id) as SoundtrackPlanRecord).plan).toEqual(plan);
    expect(useSoundtrackSession.getState().saved[workout.id]).toBe(plan);
  });

  it('does nothing for a workout with no matched music', () => {
    expect(drawNewOrder(workout, catalog)).toBe(false);
    expect(plans()).toEqual({});
  });

  it('plays the saved order again', async () => {
    await confirmPlan(plan, NOW);
    drawNewOrder(workout, catalog);
    replaySavedOrder(workout.id);
    expect(plans()[workout.id]).toBe(plan);
    expect(drawn()[workout.id]).toBeUndefined();
  });

  it('a saved plan read from the device can be played again after a draw', async () => {
    db.records.set(workout.id, planRecord(plan, NOW));
    await loadSavedPlan(workout.id);
    drawNewOrder(workout, catalog);
    replaySavedOrder(workout.id);
    expect(plans()[workout.id]).toEqual(plan);
  });

  it('after the ride, saves the drawn order as the order of the workout', async () => {
    await confirmPlan(plan, NOW);
    drawNewOrder(workout, catalog);
    const fresh = plans()[workout.id]!;
    expect(await saveSongOrder(workout.id, NOW)).toBe(true);
    expect((db.records.get(workout.id) as SoundtrackPlanRecord).plan).toEqual(fresh);
    expect(useSoundtrackSession.getState().saved[workout.id]).toBe(fresh);
    expect(drawn()[workout.id]).toBeUndefined();
    // Nothing drawn: nothing to save.
    expect(await saveSongOrder('no-such-workout', NOW)).toBe(false);
  });

  it('forgetting the plan forgets the saved order and the draw too', async () => {
    await confirmPlan(plan, NOW);
    drawNewOrder(workout, catalog);
    await forgetPlan(workout.id);
    expect(drawn()[workout.id]).toBeUndefined();
    expect(useSoundtrackSession.getState().saved[workout.id]).toBeUndefined();
  });
});
