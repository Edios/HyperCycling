import { workoutOf, type Plan, type PlanLayout, type PlanSlot } from '../../domain/plan';
import { ftpTestKindOf } from '../../domain/ftp-test';
import type { Equipment } from '../../domain/settings';

export const FALLBACK_PROGRES_ID = 'sweet-spot-2x10';

/**
 * Workout id actually ridden for a plan slot. An FTP test (ramp, 20-minute or 2 x 8) needs a power reading, so without
 * `showsWatts` it is replaced by the week's `progresAlt` (fallback: sweet spot 2 x 10). The same replacement applies to
 * the week-1 test of the first pass when `skipFirstTest` is set (FTP already known); later re-tests and later
 * cycles of a looping plan stay (`cycle` is 1-based, default 1).
 */
export function effectiveSession(
  plan: Plan,
  week: number,
  slot: PlanSlot,
  equipment: Equipment,
  layout: PlanLayout = 'progresFreestyle',
  skipFirstTest = false,
  cycle = 1,
): string | undefined {
  const id = workoutOf(plan, week, slot, layout);
  if (id === undefined || ftpTestKindOf(id) === undefined) return id;
  if (equipment.showsWatts && !(skipFirstTest && week === 1 && cycle === 1)) return id;
  const alt = plan.weeks[week - 1]?.progresAlt;
  return alt !== undefined && ftpTestKindOf(alt) === undefined ? alt : FALLBACK_PROGRES_ID;
}
