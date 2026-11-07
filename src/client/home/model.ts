import type { Segment } from '../../domain/segments';
import { totalDurationSec, type Workout } from '../../domain/workout';

/** Tiles of the mode dock. Experience has no content yet and cannot be selected. */
export type HomeTab = 'plan' | 'free' | 'experience';

/** Next session of the active plan, already resolved to a concrete workout. */
export interface PlanNext {
  planId: string;
  week: number;
  weeks: number;
  slot: 'progres' | 'freestyle';
  cycle: number;
  workoutId: string;
}

export type Hero =
  | { kind: 'plan'; next: PlanNext }
  /** No active plan: a gentle workout to start with, plus a way to build a plan. */
  | { kind: 'starter'; workoutId: string | undefined }
  | { kind: 'free'; workoutId: string | undefined; source: 'last' | 'recommended' };

export interface HeroInput {
  tab: HomeTab;
  /** Null when there is no active plan or it is finished. */
  next: PlanNext | null;
  lastWorkoutId?: string;
  workouts: readonly Workout[];
}

const GENTLE_TARGET_SEC = 30 * 60;

/** A calm, not too long workout: endurance first, closest to 30 minutes, then by id. */
export function gentleWorkout(workouts: readonly Workout[]): Workout | undefined {
  const pool = workouts.filter((w) => w.category === 'freestyle');
  const candidates = pool.length > 0 ? pool : workouts;
  const rank = (w: Workout): [number, number, string] => [
    w.tags.includes('endurance') ? 0 : 1,
    Math.abs(totalDurationSec(w) - GENTLE_TARGET_SEC),
    w.id,
  ];
  return [...candidates].sort((a, b) => {
    const [a0, a1, a2] = rank(a);
    const [b0, b1, b2] = rank(b);
    return a0 - b0 || a1 - b1 || a2.localeCompare(b2);
  })[0];
}

/** What the hero shows for the selected tile. Experience falls back to the Plan hero. */
export function chooseHero({ tab, next, lastWorkoutId, workouts }: HeroInput): Hero {
  if (tab === 'free') {
    const last = workouts.find((w) => w.id === lastWorkoutId);
    if (last) return { kind: 'free', workoutId: last.id, source: 'last' };
    return { kind: 'free', workoutId: gentleWorkout(workouts)?.id, source: 'recommended' };
  }
  if (next) return { kind: 'plan', next };
  return { kind: 'starter', workoutId: gentleWorkout(workouts)?.id };
}

/**
 * One zone (1..10) per tunnel ring: the workout is cut into `count` equal time slices and each
 * takes the time-weighted mean effort of the segments in it.
 */
export function ringZones(segments: readonly Segment[], count = 10): number[] {
  const total = segments.reduce((s, g) => s + g.durationSec, 0);
  if (total <= 0 || count <= 0) return [];
  const slice = total / count;
  const zones: number[] = [];
  for (let i = 0; i < count; i++) {
    const from = i * slice;
    const to = from + slice;
    let sum = 0;
    let weight = 0;
    for (const g of segments) {
      const overlap = Math.min(to, g.startSec + g.durationSec) - Math.max(from, g.startSec);
      if (overlap <= 0) continue;
      sum += ((g.effortStart + g.effortEnd) / 2) * overlap;
      weight += overlap;
    }
    const mean = weight > 0 ? sum / weight : 1;
    zones.push(Math.min(10, Math.max(1, Math.round(mean))));
  }
  return zones;
}
