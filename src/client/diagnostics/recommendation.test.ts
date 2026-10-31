import { describe, expect, it } from 'vitest';
import { recommendQuality, type TestResult } from './recommendation';

const r = (
  quality: 'high' | 'low',
  avgFps: number,
  slowPct = 0,
  world = 'neon-tunnel',
): TestResult => ({
  world,
  quality,
  avgFps,
  p5Fps: avgFps * 0.8,
  slowPct,
  width: 1280,
  height: 720,
});

describe('recommendQuality', () => {
  it('recommends high when every high run is smooth', () => {
    const results = [
      r('high', 60),
      r('high', 58, 1, 'road'),
      r('low', 60),
      r('low', 60, 0, 'road'),
    ];
    expect(recommendQuality(results)).toBe('high');
  });

  it('recommends low when high stutters but low is fine', () => {
    const results = [
      r('high', 40, 20),
      r('high', 58, 1, 'road'),
      r('low', 59),
      r('low', 59, 0, 'road'),
    ];
    expect(recommendQuality(results)).toBe('low');
  });

  it('recommends a plain background when even low stutters', () => {
    expect(recommendQuality([r('high', 15, 80), r('low', 25, 40)])).toBe('basic');
  });

  it('returns undefined without results', () => {
    expect(recommendQuality([])).toBeUndefined();
  });
});
