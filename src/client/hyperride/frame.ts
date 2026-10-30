import { effortRow } from '../../domain/effort';
import { intensityAt, segmentAt, type Segment } from '../../domain/segments';
import type { FrameInput, PathModel, WorldFrame } from './world';

/** Cadence assumed for blocks without an rpm target. */
export const DEFAULT_RPM = 85;
export const SPRINT_RPM = 105;
export const SPRINT_EFFORT = 8;
export const SPRINT_SPEED_FACTOR = 1.35;
export const CLIMB_MAX_RPM = 75;
export const CLIMB_MIN_EFFORT = 6;
export const FOV_NORMAL = 70;
export const FOV_SPRINT = 84;
/** Below this speed the "arrival time" of a ring is meaningless; all rings show the current block. */
const MIN_ARRIVAL_SPEED = 0.5;

export function speedTarget(rpm: number, effort: number): number {
  return (6 + rpm * 0.16 + effort * 1.4) * (rpm >= SPRINT_RPM ? SPRINT_SPEED_FACTOR : 1);
}

/** Bloom strength for an effortGlow (effort / 10): 0.25 + 0.075 · effort. */
export function glowStrength(effortGlow: number): number {
  return 0.25 + 0.75 * effortGlow;
}

export interface FrameContext {
  dtSec: number;
  /** The world's current smoothed speed (used to know when the camera reaches a depth). */
  speed: number;
  path: PathModel;
}

export function buildWorldFrame(input: FrameInput, ctx: FrameContext): WorldFrame {
  const { segments, state, table } = input;
  const segment = segments[state.segmentIndex] ?? segments[0];
  if (!segment) {
    const color = effortRow(1, table).color;
    return {
      dtSec: ctx.dtSec,
      speedTarget: 0,
      effortColor: color,
      colorAtDepth: () => color,
      effortGlow: 0.1,
      slopeTarget: 0,
      fovTarget: FOV_NORMAL,
      path: ctx.path,
    };
  }

  const { effort } = intensityAt(segment, state.segmentElapsedSec, table);
  const rpm = segment.rpm ?? DEFAULT_RPM;
  const running = state.status === 'running';
  const effortColor = effortRow(effort, table).color;

  const last = segments[segments.length - 1] ?? segment;
  const endSec = last.startSec + last.durationSec;
  const t = state.workoutElapsedSec;
  const speed = ctx.speed;

  const colorAtDepth = (depth: number): string => {
    if (speed <= MIN_ARRIVAL_SPEED) return effortColor;
    const arrive = Math.min(t + depth / speed, endSec - 0.01);
    // segmentAt only reads the list; its signature predates readonly inputs.
    const s = segments[segmentAt(segments as Segment[], arrive)] ?? segment;
    return effortRow(intensityAt(s, arrive - s.startSec, table).effort, table).color;
  };

  return {
    dtSec: ctx.dtSec,
    speedTarget: running ? speedTarget(rpm, effort) : 0,
    effortColor,
    colorAtDepth,
    effortGlow: effort / 10,
    slopeTarget: rpm < CLIMB_MAX_RPM && effort >= CLIMB_MIN_EFFORT ? 0.09 + effort * 0.006 : 0,
    fovTarget: rpm >= SPRINT_RPM && effort >= SPRINT_EFFORT ? FOV_SPRINT : FOV_NORMAL,
    path: ctx.path,
  };
}
