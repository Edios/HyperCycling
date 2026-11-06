import { describe, expect, it } from 'vitest';
import { baseVerticalFov, dashOffset, gateDepth, hash01 } from './road-model';

describe('dashOffset', () => {
  it('is the distance modulo the dash period', () => {
    expect(dashOffset(0, 4)).toBe(0);
    expect(dashOffset(9, 4)).toBe(1);
    expect(dashOffset(8, 4)).toBe(0);
  });

  it('stays in [0, dashLength) for negative distances', () => {
    expect(dashOffset(-1, 4)).toBe(3);
  });

  it('is 0 for a non-positive dash length instead of NaN', () => {
    expect(dashOffset(5, 0)).toBe(0);
  });
});

describe('gateDepth', () => {
  const view = 200;

  it('sits where the camera will be when the next block starts', () => {
    expect(gateDepth({ speed: 10, nextBlockInSec: 4, viewDistance: view })).toBe(40);
  });

  it('is null at the block boundary (0 s left: the next block is already the current one)', () => {
    expect(gateDepth({ speed: 10, nextBlockInSec: 0, viewDistance: view })).toBeNull();
  });

  it('is null in the last block (no next block)', () => {
    expect(gateDepth({ speed: 10, nextBlockInSec: null, viewDistance: view })).toBeNull();
  });

  it('is null while the next block is still beyond the view distance', () => {
    expect(gateDepth({ speed: 10, nextBlockInSec: 21, viewDistance: view })).toBeNull();
    expect(gateDepth({ speed: 10, nextBlockInSec: 20, viewDistance: view })).toBe(200);
  });

  it('is null when (nearly) stopped: arrival depth is meaningless', () => {
    expect(gateDepth({ speed: 0, nextBlockInSec: 4, viewDistance: view })).toBeNull();
    expect(gateDepth({ speed: 0.4, nextBlockInSec: 4, viewDistance: view })).toBeNull();
  });
});

describe('hash01', () => {
  it('is deterministic and in [0, 1)', () => {
    for (let k = -50; k < 500; k++) {
      const v = hash01(k);
      expect(v).toBe(hash01(k));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('spreads neighbouring keys', () => {
    const values = Array.from({ length: 200 }, (_, k) => hash01(k));
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean).toBeGreaterThan(0.4);
    expect(mean).toBeLessThan(0.6);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('baseVerticalFov', () => {
  it('is 70° on 16:9 projectors and laptops', () => {
    expect(baseVerticalFov(16 / 9)).toBe(70);
    expect(baseVerticalFov(4 / 3)).toBe(70);
  });

  it('widens on portrait phones so the road edges stay in view, capped at 110°', () => {
    const square = baseVerticalFov(1);
    expect(square).toBe(70);
    const phone = baseVerticalFov(412 / 915);
    expect(phone).toBeGreaterThan(90);
    expect(phone).toBeLessThanOrEqual(110);
    expect(baseVerticalFov(0.1)).toBe(110);
  });
});
