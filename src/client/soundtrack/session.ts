import { create } from 'zustand';
import type { SoundtrackPlan } from '../../domain/soundtrack-plan';
import type { Workout } from '../../domain/workout';

/**
 * The music matched in this visit, by workout id. It lives in memory only: saving a plan with the
 * workout comes later (Soundtrack Match PR 5), so a reload forgets it.
 */
interface SoundtrackSession {
  plans: Record<string, SoundtrackPlan>;
  /**
   * The workout as the ride screen scaled it (a plan's length and difficulty), for the wizard to
   * plan: the songs are chosen for what is ridden, not for the unscaled original.
   */
  workouts: Record<string, Workout>;
  setPlan(workoutId: string, plan: SoundtrackPlan): void;
  clearPlan(workoutId: string): void;
  setWorkout(workoutId: string, workout: Workout | undefined): void;
}

export const useSoundtrackSession = create<SoundtrackSession>((set) => ({
  plans: {},
  workouts: {},
  setPlan: (id, plan) => set((s) => ({ plans: { ...s.plans, [id]: plan } })),
  clearPlan: (id) =>
    set((s) => {
      const { [id]: _gone, ...rest } = s.plans;
      void _gone;
      return { plans: rest };
    }),
  setWorkout: (id, workout) =>
    set((s) => {
      const { [id]: _gone, ...rest } = s.workouts;
      void _gone;
      return { workouts: workout ? { ...rest, [id]: workout } : rest };
    }),
}));

export function resetSoundtrackSessionForTests(): void {
  useSoundtrackSession.setState({ plans: {}, workouts: {} });
}
