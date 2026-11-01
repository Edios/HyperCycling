import { describe, expect, it } from 'vitest';
import { frameStats, SLOW_FRAME_MS } from './frame-stats';

describe('frameStats', () => {
  it('returns zeros for no samples', () => {
    expect(frameStats([])).toEqual({
      count: 0,
      avgFps: 0,
      avgFrameMs: 0,
      p95FrameMs: 0,
      p5Fps: 0,
      slowPct: 0,
    });
  });

  it('computes average fps from the mean frame time', () => {
    const s = frameStats([10, 20, 30]); // mean 20 ms
    expect(s.avgFps).toBeCloseTo(50, 6);
    expect(s.avgFrameMs).toBeCloseTo(20, 6);
    expect(s.count).toBe(3);
  });

  it('takes the p95 frame time with nearest-rank on sorted samples', () => {
    const samples = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100 ms
    expect(frameStats(samples).p95FrameMs).toBe(95);
  });

  it('is order independent and does not mutate its input', () => {
    const samples = [50, 10, 30, 20, 40];
    const copy = [...samples];
    expect(frameStats(samples)).toEqual(frameStats([10, 20, 30, 40, 50]));
    expect(samples).toEqual(copy);
  });

  it('derives the worst-case fps (p5) from the p95 frame time', () => {
    const smooth = [
      ...Array.from({ length: 95 }, () => 10),
      ...Array.from({ length: 5 }, () => 50),
    ];
    expect(frameStats(smooth).p95FrameMs).toBe(10);
    const rough = [
      ...Array.from({ length: 90 }, () => 10),
      ...Array.from({ length: 10 }, () => 50),
    ];
    const s = frameStats(rough);
    expect(s.p95FrameMs).toBe(50);
    expect(s.p5Fps).toBeCloseTo(20, 6);
  });

  it('counts frames slower than 33 ms as slow', () => {
    expect(SLOW_FRAME_MS).toBe(33);
    const s = frameStats([16, 16, 33, 34, 100]); // 33 is not slower than 33
    expect(s.slowPct).toBeCloseTo(40, 6);
  });

  it('ignores non-finite and non-positive samples', () => {
    const s = frameStats([16, NaN, Infinity, -5, 0, 16]);
    expect(s.count).toBe(2);
    expect(s.avgFrameMs).toBe(16);
  });
});
