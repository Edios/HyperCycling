import { describe, expect, it } from 'vitest';
import type { Segment } from '../../../domain/segments';
import {
  CONSTRUCT,
  MAX_CONSTRUCT_INSTANCES,
  buildConstruct,
  type ConstructFrame,
  type Placer,
} from './scenes-constructs';
import {
  MAX_BEND,
  MAX_CURVATURE,
  MAX_HILLS,
  bendTable,
  blockBend,
  rollY,
  windX,
} from './scenes-path';
import { THEMES } from './scenes-themes';

function seg(
  index: number,
  startSec: number,
  durationSec: number,
  effort: number,
  rpm: number,
): Segment {
  return {
    index,
    startSec,
    durationSec,
    kind: 'steady',
    ftpPctStart: 70,
    ftpPctEnd: 70,
    effortStart: effort as Segment['effortStart'],
    effortEnd: effort as Segment['effortEnd'],
    rpm,
    blockId: `b${index}`,
    rep: 1,
    reps: 1,
  };
}

describe('bend and hills factors', () => {
  it('scale the road linearly and stay deterministic per seed', () => {
    expect(windX(777, 5, 2)).toBeCloseTo(2 * windX(777, 5, 1), 9);
    expect(windX(777, 5, 2)).toBe(windX(777, 5, 2));
    expect(rollY(500, 5, 3)).toBeCloseTo(3 * rollY(500, 5, 1), 9);
  });

  it('keep the curvature bounded at the largest bend', () => {
    let max = 0;
    for (let z = 0; z < 20000; z += 2) {
      max = Math.max(
        max,
        Math.abs(windX(z + 1, 9, MAX_BEND) - 2 * windX(z, 9, MAX_BEND) + windX(z - 1, 9, MAX_BEND)),
      );
    }
    expect(max).toBeLessThanOrEqual(MAX_CURVATURE * MAX_BEND);
  });

  it('every Neon Grid chapter asks for a legal factor, and chapters differ', () => {
    const looks = THEMES['neon-grid'].scene.variants;
    expect(looks.length).toBe(7);
    for (const l of looks) {
      expect(l.bend).toBeGreaterThan(0);
      expect(l.bend).toBeLessThanOrEqual(MAX_BEND);
      expect(l.hills).toBeGreaterThan(0);
      expect(l.hills).toBeLessThanOrEqual(MAX_HILLS);
    }
    expect(new Set(looks.map((l) => `${l.bend}/${l.hills}`)).size).toBeGreaterThanOrEqual(6);
  });
});

describe('blockBend', () => {
  const w = [
    seg(0, 0, 100, 4, 90),
    seg(1, 100, 100, 7, 65),
    seg(2, 200, 100, 9, 100),
    seg(3, 300, 100, 2, 85),
  ];

  it('winds in climbs, runs straight in sprints and sways gently in recovery', () => {
    expect(blockBend(w, 150)).toBeGreaterThan(1);
    expect(blockBend(w, 250)).toBeLessThan(0.5);
    expect(blockBend(w, 350)).toBeLessThan(1);
    expect(blockBend([], 10)).toBe(1);
  });

  it('never jumps (no sudden sideways swing at a block boundary)', () => {
    for (let t = 0; t < 400; t += 0.25) {
      expect(Math.abs(blockBend(w, t + 0.25) - blockBend(w, t))).toBeLessThan(0.03);
    }
  });

  it('bendTable places a coming block where the rider reaches it', () => {
    const out = new Float32Array(91);
    bendTable(w, 180, 25, 8, out);
    expect(out[0]).toBeGreaterThan(0.3);
    expect(out[90]).toBeLessThan(0.5); // 720 units ahead = 29 s later: the sprint (200..300 s)
    const again = new Float32Array(91);
    bendTable(w, 180, 25, 8, again);
    expect(Array.from(again)).toEqual(Array.from(out));
  });
});

describe('world constructions', () => {
  const count = (id: number, dist: number, high = true): { n: number; key: string } => {
    let n = 0;
    let key = 0;
    const put: Placer = (x, y, z, sx, sy, sz) => {
      n++;
      key += x * 1.1 + y * 2.3 + z * 3.7 + sx + sy + sz;
    };
    const f: ConstructFrame = { dist, time: 3, roadX: () => 0, roadY: () => 0, scale: 1 };
    buildConstruct(id, high, f, put);
    return { n, key: key.toFixed(4) };
  };

  it('stay within the instance budget on every chapter and distance', () => {
    for (const id of Object.values(CONSTRUCT)) {
      for (let d = 0; d < 20000; d += 137) {
        expect(count(id, d).n).toBeLessThanOrEqual(MAX_CONSTRUCT_INSTANCES * 1.4);
      }
    }
  });

  it('are deterministic', () => {
    for (const id of Object.values(CONSTRUCT)) expect(count(id, 1234)).toEqual(count(id, 1234));
  });

  it('use uneven spacing: neighbouring frames never repeat one fixed rhythm', () => {
    const depths: number[] = [];
    const put: Placer = (_x, _y, z, sx) => {
      if (sx <= 1) depths.push(-z);
    };
    buildConstruct(
      CONSTRUCT.corridor,
      true,
      { dist: 0, time: 0, roadX: () => 0, roadY: () => 0, scale: 1 },
      put,
    );
    const gaps = new Set(depths.slice(1).map((d, i) => Math.round(d - (depths[i] ?? 0))));
    expect(gaps.size).toBeGreaterThan(3);
  });

  it('a landmark appears once in a long while and is gone in between', () => {
    const big = (dist: number): number => {
      let b = 0;
      const put: Placer = (_x, _y, _z, sx, sy, sz) => {
        if (Math.max(sx, sy, sz) >= 9) b++;
      };
      buildConstruct(
        CONSTRUCT.dust,
        true,
        { dist, time: 0, roadX: () => 0, roadY: () => 0, scale: 1 },
        put,
      );
      return b;
    };
    let shown = 0;
    for (let d = 0; d < 12600; d += 50) if (big(d) > 0) shown++;
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(0.5 * (12600 / 50));
  });
});
