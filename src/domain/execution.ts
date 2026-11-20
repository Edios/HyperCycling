/**
 * Execution score (owner decision, Rouvy style): how well the rider held the block's power target.
 *
 * - A second counts as "on target" when the power is within ±TOLERANCE of the target
 *   (±10 %, at least ±10 W so easy blocks are not stricter in watts than hard ones).
 * - Block score = % of the block's measured time on target (0–100, rounded).
 * - A block is "met" when the score is ≥ MET_SCORE (70 %).
 * - Total = time-weighted average of the block scores; blocks without a target or without data
 *   (no signal) are left out, they never count as failures.
 *
 * The accumulator holds plain numbers only (no allocation per sample).
 */

export const TOLERANCE = 0.1;
export const MIN_TOLERANCE_W = 10;
export const MET_SCORE = 70;
/** Gaps between samples longer than this are a lost signal, not time on or off target. */
export const MAX_SAMPLE_GAP_MS = 3000;

export function onTarget(watts: number, targetW: number): boolean {
  const band = Math.max(MIN_TOLERANCE_W, targetW * TOLERANCE);
  return Math.abs(watts - targetW) <= band;
}

export interface BlockResult {
  segmentIndex: number;
  /** Measured seconds in the block. */
  measuredSec: number;
  score: number;
  met: boolean;
}

export interface ExecutionTracker {
  /** A reading: power at `atMs` with the block's target then (null target = not scored). */
  add(segmentIndex: number, watts: number | null, targetW: number | null, atMs: number): void;
  /** Closes the block that is open now and returns its result (null without data). */
  closeBlock(): BlockResult | null;
  /** Results of the closed blocks, oldest first. */
  results(): readonly BlockResult[];
  /** Time-weighted total of the closed blocks, null when nothing was scored. */
  total(): number | null;
  /** Live score of the open block, null without data. */
  current(): number | null;
}

export function createExecutionTracker(): ExecutionTracker {
  const closed: BlockResult[] = [];
  let segment = -1;
  let onMs = 0;
  let allMs = 0;
  let lastAt: number | null = null;
  let lastOn = false;
  let lastScored = false;

  function close(): BlockResult | null {
    if (segment < 0 || allMs <= 0) {
      onMs = 0;
      allMs = 0;
      lastAt = null;
      return null;
    }
    const score = Math.round((onMs / allMs) * 100);
    const result: BlockResult = {
      segmentIndex: segment,
      measuredSec: allMs / 1000,
      score,
      met: score >= MET_SCORE,
    };
    closed.push(result);
    onMs = 0;
    allMs = 0;
    lastAt = null;
    return result;
  }

  return {
    add(segmentIndex, watts, targetW, atMs) {
      if (segmentIndex !== segment) {
        if (segment >= 0) close();
        segment = segmentIndex;
      }
      // The previous reading held until now (if the gap is a normal one).
      if (lastAt !== null && lastScored) {
        const dt = atMs - lastAt;
        if (dt > 0 && dt <= MAX_SAMPLE_GAP_MS) {
          allMs += dt;
          if (lastOn) onMs += dt;
        }
      }
      lastScored = watts !== null && targetW !== null && targetW > 0;
      lastOn = lastScored && onTarget(watts as number, targetW as number);
      lastAt = atMs;
    },
    closeBlock: close,
    results: () => closed,
    total() {
      let sec = 0;
      let weighted = 0;
      for (const r of closed) {
        sec += r.measuredSec;
        weighted += r.score * r.measuredSec;
      }
      return sec > 0 ? Math.round(weighted / sec) : null;
    },
    current() {
      return allMs > 0 ? Math.round((onMs / allMs) * 100) : null;
    },
  };
}
