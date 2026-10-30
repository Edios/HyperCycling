import { workoutOf, type Plan, type PlanLayout, type PlanSlot } from '../../domain/plan';
import type { Equipment } from '../../domain/settings';

export const RAMP_TEST_ID = 'ramp-test';
export const FALLBACK_PROGRES_ID = 'sweet-spot-2x10';

/**
 * Workout id actually ridden for a plan slot. A ramp test needs a power reading, so without
 * `showsWatts` it is replaced by the week's `progresAlt` (fallback: sweet spot 2 x 10).
 */
export function effectiveSession(
  plan: Plan,
  week: number,
  slot: PlanSlot,
  equipment: Equipment,
  layout: PlanLayout = 'progresFreestyle',
): string | undefined {
  const id = workoutOf(plan, week, slot, layout);
  if (id !== RAMP_TEST_ID || equipment.showsWatts) return id;
  const alt = plan.weeks[week - 1]?.progresAlt;
  return alt !== undefined && alt !== RAMP_TEST_ID ? alt : FALLBACK_PROGRES_ID;
}
