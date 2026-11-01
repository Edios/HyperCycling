import { ftpPctToEffort, type EffortLevel } from '../../domain/effort';
import { flattenWorkout } from '../../domain/segments';
import { totalDurationSec, type Workout } from '../../domain/workout';
import { weeklyLoad, type Plan, type PlanLayout } from '../../domain/plan';
import type { Equipment } from '../../domain/settings';
import { getWorkout } from '../data/builtin';
import { ftpTestKindOf } from '../../domain/ftp-test';
import { effectiveSession } from './effective-session';

export type LevelFilter = 'all' | 'beginner' | 'intermediate' | 'short';

export function matchesFilter(plan: Plan, filter: LevelFilter): boolean {
  return filter === 'all' || plan.level === filter;
}

/** Hard minutes per week of a built-in plan; a missing workout makes every week count as 0. */
export function planLoad(plan: Plan): number[] {
  try {
    return weeklyLoad(plan, (id) => {
      const w = getWorkout(id);
      if (!w) throw new Error(`Unknown workout ${id}`);
      return w;
    });
  } catch (err) {
    console.warn('Computing the weekly load failed', err);
    return plan.weeks.map(() => 0);
  }
}

/** CSS color token for a week bar: light weeks are blue, the rest climb with relative load. */
export function loadColor(load: number, max: number, light: boolean): string {
  if (light) return 'var(--z3)';
  const ratio = max > 0 ? load / max : 0;
  if (ratio >= 0.9) return 'var(--z8)';
  if (ratio >= 0.7) return 'var(--z7)';
  return 'var(--z5)';
}

/** Bar height in percent; a small stub keeps empty weeks visible. */
export function loadHeightPct(load: number, max: number): number {
  return max > 0 ? Math.max(8, Math.round((load / max) * 100)) : 8;
}

export function sessionsPerWeek(layout: PlanLayout): number {
  return layout === 'plusFreestyle' ? 3 : 2;
}

/** Rough riding hours in a week, rounded to half an hour. */
export function hoursPerWeek(minutes: number, layout: PlanLayout): number {
  return Math.round(((minutes * sessionsPerWeek(layout)) / 60) * 2) / 2;
}

/** 1-based weeks whose served sessions include an FTP test (after the equipment swap). */
export function testWeeks(
  plan: Plan,
  equipment: Equipment,
  layout: PlanLayout,
  skipFirstTest = false,
): number[] {
  const out: number[] = [];
  plan.weeks.forEach((_, i) => {
    const hit = (['progres', 'freestyle'] as const).some((slot) => {
      const id = effectiveSession(plan, i + 1, slot, equipment, layout, skipFirstTest);
      return id !== undefined && ftpTestKindOf(id) !== undefined;
    });
    if (hit) out.push(i + 1);
  });
  return out;
}

/** Typical session length of a built-in plan: mean of its sessions, to the nearest 5 minutes. */
export function typicalMinutes(plan: Plan): number {
  let sec = 0;
  let n = 0;
  for (const week of plan.weeks) {
    for (const s of week.sessions) {
      const w = getWorkout(s.workoutId);
      if (!w) continue;
      sec += totalDurationSec(w);
      n++;
    }
  }
  return n === 0 ? 45 : Math.round(sec / n / 60 / 5) * 5;
}

/**
 * Effort level (1..10) that colours a workout in the plan calendar: the hardest sustained stretch
 * (blocks of 3 minutes or more; any block when none is that long).
 */
export function workoutPeakLevel(workout: Workout): EffortLevel {
  const segments = flattenWorkout(workout);
  const sustained = segments.filter((s) => s.durationSec >= 180);
  const pool = sustained.length > 0 ? sustained : segments;
  const peak = Math.max(0, ...pool.map((s) => (s.ftpPctStart + s.ftpPctEnd) / 2));
  return ftpPctToEffort(peak);
}
