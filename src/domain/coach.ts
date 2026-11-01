import type { Segment } from './segments';

export type CoachCue =
  | { kind: 'custom'; text: string }
  | { kind: 'attack' }
  | { kind: 'standUp' }
  | { kind: 'sitDown' }
  | { kind: 'cadence'; rpm: number }
  | { kind: 'cadenceUp' }
  | { kind: 'cadenceDown' };

export interface CueOptions {
  /** When false, cadence changes yield cadenceUp/cadenceDown instead of a number. Default true. */
  numericCadence?: boolean;
}

const ATTACK_EFFORT_JUMP = 3;
const CADENCE_DELTA = 15;

/**
 * Cue to announce when moving from `prev` into `next`.
 * Priority: custom cue > attack > position change > cadence change.
 * Inside a repeat only the first rep announces anything.
 */
export function cueForTransition(
  prev: Segment | undefined,
  next: Segment,
  opts: CueOptions = {},
): CoachCue | null {
  if (next.reps > 1 && next.rep > 1) return null;
  if (next.cue !== undefined) return { kind: 'custom', text: next.cue };
  if (!prev) return null;

  if (next.effortStart - prev.effortEnd >= ATTACK_EFFORT_JUMP) return { kind: 'attack' };

  if (prev.position !== undefined && next.position !== undefined && prev.position !== next.position) {
    return next.position === 'standing' ? { kind: 'standUp' } : { kind: 'sitDown' };
  }

  if (prev.rpm !== undefined && next.rpm !== undefined) {
    const diff = next.rpm - prev.rpm;
    if (Math.abs(diff) >= CADENCE_DELTA) {
      if (opts.numericCadence ?? true) return { kind: 'cadence', rpm: next.rpm };
      return diff > 0 ? { kind: 'cadenceUp' } : { kind: 'cadenceDown' };
    }
  }
  return null;
}
