import { describe, expect, it } from 'vitest';
import { createAutoQuality } from './auto-quality';

/** Feeds frames of `dtMs` starting at `t0`; returns the first timestamp at which it triggered. */
function run(
  c: ReturnType<typeof createAutoQuality>,
  dtMs: number,
  durationMs: number,
  t0 = 0,
): number | undefined {
  for (let t = t0; t <= t0 + durationMs; t += dtMs) if (c.onFrame(t)) return t;
  return undefined;
}

describe('createAutoQuality', () => {
  it('does not trigger at a smooth 60 fps', () => {
    expect(run(createAutoQuality(), 1000 / 60, 20_000)).toBeUndefined();
  });

  it('ignores the first 1.5 s and needs two consecutive slow windows', () => {
    const at = run(createAutoQuality(), 30, 30_000); // ~33 fps
    // 1.5 s warm-up + 2 x 5 s windows
    expect(at).toBeGreaterThanOrEqual(11_500);
    expect(at).toBeLessThan(11_600);
  });

  it('does not count a slow start-up', () => {
    const c = createAutoQuality();
    expect(run(c, 100, 1400)).toBeUndefined(); // 10 fps during warm-up only
    expect(run(c, 1000 / 60, 30_000, 1500)).toBeUndefined();
  });

  it('a single slow window followed by a good one does not trigger', () => {
    const c = createAutoQuality();
    expect(run(c, 40, 6500)).toBeUndefined(); // warm-up + one slow window
    expect(run(c, 1000 / 60, 20_000, 6540)).toBeUndefined();
  });

  it('triggers only once', () => {
    const c = createAutoQuality();
    expect(run(c, 40, 13_000)).toBeDefined();
    expect(run(c, 40, 20_000, 14_000)).toBeUndefined();
  });

  it('restarts the window after a long pause (hidden tab)', () => {
    const c = createAutoQuality();
    c.onFrame(0);
    c.onFrame(16);
    expect(c.onFrame(60_000)).toBe(false); // the gap is not a slow window
    expect(run(c, 1000 / 60, 10_000, 60_016)).toBeUndefined();
    expect(run(c, 40, 3000, 70_100)).toBeUndefined(); // warm-up again after a pause
  });
});
