import { create } from 'zustand';
import type { PlanSlot } from '../../domain/plan';
import type { Player } from '../../domain/player';
import type { SessionConfig } from '../../domain/settings';
import type { Workout } from '../../domain/workout';

export interface LastResult {
  workout: Workout;
  riddenSec: number;
  completed: boolean;
  config: SessionConfig;
  players: Player[];
  startedAt: string;
  plan?: { planId: string; week: number; slot: PlanSlot; cycle?: number };
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
