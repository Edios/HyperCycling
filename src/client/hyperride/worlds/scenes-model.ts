/** Pure terrain and elevation helpers of the Scenes world (no three.js), unit tested. */

/** Climb grade = slopeTarget × this: a stylised hill, clearly rising toward the horizon. */
export const CLIMB_GRADE_GAIN = 2.8;
/** Grade in recovery (effort ≤ 3): the road runs down into a valley. */
export const RECOVERY_GRADE = -0.13;
/** effortGlow at or below this counts as recovery (effort ≤ 3). */
const RECOVERY_GLOW = 0.3;

const smooth01 = (u: number): number => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

/** Gentle world-fixed hills and valleys under the road (world z along the path). */
export function rollingY(z: number): number {
  return 4.2 * Math.sin(z / 190) + 2.2 * Math.sin(z / 83 + 1.3);
}

/** Gentle world-fixed left/right meander on top of the PathModel bends. */
export function meanderX(z: number): number {
  return 8 * Math.sin(z / 260 + 0.7) + 3.5 * Math.sin(z / 109 + 2.1);
}

/**
 * Height of the road ahead at `depth` for a grade: level at the camera, bending up (or down) ahead
 * to a crest of 1.25 · grade · length at 2.5 · length, never steeper than 0.75 · grade. A climb
 * reads as a hill rising toward the horizon, a recovery as a road dropping into a valley.
 */
export function hillProfile(depth: number, grade: number, length: number): number {
  if (grade === 0 || depth <= 0 || !(length > 0)) return 0;
  return grade * length * 1.25 * smooth01(depth / (2.5 * length));
}

/** Grade the road eases toward: up in climbs, down in recovery, flat otherwise. */
export function gradeTarget(slopeTarget: number, effortGlow: number): number {
  if (slopeTarget > 0) return slopeTarget * CLIMB_GRADE_GAIN;
  if (effortGlow <= RECOVERY_GLOW + 1e-9) return RECOVERY_GRADE;
  return 0;
}

/** Exponential smoothing step toward a target (rate per second), never overshooting. */
export function approach(current: number, target: number, dtSec: number, rate: number): number {
  return current + (target - current) * Math.min(1, Math.max(0, dtSec * rate));
}

export interface TerrainShape {
  /** Peak height of the side terrain (0: flat). */
  height: number;
  /** Half width of the flat band around the road centre. */
  flat: number;
  /** Lateral distance over which the terrain rises from the flat band to full height. */
  rise: number;
  /** 0: smooth rolling hills, 1: sharp ridged peaks. */
  roughness: number;
}

/** Height of the side terrain at lateral distance `absX` from the road and world z. */
export function terrainHeight(absX: number, z: number, shape: TerrainShape): number {
  if (shape.height <= 0 || absX <= shape.flat) return 0;
  const valley = smooth01((absX - shape.flat) / Math.max(1, shape.rise));
  // two octaves: smooth swells (sin) and ridges (1 - |sin|), blended by roughness, in [0, 1]
  const a = 0.5 + 0.5 * Math.sin(absX / 41 + z / 97) * Math.cos(z / 173 - absX / 67);
  const r = 1 - Math.abs(Math.sin(absX / 29 + z / 61 + 1.7));
  const b = 0.5 + 0.5 * Math.sin(absX / 13 - z / 37);
  const n = (1 - shape.roughness) * a + shape.roughness * (0.65 * r + 0.35 * b);
  return shape.height * valley * (0.25 + 0.75 * n);
}
