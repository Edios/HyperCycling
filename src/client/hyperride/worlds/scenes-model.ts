/** Pure terrain helpers of the Scenes world (no three.js), unit tested. */

const smooth01 = (u: number): number => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

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
