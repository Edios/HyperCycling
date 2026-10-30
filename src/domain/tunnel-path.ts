import type { Segment } from './segments';

export interface Bend {
  axis: 'x' | 'y';
  dir: 1 | -1;
  amp: number;
  len: number;
}

/** Tunnel length in world units. */
export const TUNNEL_LENGTH = 288;
/** Length of a standard x-bend in world units. */
export const BEND_LENGTH = 150;
export const SCALE_REFERENCE_SEC = 45;
export const SCALE_MIN = 0.3;
export const SCALE_MAX = 1;
export const Y_BEND_MIN_EFFORT_DELTA = 2;
export const Y_BEND_BASE_AMP = 6;
export const Y_BEND_AMP_PER_LEVEL = 3.5;
export const Y_BEND_MAX_AMP = 26;
export const Y_BEND_LEN = 130;
export const X_BEND_TRANSITION_PROBABILITY = 0.7;
export const X_BEND_FLIP_PROBABILITY = 0.65;
export const X_BEND_TRANSITION_AMP = 38;
export const X_BEND_TRANSITION_LEN = 150;
export const MID_BEND_MIN_SECTION_SEC = 60;
export const MID_BEND_MARGIN_SEC = 4;
export const MID_BEND_AMP = 30;
export const MID_BEND_LEN = 150;

/** Shorter neighbouring segments get gentler, shorter bends. */
export function bendScale(cur: Segment, next: Segment): number {
  const k = Math.min(cur.durationSec, next.durationSec) / SCALE_REFERENCE_SEC;
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, k));
}

function xDir(rand: () => number, lastXDir: 1 | -1): 1 | -1 {
  return rand() < X_BEND_FLIP_PROBABILITY ? (lastXDir === 1 ? -1 : 1) : lastXDir;
}

export function planTransitionBend(
  cur: Segment,
  next: Segment,
  rand: () => number,
  lastXDir: 1 | -1,
): Bend | null {
  const k = bendScale(cur, next);
  const delta = next.effortStart - cur.effortEnd;
  if (Math.abs(delta) >= Y_BEND_MIN_EFFORT_DELTA) {
    return {
      axis: 'y',
      dir: delta > 0 ? 1 : -1,
      amp: Math.min(Y_BEND_MAX_AMP, Y_BEND_BASE_AMP + Y_BEND_AMP_PER_LEVEL * Math.abs(delta)) * k,
      len: Y_BEND_LEN * k,
    };
  }
  if (rand() < X_BEND_TRANSITION_PROBABILITY) {
    return {
      axis: 'x',
      dir: xDir(rand, lastXDir),
      amp: X_BEND_TRANSITION_AMP * k,
      len: X_BEND_TRANSITION_LEN * k,
    };
  }
  return null;
}

export function planMidSectionBend(
  cur: Segment,
  secondsLeft: number,
  secondsToArrive: number,
  rand: () => number,
  lastXDir: 1 | -1,
): Bend | null {
  // The caller knows how long the tunnel takes to arrive (secondsToArrive covers TUNNEL_LENGTH
  // units), so the time the bend itself takes scales proportionally: BEND_LENGTH / TUNNEL_LENGTH.
  const bendSeconds = secondsToArrive * (BEND_LENGTH / TUNNEL_LENGTH);
  if (cur.durationSec < MID_BEND_MIN_SECTION_SEC) return null;
  if (secondsLeft <= secondsToArrive + bendSeconds + MID_BEND_MARGIN_SEC) return null;
  return { axis: 'x', dir: xDir(rand, lastXDir), amp: MID_BEND_AMP, len: MID_BEND_LEN };
}
