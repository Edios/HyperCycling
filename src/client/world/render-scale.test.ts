import { describe, expect, it } from 'vitest';
import { createRenderScaleController, SCALE_MIN } from './render-scale';

/** Runs frames of `dt` ms from `from` for `ms` ms; returns the changes and the end time. */
function run(
  c: ReturnType<typeof createRenderScaleController>,
  from: number,
  ms: number,
  dt: number,
  gpu: number | null = null,
) {
  const changes: number[] = [];
  let t = from;
  while (t < from + ms) {
    t += dt;
    const r = c.onFrame(t, gpu);
    if (r !== undefined) changes.push(r);
  }
  return { changes, end: t };
}

describe('render scale controller', () => {
  it('starts at 1 and ignores warm-up', () => {
    const c = createRenderScaleController();
    const { changes } = run(c, 0, 1400, 50);
    expect(changes).toEqual([]);
    expect(c.scale).toBe(1);
  });
  it('steps down while frames are slow, down to the floor', () => {
    const c = createRenderScaleController();
    const { changes } = run(c, 0, 12000, 40);
    expect(changes[0]).toBe(0.9);
    expect(c.scale).toBe(SCALE_MIN);
  });
  it('holds at 60 fps', () => {
    const c = createRenderScaleController();
    expect(run(c, 0, 20000, 16.6).changes).toEqual([]);
  });
  it('raises again after a cooldown when frames are comfortable', () => {
    const c = createRenderScaleController();
    const a = run(c, 0, 3000, 40);
    const b = run(c, a.end, 20000, 16.6);
    expect(b.changes.length).toBeGreaterThan(0);
    expect(c.scale).toBeGreaterThan(0.8);
  });
  it('does not raise when the GPU time shows no headroom', () => {
    const c = createRenderScaleController();
    const a = run(c, 0, 3000, 40);
    const before = c.scale;
    run(c, a.end, 20000, 16.6, 15);
    expect(c.scale).toBeLessThanOrEqual(before);
  });
  it('a tab pause resets the window', () => {
    const c = createRenderScaleController();
    run(c, 0, 2000, 16.6);
    expect(c.onFrame(60000, null)).toBeUndefined();
  });
});
