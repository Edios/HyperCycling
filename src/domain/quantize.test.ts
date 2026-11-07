import { describe, expect, it } from 'vitest';
import {
  EFFORT_OPTS,
  PCT_OPTS,
  WATT_OPTS,
  quantizeRamp,
  quantizeRampExact,
  type QuantizeOptions,
  type RampStep,
} from './quantize';

const values = (s: RampStep[]): number[] => s.map((x) => x.value);
const durations = (s: RampStep[]): number[] => s.map((x) => x.durationSec);
const sum = (a: number[]): number => a.reduce((x, y) => x + y, 0);

describe('quantizeRamp examples (research B §2.3)', () => {
  it('150→300 W in 3 min is 150/200/250/300 × 45 s', () => {
    const s = quantizeRamp(150, 300, 180, WATT_OPTS);
    expect(values(s)).toEqual([150, 200, 250, 300]);
    expect(durations(s)).toEqual([45, 45, 45, 45]);
    expect(s.map((x) => x.offsetSec)).toEqual([0, 45, 90, 135]);
  });

  it('150→300 W in 90 s uses midpoint sampling 175/225/275 × 30 s', () => {
    const s = quantizeRamp(150, 300, 90, WATT_OPTS);
    expect(values(s)).toEqual([175, 225, 275]);
    expect(durations(s)).toEqual([30, 30, 30]);
  });

  it('150→300 W in 5 min uses the exact 25 W ladder (7 steps)', () => {
    const s = quantizeRamp(150, 300, 300, WATT_OPTS);
    expect(values(s)).toEqual([150, 175, 200, 225, 250, 275, 300]);
    expect(sum(durations(s))).toBe(300);
  });

  it('effort 3→8 in 4 min is one level per 40 s', () => {
    const s = quantizeRamp(3, 8, 240, EFFORT_OPTS);
    expect(values(s)).toEqual([3, 4, 5, 6, 7, 8]);
    expect(durations(s)).toEqual([40, 40, 40, 40, 40, 40]);
  });

  it('effort 3→8 in 2 min and 90 s follow the research table', () => {
    expect(values(quantizeRamp(3, 8, 120, EFFORT_OPTS))).toEqual([3, 5, 6, 8]);
    expect(values(quantizeRamp(3, 8, 90, EFFORT_OPTS))).toEqual([4, 6, 7]);
  });

  it('%FTP 100→125 in 3 min (vo2-ramp) is 100/108/117/125', () => {
    const s = quantizeRamp(100, 125, 180, PCT_OPTS);
    expect(s).toHaveLength(4);
    expect(s[0]?.value).toBe(100);
    expect(s[3]?.value).toBe(125);
  });

  it('descending ramp is the mirror of the ascending one', () => {
    expect(values(quantizeRamp(300, 150, 180, WATT_OPTS))).toEqual([300, 250, 200, 150]);
  });
});

describe('quantizeRamp degenerate inputs', () => {
  it('too short to step (< 2×minStep) gives one block at the mean', () => {
    const s = quantizeRamp(150, 300, 40, WATT_OPTS);
    expect(s).toEqual([{ offsetSec: 0, durationSec: 40, value: 225 }]);
  });

  it('zero delta gives one block', () => {
    expect(quantizeRamp(200, 200, 180, WATT_OPTS)).toEqual([
      { offsetSec: 0, durationSec: 180, value: 200 },
    ]);
  });

  it('change below minJump gives the mean', () => {
    expect(quantizeRamp(200, 210, 120, WATT_OPTS)).toEqual([
      { offsetSec: 0, durationSec: 120, value: 205 },
    ]);
  });

  it('zero or negative duration gives no steps', () => {
    expect(quantizeRamp(100, 200, 0, WATT_OPTS)).toEqual([]);
    expect(quantizeRamp(100, 200, -5, WATT_OPTS)).toEqual([]);
  });

  it('non-finite input gives no steps instead of throwing', () => {
    expect(quantizeRamp(NaN, 200, 60, WATT_OPTS)).toEqual([]);
    expect(quantizeRamp(100, Infinity, 60, WATT_OPTS)).toEqual([]);
  });

  it('very steep ramp (100→600 W in 60 s) uses two midpoint steps, never a zero-length step', () => {
    const s = quantizeRamp(100, 600, 60, WATT_OPTS);
    expect(s.length).toBeGreaterThanOrEqual(1);
    expect(s.every((x) => x.durationSec > 0)).toBe(true);
    expect(sum(durations(s))).toBe(60);
  });

  it('fractional seconds are rounded and the sum matches', () => {
    const s = quantizeRamp(150, 300, 180.4, WATT_OPTS);
    expect(sum(durations(s))).toBe(180);
  });

  it('a 20 s minimum step allows finer steps (power-meter profile)', () => {
    const fine: QuantizeOptions = { ...WATT_OPTS, minStepSec: 20 };
    expect(quantizeRamp(150, 300, 180, fine)).toHaveLength(7);
  });
});

