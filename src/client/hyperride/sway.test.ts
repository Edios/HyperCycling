import { describe, expect, it } from 'vitest';
import { SWAY_MAX_PX, createSway } from './sway';
import type { PathModel } from './world';

const path = (kx: number): PathModel => ({
  curveX: (z) => z * kx,
  curveY: () => 0,
  slopeX: () => kx,
  slopeY: () => 0,
});

describe('createSway', () => {
  it('stays at rest on a straight path', () => {
    const s = createSway();
    const o = s.step(path(0), 0, 0, 0.016);
    expect(o).toEqual({ x: 0, y: 0 });
  });

  it('leans against the bend and is smoothed', () => {
    const s = createSway();
    const first = s.step(path(0.1), 0, 0, 0.1).x;
    expect(first).toBeLessThan(0);
    const later = s.step(path(0.1), 0, 0, 0.1).x;
    expect(later).toBeLessThan(first);
  });

  it('never exceeds the clamp', () => {
    const s = createSway();
    let o = { x: 0, y: 0 };
    for (let i = 0; i < 200; i += 1) o = { ...s.step(path(50), 0, 5, 0.1) };
    expect(Math.abs(o.x)).toBe(SWAY_MAX_PX);
    expect(Math.abs(o.y)).toBeLessThanOrEqual(SWAY_MAX_PX);
  });
});
