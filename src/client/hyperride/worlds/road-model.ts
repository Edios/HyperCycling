/** Pure helpers of the Road world (no three.js), unit tested. */

/** Below this speed an arrival depth is meaningless (same rule as colorAtDepth in frame.ts). */
export const MIN_GATE_SPEED = 0.5;

/** Phase of a repeating pattern (dashes, edge bars, props) for the distance travelled. */
export function dashOffset(distance: number, dashLength: number): number {
  if (!(dashLength > 0)) return 0;
  return ((distance % dashLength) + dashLength) % dashLength;
}

export interface GateInput {
  /** Current (smoothed) speed, units per second. */
  speed: number;
  /** Seconds until the next block starts; null in the last block. */
  nextBlockInSec: number | null;
  /** Farthest depth the road is drawn to. */
  viewDistance: number;
}

/**
 * Depth along the road where the next block starts, i.e. where the camera will be when it
 * begins at the current speed. Null when there is no next block, it starts right now, the rider
 * is (nearly) stopped, or it is still beyond the view distance.
 */
export function gateDepth({ speed, nextBlockInSec, viewDistance }: GateInput): number | null {
  if (nextBlockInSec === null || nextBlockInSec <= 0) return null;
  if (speed <= MIN_GATE_SPEED) return null;
  const depth = speed * nextBlockInSec;
  return depth > viewDistance ? null : depth;
}

/** Deterministic pseudo-random value in [0, 1) for an integer key (stable props along the road). */
export function hash01(key: number): number {
  let k = Math.imul((key | 0) + 1, 2654435761) >>> 0;
  k ^= k >>> 15;
  k = Math.imul(k, 2246822519) >>> 0;
  k ^= k >>> 13;
  return (k >>> 0) / 4294967296;
}

/** Vertical fov on wide screens (same as the tunnel). */
export const BASE_VFOV_DEG = 70;
/** Tall (portrait) screens widen the vertical fov so at least this horizontal fov is visible. */
export const MIN_HFOV_DEG = 66;
export const MAX_VFOV_DEG = 110;

/** Vertical fov for an aspect ratio (width / height): 70° on wide screens, wider on tall ones. */
export function baseVerticalFov(aspect: number): number {
  const halfH = Math.tan((MIN_HFOV_DEG * Math.PI) / 360);
  const needed = (2 * Math.atan(halfH / Math.max(aspect, 0.01)) * 180) / Math.PI;
  return Math.max(BASE_VFOV_DEG, Math.min(needed, MAX_VFOV_DEG));
}
