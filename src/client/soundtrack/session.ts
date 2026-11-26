import { create } from 'zustand';
import type { CatalogTrack } from '../../domain/soundtrack-catalog';
import type { SoundtrackPlan } from '../../domain/soundtrack-plan';
import { planRecord } from '../../domain/soundtrack-store';
import { NO_CHOICES, shufflePlan } from '../../domain/soundtrack-wizard';
import type { Workout } from '../../domain/workout';
import { getRepositories } from '../data/repositories';
import { historyIds, loadSoundtrackHistory, recordSoundtrackRide } from './history';

/**
 * The music matched for a workout, by workout id: what the screens read. The confirmed plan is
 * also kept on the device (the `soundtrackPlans` repository, one record per workout); this store
 * is its in-memory copy, filled from the repository the first time a workout is looked at.
 */
interface SoundtrackSession {
  plans: Record<string, SoundtrackPlan>;
  /** The plan kept on the device for a workout (what "play the last order again" plays). */
  saved: Record<string, SoundtrackPlan>;
  /**
   * Workouts whose plan in `plans` is a new order drawn for this ride, not the saved one: after
   * the ride the rider may save it ("Save the song order") or leave it (the saved one stays).
   */
  drawn: Record<string, true>;
  /** Workouts whose saved plan has been looked for (found or not): it is read once per visit. */
  loaded: Record<string, true>;
  /** The last save failed (storage refused): the plan still works for this visit. */
  saveFailed: boolean;
  /**
   * The workout as the ride screen scaled it (a plan's length and difficulty), for the wizard to
   * plan: the songs are chosen for what is ridden, not for the unscaled original.
   */
  workouts: Record<string, Workout>;
  /** Takes a plan over in memory only (no storage): the screens see it at once. */
  setPlan(workoutId: string, plan: SoundtrackPlan): void;
  /** Forgets the plan in memory only. */
  clearPlan(workoutId: string): void;
  setWorkout(workoutId: string, workout: Workout | undefined): void;
}

export const useSoundtrackSession = create<SoundtrackSession>((set) => ({
  plans: {},
  saved: {},
  drawn: {},
  loaded: {},
  saveFailed: false,
  workouts: {},
  setPlan: (id, plan) =>
    set((s) => ({ plans: { ...s.plans, [id]: plan }, loaded: { ...s.loaded, [id]: true } })),
  clearPlan: (id) =>
    set((s) => {
      const { [id]: _gone, ...rest } = s.plans;
      void _gone;
      return { plans: rest, loaded: { ...s.loaded, [id]: true } };
    }),
  setWorkout: (id, workout) =>
    set((s) => {
      const { [id]: _gone, ...rest } = s.workouts;
      void _gone;
      return { workouts: workout ? { ...rest, [id]: workout } : rest };
    }),
}));

/**
 * Looks for the saved plan of a workout, once per visit, and puts it in the session. A plan the
 * rider made in this visit wins, and storage that fails to answer is not an error: the workout
 * simply has no music matched.
 */
export async function loadSavedPlan(workoutId: string): Promise<void> {
  if (useSoundtrackSession.getState().loaded[workoutId]) return;
  useSoundtrackSession.setState((s) => ({ loaded: { ...s.loaded, [workoutId]: true } }));
  try {
    const repos = await getRepositories();
    const record = await repos.soundtrackPlans.get(workoutId);
    if (record && useSoundtrackSession.getState().plans[workoutId] === undefined) {
      useSoundtrackSession.setState((s) => ({
        plans: { ...s.plans, [workoutId]: record.plan },
        saved: { ...s.saved, [workoutId]: record.plan },
      }));
    }
  } catch (err) {
    console.warn('Loading the saved music plan failed', err);
  }
}

/**
 * Confirms a plan: it is taken over at once and written to the device with the time of the
 * confirmation, and its songs become the newest ride of the history (the next plans rotate away
 * from them, music energy spec §3a). Returns false when the write failed (the plan then lasts for
 * this visit only).
 */
