import type { PathModel } from './world';

/** Largest HUD displacement in px. */
export const SWAY_MAX_PX = 14;
/** How far ahead of the camera the bend is read (world units). */
const LOOKAHEAD = 14;
const X_GAIN = 1.2;
const Y_GAIN = 1.0;
/** Smoothing rate per second (prototype: dt * 2). */
const SMOOTHING = 2;

export interface Sway {
  x: number;
  y: number;
}

export interface SwayFilter {
  step(path: PathModel, dist: number, slope: number, dtSec: number): Sway;
}

const clamp = (v: number): number => Math.max(-SWAY_MAX_PX, Math.min(SWAY_MAX_PX, v));

/**
 * HUD inertia: the panels lag behind the bends of the tunnel. Feed it every frame and read the
 * clamped pixel offsets from the result (the same object is updated in place).
 */
export function createSway(): SwayFilter {
  let sx = 0;
  let sy = 0;
  const out: Sway = { x: 0, y: 0 };
  return {
    step(path, dist, slope, dtSec) {
      const lx = path.curveX(dist + LOOKAHEAD) - path.curveX(dist);
      const ly = path.curveY(dist + LOOKAHEAD) - path.curveY(dist) + slope * LOOKAHEAD;
      const k = Math.min(1, Math.max(0, dtSec) * SMOOTHING);
      sx += (-lx * X_GAIN - sx) * k;
      sy += (ly * Y_GAIN - sy) * k;
      out.x = clamp(sx);
      out.y = clamp(sy);
      return out;
    },
  };
}