/** Small deterministic PRNG so failures are reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PRESETS: Array<[string, QuantizeOptions, [number, number]]> = [
  ['watts', WATT_OPTS, [50, 600]],
  ['pct', PCT_OPTS, [30, 150]],
  ['effort', EFFORT_OPTS, [1, 10]],
];

describe('quantizeRamp properties (2,000 seeded random cases per preset)', () => {
  for (const [name, preset, [lo, hi]] of PRESETS) {
    it(`holds the invariants for ${name}`, () => {
      const r = rng(name.length * 7919);
      for (let i = 0; i < 2000; i++) {
        const isInt = name === 'effort';
        const pick = (): number => {
          const v = lo + r() * (hi - lo);
          return isInt ? Math.round(v) : Math.round(v);
        };
        const from = pick();
        const to = pick();
        const T = 1 + Math.floor(r() * 1200);
        const opts: QuantizeOptions = {
          ...preset,
          minStepSec: [20, 30, 45][Math.floor(r() * 3)] as number,
        };
        const ctx = JSON.stringify({ name, from, to, T, minStepSec: opts.minStepSec });
        const s = quantizeRamp(from, to, T, opts);

        expect(sum(durations(s)), ctx).toBe(T);
        expect(s.length, ctx).toBeGreaterThanOrEqual(1);
        expect(s.length, ctx).toBeLessThanOrEqual(opts.maxSteps);
        if (s.length > 1) {
          expect(
            s.every((x) => x.durationSec >= opts.minStepSec),
            ctx,
          ).toBe(true);
        }
        s.forEach((x, k) => {
          const prev = s[k - 1];
          expect(x.offsetSec, ctx).toBe(prev ? prev.offsetSec + prev.durationSec : 0);
          expect(x.durationSec, ctx).toBeGreaterThan(0);
        });
        // monotonic in the ramp direction, no equal neighbours
        for (let k = 1; k < s.length; k++) {
          const d = (s[k]?.value ?? 0) - (s[k - 1]?.value ?? 0);
          expect(Math.sign(d), ctx).toBe(Math.sign(to - from));
        }
        // bounds
        const fine = opts.grid[0] as number;
        for (const x of s) {
          expect(x.value, ctx).toBeGreaterThanOrEqual(Math.min(from, to) - fine / 2 - 1e-9);
          expect(x.value, ctx).toBeLessThanOrEqual(Math.max(from, to) + fine / 2 + 1e-9);
        }
        // jumps >= minJump - fine
        const top = Math.max(Math.abs(from), Math.abs(to));
        const minJump = Math.max(opts.absMinJump, opts.relMinJump * top);
        for (let k = 1; k < s.length; k++) {
          const d = Math.abs((s[k]?.value ?? 0) - (s[k - 1]?.value ?? 0));
          expect(d, ctx).toBeGreaterThanOrEqual(minJump - fine - 1e-9);
        }
        // mean preserved
        const mean = sum(s.map((x) => x.value * x.durationSec)) / T;
        const delta = Math.abs(to - from);
        expect(Math.abs(mean - (from + to) / 2), ctx).toBeLessThanOrEqual(
          Math.max(fine, 0.3 * delta) / 2 + delta / T + 1e-9,
        );
        // determinism
        expect(quantizeRamp(from, to, T, opts), ctx).toEqual(s);
        // mirror symmetry
        const mirror = quantizeRamp(to, from, T, opts);
        expect(
          mirror.map((x) => x.value),
          ctx,
        ).toEqual(values(s).reverse());
      }
    });
  }
});

describe('quantizeRampExact (RampBlock.steps override)', () => {
  it('1 step holds the mean', () => {
    expect(quantizeRampExact(150, 300, 180, 1, WATT_OPTS)).toEqual([
      { offsetSec: 0, durationSec: 180, value: 225 },
    ]);
  });

  it('n steps are equal-duration and include the endpoints', () => {
    const s = quantizeRampExact(150, 300, 180, 4, WATT_OPTS);
    expect(values(s)).toEqual([150, 200, 250, 300]);
    expect(durations(s)).toEqual([45, 45, 45, 45]);
  });

  it('never makes a zero-length step: n is capped by the duration', () => {
    const s = quantizeRampExact(150, 300, 3, 8, WATT_OPTS);
    expect(s.every((x) => x.durationSec >= 1)).toBe(true);
    expect(sum(durations(s))).toBe(3);
  });

  it('merges equal neighbours on a coarse grid (effort 3 to 4 asked for 5 steps)', () => {
    const s = quantizeRampExact(3, 4, 100, 5, EFFORT_OPTS);
    expect(values(s)).toEqual([3, 4]);
    expect(sum(durations(s))).toBe(100);
  });
});
