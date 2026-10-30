import type { Segment } from '../../domain/segments';
import {
  TUNNEL_LENGTH,
  planMidSectionBend,
  planTransitionBend,
  type Bend,
} from '../../domain/tunnel-path';
import type { PathModel } from './world';

/** A bend placed on the path: `start` is the absolute z where it begins. */
export interface ActiveBend extends Bend {
  start: number;
  source: 'transition' | 'mid';
}

export interface PathFrameInput {
  /** Camera distance along the path. */
  dist: number;
  /** Current (smoothed) speed, units per second. */
  speed: number;
  workoutSec: number;
  segments: readonly Segment[];
  segmentIndex: number;
  running: boolean;
}

export interface PathScheduler extends PathModel {
  readonly bends: readonly ActiveBend[];
  /**
   * Plans the bend for the change cur → next, placed where the camera will be when `next`
   * starts (never closer than 45 % of the tunnel, so it can be seen coming). A mid-section bend
   * in the way is replaced while still ahead of the camera, or followed right after its end when
   * already being ridden. Returns the bend added, or null when none was planned or a previous
   * transition bend has not ended yet.
   */
  onSegmentChange(
    cur: Segment,
    next: Segment,
    secondsLeft: number,
    speed: number,
    dist: number,
  ): ActiveBend | null;
  /** Per-frame scheduling (transition + mid-section bends) and pruning. */
  onFrame(input: PathFrameInput): void;
}

export interface PathModelOptions {
  rand: () => number;
  initialXDir?: 1 | -1;
  /** Workout second of the first mid-section bend attempt (prototype: 15). */
  firstMidBendSec?: number;
}

/** Bends that ended this far behind the camera are folded into the base offset. */
export const PRUNE_MARGIN = 20;
const MIN_TRANSITION_LEAD = 0.45;
const MID_BEND_MIN_GAP_SEC = 20;
const MID_BEND_GAP_SPREAD_SEC = 20;
/** Below this speed a lead time is meaningless (stopped or just starting). */
const MIN_SCHEDULING_SPEED = 1;

const smoothstep = (u: number): number => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

export function createPathModel(opts: PathModelOptions): PathScheduler {
  const { rand } = opts;
  const bends: ActiveBend[] = [];
  let lastXDir: 1 | -1 = opts.initialXDir ?? (rand() < 0.5 ? 1 : -1);
  /** x direction before the latest mid bend, restored when that bend is replaced. */
  let xDirBefore = lastXDir;
  /** Offsets of bends already pruned (they keep their full contribution). */
  let baseX = 0;
  let baseY = 0;
  let plannedFor = -1;
  const firstMid = opts.firstMidBendSec ?? 15;
  let nextMidSec = firstMid;
  let lastWorkoutSec = 0;

  const offset = (axis: 'x' | 'y', z: number): number => {
    let v = 0;
    for (const b of bends)
      if (b.axis === axis) v += b.amp * b.dir * smoothstep((z - b.start) / b.len);
    return v;
  };
  const curveX = (z: number): number => Math.sin(z * 0.004) * 3 + baseX + offset('x', z);
  const curveY = (z: number): number => Math.sin(z * 0.005) * 1 + baseY + offset('y', z);

  const free = (startZ: number): boolean => {
    const last = bends[bends.length - 1];
    return !last || last.start + last.len < startZ;
  };

  const push = (bend: Bend, start: number, source: ActiveBend['source']): ActiveBend => {
    const placed: ActiveBend = { ...bend, start, source };
    bends.push(placed);
    if (bend.axis === 'x') lastXDir = bend.dir;
    return placed;
  };

  const prune = (dist: number): void => {
    while (bends.length > 0) {
      const b = bends[0];
      if (!b || b.start + b.len >= dist - PRUNE_MARGIN) break;
      if (b.axis === 'x') baseX += b.amp * b.dir;
      else baseY += b.amp * b.dir;
      bends.shift();
    }
  };

  const model: PathScheduler = {
    get bends() {
      return bends;
    },
    curveX,
    curveY,
    slopeX: (z) => curveX(z + 0.5) - curveX(z - 0.5),
    slopeY: (z) => curveY(z + 0.5) - curveY(z - 0.5),

    onSegmentChange(cur, next, secondsLeft, speed, dist) {
      let startZ = dist + Math.max(TUNNEL_LENGTH * MIN_TRANSITION_LEAD, secondsLeft * speed);
      const last = bends[bends.length - 1];
      if (last && !free(startZ)) {
        if (last.source !== 'mid') return null;
        if (last.start > dist) {
          // not entered yet: the section change matters more than a decorative side bend
          bends.pop();
          lastXDir = xDirBefore;
        } else {
          startZ = last.start + last.len;
        }
      }
      const bend = planTransitionBend(cur, next, rand, lastXDir);
      return bend ? push(bend, startZ, 'transition') : null;
    },

    onFrame(input) {
      prune(input.dist);
      if (input.workoutSec < lastWorkoutSec) {
        // jumped back: plan the coming transition again, allow a mid-section bend again soon
        plannedFor = -1;
        nextMidSec = Math.min(nextMidSec, input.workoutSec + firstMid);
      }
      lastWorkoutSec = input.workoutSec;
      if (!input.running || input.speed <= MIN_SCHEDULING_SPEED) return;
      const cur = input.segments[input.segmentIndex];
      if (!cur) return;
      const secondsLeft = cur.startSec + cur.durationSec - input.workoutSec;

      if (input.workoutSec >= nextMidSec) {
        const startZ = input.dist + TUNNEL_LENGTH;
        if (free(startZ)) {
          const bend = planMidSectionBend(
            cur,
            secondsLeft,
            TUNNEL_LENGTH / input.speed,
            rand,
            lastXDir,
          );
          if (bend) {
            xDirBefore = lastXDir;
            push(bend, startZ, 'mid');
          }
        }
        nextMidSec = input.workoutSec + MID_BEND_MIN_GAP_SEC + rand() * MID_BEND_GAP_SPREAD_SEC;
      }

      const next = input.segments[input.segmentIndex + 1];
      if (next && plannedFor !== input.segmentIndex && secondsLeft * input.speed <= TUNNEL_LENGTH) {
        plannedFor = input.segmentIndex;
        model.onSegmentChange(cur, next, secondsLeft, input.speed, input.dist);
      }
    },
  };
  return model;
}
