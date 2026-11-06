import { describe, expect, it } from 'vitest';
import type { Segment } from '../../../domain/segments';
import {
  CLIMB_GRADE,
  DESCENT_GRADE,
  MAX_CURVATURE,
  blockGrade,
  elevationTable,
  rollY,
  sampleTable,
  windX,
} from './scenes-path';

function blocks(spec: [number, Segment['effortStart'], number][]): Segment[] {
  let start = 0;
  return spec.map(([durationSec, effort, rpm], index) => {
    const s: Segment = {
      index,
      startSec: start,
      durationSec,
      kind: 'steady',
      ftpPctStart: 70,
      ftpPctEnd: 70,
      effortStart: effort,
      effortEnd: effort,
      rpm,
      blockId: `b${index}`,
      rep: 1,
      reps: 1,
    };
    start += durationSec;
    return s;
  });
}

const d1 = (f: (z: number) => number, z: number) => (f(z + 0.5) - f(z - 0.5)) / 1;
const d2 = (f: (z: number) => number, z: number) => f(z + 1) - 2 * f(z) + f(z - 1);

describe('windX (left/right bends)', () => {
  const x = (z: number) => windX(z, 1234);

  it('is continuous in position and slope', () => {
    for (let z = 0; z < 30000; z += 3) {
      expect(Math.abs(x(z + 0.1) - x(z))).toBeLessThan(0.05);
      expect(Math.abs(d1(x, z + 0.1) - d1(x, z))).toBeLessThan(0.002);
    }
  });

  it('has bounded curvature (no hairpins)', () => {
    let max = 0;
    for (let z = 0; z < 30000; z += 2) max = Math.max(max, Math.abs(d2(x, z)));
    expect(max).toBeLessThanOrEqual(MAX_CURVATURE);
    expect(max).toBeGreaterThan(MAX_CURVATURE * 0.3);
  });

  it('really winds both ways, with S-bends (curvature changing sign within a short stretch)', () => {
    let left = 0;
    let right = 0;
    let quickFlips = 0;
    let lastSign = 0;
    let lastFlip = -1e9;
    for (let z = 0; z < 30000; z += 5) {
      const slope = d1(x, z);
      left = Math.min(left, slope);
      right = Math.max(right, slope);
      const k = d2(x, z);
      const sign = Math.abs(k) < MAX_CURVATURE * 0.2 ? 0 : Math.sign(k);
      if (sign !== 0 && lastSign !== 0 && sign !== lastSign) {
        if (z - lastFlip < 400) quickFlips++;
        lastFlip = z;
      }
      if (sign !== 0) lastSign = sign;
    }
    expect(left).toBeLessThan(-0.15);
    expect(right).toBeGreaterThan(0.15);
    expect(quickFlips).toBeGreaterThan(3);
  });

  it('is deterministic per seed and differs between seeds', () => {
    expect(windX(777, 5)).toBe(windX(777, 5));
    expect(windX(777, 5)).not.toBe(windX(777, 6));
  });
});

describe('rollY (crests and dips)', () => {
  it('rolls up and down gently with a continuous slope', () => {
    const y = (z: number) => rollY(z, 99);
    let lo = Infinity;
    let hi = -Infinity;
    for (let z = 0; z < 20000; z += 3) {
      lo = Math.min(lo, y(z));
      hi = Math.max(hi, y(z));
      expect(Math.abs(d1(y, z))).toBeLessThan(0.1);
      expect(Math.abs(d1(y, z + 0.1) - d1(y, z))).toBeLessThan(0.002);
    }
    expect(hi - lo).toBeGreaterThan(10);
  });
});

describe('blockGrade', () => {
  const w = blocks([
    [100, 4, 90], // steady: rolling only
    [100, 7, 65], // climb
    [100, 2, 85], // recovery
  ]);

  it('is uphill in a climb block, downhill in recovery, level otherwise', () => {
    expect(blockGrade(w, 50)).toBe(0);
    expect(blockGrade(w, 150)).toBe(CLIMB_GRADE);
    expect(blockGrade(w, 250)).toBe(DESCENT_GRADE);
    expect(CLIMB_GRADE).toBeGreaterThan(0);
    expect(DESCENT_GRADE).toBeLessThan(0);
  });

  it('changes smoothly across a block boundary', () => {
    for (let t = 90; t < 210; t += 0.25) {
      expect(Math.abs(blockGrade(w, t + 0.25) - blockGrade(w, t))).toBeLessThan(0.02);
    }
    expect(blockGrade(w, 100)).toBeCloseTo(CLIMB_GRADE / 2, 6);
  });

  it('is level without a workout', () => {
    expect(blockGrade([], 10)).toBe(0);
  });
});

describe('elevationTable', () => {
  const step = 8;
  const out = new Float32Array(91);
  const table = (segs: Segment[], t: number, dist = 0) =>
    Array.from(elevationTable(segs, t, 25, dist, 42, step, out));

  it('starts at the camera and is continuous', () => {
    const y = table(blocks([[600, 4, 90]]), 10, 1234);
    expect(y[0]).toBe(0);
    for (let i = 1; i < y.length; i++)
      expect(Math.abs(y[i]! - y[i - 1]!)).toBeLessThan(step * 0.25);
  });

  it('climb blocks go net uphill, recovery net downhill, steady blocks only roll', () => {
    const climb = table(blocks([[600, 7, 65]]), 10);
    const rec = table(blocks([[600, 2, 85]]), 10);
    const steady = table(blocks([[600, 4, 90]]), 10);
    const net = (y: number[]) => y[y.length - 1]! - y[0]!;
    expect(net(climb) - net(steady)).toBeGreaterThan(CLIMB_GRADE * 720 * 0.9);
    expect(net(rec) - net(steady)).toBeLessThan(DESCENT_GRADE * 720 * 0.9);
    expect(Math.abs(net(steady))).toBeLessThan(25);
  });

  it('places a coming climb where the rider will reach it', () => {
    // steady for 10 s more at 25 u/s = 250 units, then a climb
    const y = table(
      blocks([
        [20, 4, 90],
        [600, 7, 65],
      ]),
      10,
    );
    const flat = table(blocks([[620, 4, 90]]), 10);
    const at = (arr: number[], d: number) => sampleTable(Float32Array.from(arr), step, d);
    expect(Math.abs(at(y, 200) - at(flat, 200))).toBeLessThan(1);
    expect(at(y, 700) - at(flat, 700)).toBeGreaterThan(CLIMB_GRADE * 400);
  });
});

describe('sampleTable', () => {
  it('interpolates linearly and clamps at the end', () => {
    const t = Float32Array.from([0, 8, 16]);
    expect(sampleTable(t, 8, 4)).toBe(4);
    expect(sampleTable(t, 8, 100)).toBe(16);
    expect(sampleTable(t, 8, -1)).toBe(0);
  });
});
