import { describe, expect, it } from 'vitest';
import { approach, terrainHeight } from './scenes-model';

describe('approach (exponential smoothing)', () => {
  it('moves toward the target without overshooting', () => {
    expect(approach(0, 1, 0.1, 2)).toBeCloseTo(0.2, 10);
    expect(approach(0, 1, 1, 5)).toBe(1);
    expect(approach(1, 0, 0.1, 2)).toBeCloseTo(0.8, 10);
  });

  it('does not move when no time passed', () => {
    expect(approach(0.3, 1, 0, 2)).toBe(0.3);
  });
});

describe('terrainHeight', () => {
  const shape = { height: 40, flat: 9, rise: 60, roughness: 0.6, terrace: 0 };

  it('is flat next to the road', () => {
    for (let z = 0; z < 2000; z += 37) {
      expect(terrainHeight(0, z, shape)).toBe(0);
      expect(terrainHeight(9, z, shape)).toBe(0);
    }
  });

  it('stays within [0, height] and is deterministic', () => {
    for (let x = 0; x < 400; x += 13) {
      for (let z = 0; z < 3000; z += 91) {
        const h = terrainHeight(x, z, shape);
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThanOrEqual(40);
        expect(h).toBe(terrainHeight(x, z, shape));
      }
    }
  });

  it('rises away from the road (a valley around it)', () => {
    let near = 0;
    let far = 0;
    for (let z = 0; z < 3000; z += 50) {
      near += terrainHeight(20, z, shape);
      far += terrainHeight(200, z, shape);
    }
    expect(far).toBeGreaterThan(near * 2);
  });

  it('is 0 everywhere for a zero height (flat city / snowfield)', () => {
    expect(terrainHeight(300, 1234, { ...shape, height: 0 })).toBe(0);
  });
});

describe('terrainHeight terraces', () => {
  const base = { height: 80, flat: 10, rise: 60, roughness: 0.2 };
  it('keeps the smooth height when the terrace step is 0', () => {
    const a = terrainHeight(70, 300, { ...base, terrace: 0 });
    expect(a).toBeGreaterThan(0);
  });
  it('flattens heights into treads: most samples sit at a multiple of the step', () => {
    const step = 16;
    let treads = 0;
    let n = 0;
    for (let z = 0; z < 2000; z += 7) {
      const h = terrainHeight(70, z, { ...base, terrace: step });
      const r = h % step;
      if (r < 0.5 || r > step - 0.5) treads++;
      n++;
    }
    expect(treads / n).toBeGreaterThan(0.5);
  });
  it('stays within one step of the smooth height', () => {
    for (let z = 0; z < 1000; z += 13) {
      const smooth = terrainHeight(60, z, { ...base, terrace: 0 });
      const stepped = terrainHeight(60, z, { ...base, terrace: 16 });
      expect(Math.abs(stepped - smooth)).toBeLessThanOrEqual(16);
    }
  });
});
