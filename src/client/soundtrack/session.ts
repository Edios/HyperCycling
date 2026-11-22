import { create } from 'zustand';
import type { SoundtrackPlan } from '../../domain/soundtrack-plan';
import { planRecord } from '../../domain/soundtrack-store';
import type { Workout } from '../../domain/workout';
import { getRepositories } from '../data/repositories';

/**
 * The music matched for a workout, by workout id: what the screens read. The confirmed plan is
 * also kept on the device (the `soundtrackPlans` repository, one record per workout); this store
 * is its in-memory copy, filled from the repository the first time a workout is looked at.
 */
interface SoundtrackSession {
  plans: Record<string, SoundtrackPlan>;
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
      useSoundtrackSession.setState((s) => ({ plans: { ...s.plans, [workoutId]: record.plan } }));
    }
  } catch (err) {
    console.warn('Loading the saved music plan failed', err);
  }
}

/**
 * Confirms a plan: it is taken over at once and written to the device with the time of the
 * confirmation. Returns false when the write failed (the plan then lasts for this visit only).
 */
export async function confirmPlan(plan: SoundtrackPlan, now = new Date()): Promise<boolean> {
  useSoundtrackSession.getState().setPlan(plan.workoutId, plan);
  try {
    const repos = await getRepositories();
    await repos.soundtrackPlans.put(planRecord(plan, now));
    useSoundtrackSession.setState({ saveFailed: false });
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
  try {
    const repos = await getRepositories();
    await repos.soundtrackPlans.remove(workoutId);
    return true;
  } catch (err) {
    console.warn('Removing the saved music plan failed', err);
    return false;
  }
}

export function resetSoundtrackSessionForTests(): void {
  useSoundtrackSession.setState({ plans: {}, loaded: {}, saveFailed: false, workouts: {} });
}
