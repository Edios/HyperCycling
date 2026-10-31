/** A frame slower than this (about 30 fps) is visible as a stutter. */
export const SLOW_FRAME_MS = 33;

export interface FrameStats {
  count: number;
  avgFps: number;
  avgFrameMs: number;
  /** 95th percentile frame time (nearest rank). */
  p95FrameMs: number;
  /** Worst-case fps: the rate of the slowest 5 % of frames, 1000 / p95. */
  p5Fps: number;
  /** Percentage of frames slower than SLOW_FRAME_MS. */
  slowPct: number;
}

const ZERO: FrameStats = {
  count: 0,
  avgFps: 0,
  avgFrameMs: 0,
  p95FrameMs: 0,
  p5Fps: 0,
  slowPct: 0,
};

/** Summarises frame durations in milliseconds. Non-finite and non-positive samples are ignored. */
export function frameStats(samplesMs: readonly number[]): FrameStats {
  const s = samplesMs.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (s.length === 0) return { ...ZERO };
  const mean = s.reduce((sum, v) => sum + v, 0) / s.length;
  const p95 = s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)] ?? 0;
  const slow = s.filter((v) => v > SLOW_FRAME_MS).length;
  return {
    count: s.length,
    avgFps: 1000 / mean,
    avgFrameMs: mean,
    p95FrameMs: p95,
    p5Fps: 1000 / p95,
    slowPct: (slow / s.length) * 100,
  };
}
