import {
  canCountFreestyle,
  nextSession,
  suggestCountTowardPlan,
  type Plan,
  type PlanProgress,
  type PlanSlot,
} from '../../domain/plan';
import { playerSchema, type Player } from '../../domain/player';
import { flattenWorkout } from '../../domain/segments';
import type { EffortTable } from '../../domain/effort';
import type { LastResult } from '../training/last-result';

export const RAMP_TEST_ID = 'ramp-test';

/** Where a counted ride would be recorded, and whether the toggle starts on. */
export interface CountTarget {
  plan: Plan;
  week: number;
  slot: PlanSlot;
  defaultOn: boolean;
}

export function totalOf(result: LastResult, table?: EffortTable): number {
  return flattenWorkout(result.workout, table).reduce((s, x) => s + x.durationSec, 0);
}

/**
 * Plan slot this ride can count toward, or undefined (toggle hidden). A ride started from a plan
 * always can; a freestyle workout ridden on its own only when the open week has a free freestyle
 * slot. Progres workouts count only when started from the plan.
 */
export function countTarget(
  result: LastResult,
  plan: Plan | undefined,
  progress: PlanProgress | undefined,
  totalSec: number,
): CountTarget | undefined {
  if (!plan || !progress) return undefined;
  const defaultOn = suggestCountTowardPlan(result.riddenSec, totalSec);
  if (result.plan) {
    return plan.id === result.plan.planId
      ? { plan, week: result.plan.week, slot: result.plan.slot, defaultOn }
      : undefined;
  }
  if (result.workout.category !== 'freestyle') return undefined;
  const open = canCountFreestyle(plan, progress);
  return open ? { plan, week: open.week, slot: 'freestyle', defaultOn } : undefined;
}

/** Pass through a looping plan the next session belongs to (1 for non-looping plans). */
export function activeCycle(plan: Plan, progress: PlanProgress): number {
  return nextSession(plan, progress)?.cycle ?? 1;
}

/** 75 % of the best 1-minute power, rounded; undefined for input that is not a positive number. */
export function proposeFtp(bestWatts: string): number | undefined {
  const trimmed = bestWatts.trim();
  if (trimmed === '') return undefined;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.round(0.75 * n);
}

/** The rider an FTP result belongs to: the player flagged as me, if any. */
export function meOf(players: readonly Player[]): Player | undefined {
  return players.find((p) => p.isMe);
}

/** The player with the new FTP, or undefined when the schema rejects it (50-600 whole watts). */
export function withFtp(player: Player, ftp: number): Player | undefined {
  const r = playerSchema.safeParse({ ...player, ftp });
  return r.success ? r.data : undefined;
}

export function setupPath(result: LastResult): string {
  const base = `/setup/${encodeURIComponent(result.workout.id)}`;
  const p = result.plan;
  return p ? `${base}?plan=${encodeURIComponent(p.planId)}&week=${p.week}&slot=${p.slot}` : base;
}
