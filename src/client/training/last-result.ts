import { create } from 'zustand';
import type { SessionConfig } from '../../domain/settings';
import type { Workout } from '../../domain/workout';

export interface LastResult {
  workout: Workout;
  riddenSec: number;
  completed: boolean;
  config: SessionConfig;
}

interface LastResultStore {
  result?: LastResult;
  set(r: LastResult): void;
  clear(): void;
}

/** Hand-over from the training screen to the summary screen. */
export const useLastResult = create<LastResultStore>((set) => ({
  result: undefined,
  set: (result) => set({ result }),
  clear: () => set({ result: undefined }),
}));
