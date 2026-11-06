import type { Segment } from '../../../domain/segments';
import { CLIMB_MAX_RPM, CLIMB_MIN_EFFORT, DEFAULT_RPM } from '../frame';
import { hash01 } from './road-model';

/**
 * Pure road path of the Scenes world (no three.js), unit tested; deterministic per workout seed.
 * Left/right: two long sweepers plus occasional S-bends, curvature bounded (calm, never a
 * hairpin). Up/down: world-fixed rolling crests and dips everywhere, plus the block grade
 * integrated along the road ahead (climb blocks rise, recovery blocks descend into valleys).
 */

/** Largest |d²x/dz²| of the road centre line (curve radius ≥ 1 / MAX_CURVATURE units). */
export const MAX_CURVATURE = 0.003;
export const CLIMB_GRADE = 0.11;
export const DESCENT_GRADE = -0.07;
/** Half length of the grade ramp around a block boundary, in seconds. */
const RAMP_SEC = 4;
const S_CELL = 700;
const S_PROBABILITY = 0.45;
/** Below this speed, depth → arrival time would stretch to infinity. */
const MIN_PROFILE_SPEED = 5;

const TAU = Math.PI * 2;
const smooth01 = (u: number): number => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const phase = (seed: number, k: number): number => hash01(seed * 31 + k) * TAU;

/** Lateral position of the road centre at world z. */
export function windX(z: number, seed: number): number {
  let x = 30 * Math.sin(z / 450 + phase(seed, 1)) + 14 * Math.sin(z / 210 + phase(seed, 2));
  // an S-bend in some cells: sin(2πu)·sin²(πu) is zero with zero slope and curvature at both ends
  const cell = Math.floor(z / S_CELL);
  const key = seed * 7919 + cell * 104729;
  if (hash01(key) < S_PROBABILITY) {
    const u = z / S_CELL - cell;
    const amp = (14 + 8 * hash01(key + 1)) * (hash01(key + 2) < 0.5 ? -1 : 1);
    const s = Math.sin(Math.PI * u);
    x += amp * Math.sin(TAU * u) * s * s;
  }
  return x;
}

/** Rolling crests and dips of the road at world z (every block, not only climbs). */
export function rollY(z: number, seed: number): number {
  return 7 * Math.sin(z / 260 + phase(seed, 3)) + 4 * Math.sin(z / 110 + phase(seed, 4));
}

function segmentGrade(s: Segment): number {
  const effort = Math.max(s.effortStart, s.effortEnd);
  if ((s.rpm ?? DEFAULT_RPM) < CLIMB_MAX_RPM && effort >= CLIMB_MIN_EFFORT) return CLIMB_GRADE;
  if (effort <= 3) return DESCENT_GRADE;
  return 0;
}

/** Road grade at workout second t, eased over ±RAMP_SEC around block boundaries. */
export function blockGrade(segments: readonly Segment[], t: number): number {
  if (segments.length === 0) return 0;
  let i = 0;
  while (i + 1 < segments.length && (segments[i + 1]?.startSec ?? Infinity) <= t) i++;
  const cur = segments[i];
  if (!cur) return 0;
  const g = segmentGrade(cur);
  const prev = segments[i - 1];
  if (prev && t - cur.startSec < RAMP_SEC) {
    const w = smooth01((t - cur.startSec + RAMP_SEC) / (2 * RAMP_SEC));
    return segmentGrade(prev) + (g - segmentGrade(prev)) * w;
  }
  const next = segments[i + 1];
  const end = cur.startSec + cur.durationSec;
  if (next && end - t < RAMP_SEC) {
    const w = smooth01((t - end + RAMP_SEC) / (2 * RAMP_SEC));
    return g + (segmentGrade(next) - g) * w;
  }
  return g;
}

/**
 * Road height relative to the camera at depths 0, step, 2·step, … (fills `out`): rolling terrain
 * plus the block grade integrated along the road, each depth reached at the current speed.
 */
export function elevationTable(
  segments: readonly Segment[],
  workoutSec: number,
  speed: number,
  dist: number,
  seed: number,
  step: number,
  out: Float32Array,
): Float32Array {
  const v = Math.max(speed, MIN_PROFILE_SPEED);
  const y0 = rollY(dist, seed);
  let acc = 0;
  let gPrev = blockGrade(segments, workoutSec);
  if (out.length > 0) out[0] = 0;
  for (let k = 1; k < out.length; k++) {
    const s = k * step;
    const g = blockGrade(segments, workoutSec + s / v);
    acc += ((gPrev + g) / 2) * step;
    gPrev = g;
    out[k] = acc + rollY(dist + s, seed) - y0;
  }
  return out;
}

/** Linear interpolation in a table sampled every `step`, clamped to its ends. */
export function sampleTable(table: Float32Array, step: number, d: number): number {
  const last = table.length - 1;
  if (last < 0) return 0;
  const f = Math.max(0, Math.min(last, d / step));
  const i = Math.min(last - 1, Math.floor(f));
  if (i < 0) return table[0] ?? 0;
  const a = table[i] ?? 0;
  const b = table[i + 1] ?? a;
  return a + (b - a) * (f - i);
}
