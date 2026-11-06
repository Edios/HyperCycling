import { describe, expect, it } from 'vitest';
import { planLights } from './road';

describe('planLights (live city lights of the Road world)', () => {
  it('lays a small layer over the skyline, far smaller than the backdrop', () => {
    const p = planLights(2560, 1440, true);
    expect(p.w * p.h).toBeLessThan(2560 * 1440 * 0.1);
    expect(p.x).toBeGreaterThan(0);
    expect(p.x + p.w).toBeLessThanOrEqual(2560);
    expect(p.tower.x).toBeGreaterThan(0);
    expect(p.tower.x).toBeLessThan(p.w);
    expect(p.tower.y).toBeGreaterThan(0);
  });

  it('animates a few windows on high quality and none on low', () => {
    const high = planLights(1920, 1080, true);
    expect(high.windows.length).toBeGreaterThan(3);
    expect(high.windows.length).toBeLessThanOrEqual(28);
    expect(planLights(1920, 1080, false).windows).toHaveLength(0);
  });

  it('is deterministic for a size and fits portrait screens', () => {
    expect(planLights(800, 1200, true)).toEqual(planLights(800, 1200, true));
    const p = planLights(412, 915, true);
    expect(p.x + p.w).toBeLessThanOrEqual(412);
  });
});