export async function confirmPlan(plan: SoundtrackPlan, now = new Date()): Promise<boolean> {
  useSoundtrackSession.getState().setPlan(plan.workoutId, plan);
  useSoundtrackSession.setState((s) => ({ drawn: without(s.drawn, plan.workoutId) }));
  recordSoundtrackRide(plan, now);
  try {
    const repos = await getRepositories();
    await repos.soundtrackPlans.put(planRecord(plan, now));
    useSoundtrackSession.setState((s) => ({
      saveFailed: false,
      saved: { ...s.saved, [plan.workoutId]: plan },
    }));
    return true;
  } catch (err) {
    console.warn('Saving the music plan failed', err);
    useSoundtrackSession.setState({ saveFailed: true });
    return false;
  }
}

/** Removes the plan of a workout, from memory and from the device. */
export async function forgetPlan(workoutId: string): Promise<boolean> {
  useSoundtrackSession.getState().clearPlan(workoutId);
  useSoundtrackSession.setState((s) => ({
    saved: without(s.saved, workoutId),
    drawn: without(s.drawn, workoutId),
  }));
  try {
    const repos = await getRepositories();
    await repos.soundtrackPlans.remove(workoutId);
    return true;
  } catch (err) {
    console.warn('Removing the saved music plan failed', err);
    return false;
  }
}

function without<T>(map: Record<string, T>, key: string): Record<string, T> {
  if (!(key in map)) return map;
  const { [key]: _gone, ...rest } = map;
  void _gone;
  return rest;
}

/**
 * "Draw a new order" for the next ride of a workout with matched music: the same choices (kinds
 * of music, continuity) with another seed, and the songs of the plan now count as the newest ride
 * so they step back (like "Shuffle" in the wizard, R1c-3 / R1f: the seed is salted per workout).
 * In memory only: the saved plan stays until the rider saves the new order after the ride (and
 * only then is it the newest ride of the history). False when the workout has no plan.
 */
export function drawNewOrder(workout: Workout, catalog: readonly CatalogTrack[]): boolean {
  const current = useSoundtrackSession.getState().plans[workout.id];
  if (!current) return false;
  const history = historyIds(loadSoundtrackHistory());
  const { plan } = shufflePlan(
    workout,
    catalog,
    current.prefs,
    NO_CHOICES,
    current,
    undefined,
    history,
  );
  useSoundtrackSession.setState((s) => ({
    plans: { ...s.plans, [workout.id]: plan },
    drawn: { ...s.drawn, [workout.id]: true },
  }));
  return true;
}

/** "Play the last order again": the saved plan of the workout replaces a drawn one. */
export function replaySavedOrder(workoutId: string): void {
  const saved = useSoundtrackSession.getState().saved[workoutId];
  useSoundtrackSession.setState((s) => ({
    plans: saved ? { ...s.plans, [workoutId]: saved } : s.plans,
    drawn: without(s.drawn, workoutId),
  }));
}

/**
 * "Save the song order" after a ride on a drawn order: it becomes the workout's saved plan (the
 * one the next ride plays again). False when there is no drawn order or the write failed.
 */
export async function saveSongOrder(workoutId: string, now = new Date()): Promise<boolean> {
  const s = useSoundtrackSession.getState();
  const plan = s.plans[workoutId];
  if (!plan || !s.drawn[workoutId]) return false;
  if (await confirmPlan(plan, now)) return true;
  // Not saved: the order is still a drawn one (the rider may try again).
  useSoundtrackSession.setState((st) => ({ drawn: { ...st.drawn, [workoutId]: true } }));
  return false;
}

export function resetSoundtrackSessionForTests(): void {
  useSoundtrackSession.setState({
    plans: {},
    saved: {},
    drawn: {},
    loaded: {},
    saveFailed: false,
    workouts: {},
  });
}
