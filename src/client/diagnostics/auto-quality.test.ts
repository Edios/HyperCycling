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

  it('triggers once the 5 s window averages below 45 fps', () => {
    const at = run(createAutoQuality(), 30, 20_000); // ~33 fps
    expect(at).toBeGreaterThanOrEqual(5000);
    expect(at).toBeLessThan(5100);
  });

  it('triggers only once', () => {
    const c = createAutoQuality();
    expect(run(c, 40, 6000)).toBeDefined();
    expect(run(c, 40, 20_000, 7000)).toBeUndefined();
  });

  it('judges each 5 s window on its own', () => {
    const c = createAutoQuality();
    expect(run(c, 1000 / 60, 5000)).toBeUndefined(); // good window
    expect(run(c, 40, 5100, 5100)).toBeDefined(); // slow window afterwards
  });

  it('restarts the window after a long pause (hidden tab)', () => {
    const c = createAutoQuality();
    c.onFrame(0);
    c.onFrame(16);
    expect(c.onFrame(60_000)).toBe(false); // the gap is not a slow window
    expect(run(c, 1000 / 60, 10_000, 60_016)).toBeUndefined();
  });
});
