import { stepAt, type Segment } from './segments';

export type CoachCue =
  | { kind: 'custom'; text: string }
  | { kind: 'attack' }
  | { kind: 'standUp' }
  | { kind: 'sitDown' }
  | { kind: 'cadence'; rpm: number }
  | { kind: 'cadenceUp' }
  | { kind: 'cadenceDown' }
  /** Pre-cue for the next step of a stepped ramp; wording is by target, never by knob turns. */
  | { kind: 'addResistance'; effort: number; rpm?: number; inSec: number }
  | { kind: 'reduceResistance'; effort: number; rpm?: number; inSec: number };

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

  if (
    prev.position !== undefined &&
    next.position !== undefined &&
    prev.position !== next.position
  ) {
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

/** Seconds before a step boundary at which the resistance cue is shown. */
export const PRE_CUE_SEC = 5;
/** A step change smaller than this (in %FTP) and on the same effort level is not worth a cue. */
const MIN_CUE_JUMP_PCT = 3;

/**
 * Pre-cue for the next step of a stepped ramp. Returns null outside the lead window, on the
 * last step, for changes below the minimum jump and for segments without steps. `key` is stable
 * for the whole window so the caller announces each step once (steps are at least minStep apart,
 * so this is at most one cue per minStep).
 */
export function stepPreCue(
  seg: Segment,
  segElapsedSec: number,
): { key: string; cue: CoachCue } | null {
  const steps = seg.steps;
  if (!steps || steps.length < 2) return null;
  const { index, nextInSec } = stepAt(seg, segElapsedSec);
  if (nextInSec === null || nextInSec <= 0 || nextInSec > PRE_CUE_SEC) return null;
  const cur = steps[index];
  const next = steps[index + 1];
  if (!cur || !next) return null;
  if (next.effort === cur.effort && Math.abs(next.ftpPct - cur.ftpPct) < MIN_CUE_JUMP_PCT) {
    return null;
  }
  const kind = next.ftpPct >= cur.ftpPct ? 'addResistance' : 'reduceResistance';
  return {
    key: `${seg.index}:${index + 1}`,
    cue: {
      kind,
      effort: next.effort,
      ...(seg.rpm !== undefined ? { rpm: seg.rpm } : {}),
      inSec: PRE_CUE_SEC,
    },
  };
}
