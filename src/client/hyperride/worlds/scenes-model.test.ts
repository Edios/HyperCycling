import { describe, expect, it } from 'vitest';
import {
  CLIMB_GRADE_GAIN,
  RECOVERY_GRADE,
  approach,
  gradeTarget,
  hillProfile,
  meanderX,
  rollingY,
  terrainHeight,
} from './scenes-model';

describe('rollingY / meanderX (world-fixed gentle terrain and curves)', () => {
  it('are bounded and smooth (no step steeper than a gentle grade)', () => {
    for (let z = 0; z < 20000; z += 7) {
      expect(Math.abs(rollingY(z))).toBeLessThanOrEqual(8);
      expect(Math.abs(rollingY(z + 1) - rollingY(z))).toBeLessThan(0.08);
      expect(Math.abs(meanderX(z))).toBeLessThanOrEqual(14);
      expect(Math.abs(meanderX(z + 1) - meanderX(z))).toBeLessThan(0.12);
    }
  });

  it('actually vary (hills and valleys, left and right)', () => {
    const ys = Array.from({ length: 400 }, (_, i) => rollingY(i * 25));
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(4);
    const xs = Array.from({ length: 400 }, (_, i) => meanderX(i * 25));
    expect(Math.max(...xs)).toBeGreaterThan(3);
    expect(Math.min(...xs)).toBeLessThan(-3);
  });
});

describe('hillProfile', () => {
  it('starts at the camera (0 at depth 0)', () => {
    expect(hillProfile(0, 0.2, 150)).toBe(0);
  });

  it('is flat at the camera and bends upward ahead: the hill is seen coming', () => {
    expect(hillProfile(1, 0.2, 150)).toBeLessThan(0.01);
    const early = hillProfile(40, 0.2, 150) - hillProfile(30, 0.2, 150);
    const later = hillProfile(170, 0.2, 150) - hillProfile(160, 0.2, 150);
    expect(later).toBeGreaterThan(early * 2);
  });

  it('climbs monotonically to a crest of 1.25·grade·length at 2.5·length, then stays level', () => {
    let prev = 0;
    for (let d = 10; d <= 370; d += 10) {
      const y = hillProfile(d, 0.2, 150);
      expect(y).toBeGreaterThan(prev);
      prev = y;
    }
    expect(hillProfile(375, 0.2, 150)).toBeCloseTo(1.25 * 0.2 * 150, 6);
    expect(hillProfile(600, 0.2, 150)).toBeCloseTo(1.25 * 0.2 * 150, 6);
  });

  it('is never steeper than the grade', () => {
    for (let d = 0; d < 400; d += 1) {
      expect(hillProfile(d + 1, 0.2, 150) - hillProfile(d, 0.2, 150)).toBeLessThanOrEqual(0.2);
    }
  });

  it('goes down into a valley for a negative grade and is flat for 0', () => {
    expect(hillProfile(100, -0.1, 150)).toBeLessThan(0);
    expect(hillProfile(100, 0, 150)).toBe(0);
  });
});

describe('gradeTarget', () => {
  it('climbs (slopeTarget > 0) lift the road, scaled for a visible but gentle hill', () => {
    expect(gradeTarget(0.13, 0.7)).toBeCloseTo(0.13 * CLIMB_GRADE_GAIN, 10);
  });

  it('recovery (effort ≤ 3) descends into a valley', () => {
    expect(gradeTarget(0, 0.3)).toBe(RECOVERY_GRADE);
    expect(RECOVERY_GRADE).toBeLessThan(0);
  });

  it('is flat otherwise', () => {
    expect(gradeTarget(0, 0.5)).toBe(0);
    expect(gradeTarget(0, 0.9)).toBe(0);
  });
});

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
  const shape = { height: 40, flat: 9, rise: 60, roughness: 0.6 };

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
