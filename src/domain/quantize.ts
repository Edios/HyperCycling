/**
 * Ramp quantisation for manual-knob bikes: a continuous ramp becomes a few
 * equal-duration steady steps ("150/200/250/300"). Pure and deterministic; the
 * algorithm and its defaults are documented in research-b-stepped-resistance.md.
 */

export interface QuantizeOptions {
  /** Shortest step the rider can follow (30 s for a knob, 20 s with a power meter). */
  minStepSec: number;
  /** Upper bound on steps per ramp. */
  maxSteps: number;
  /** Ascending "nice" grids; grid[0] is the fine grid used for endpoints and the mean. */
  grid: readonly number[];
  /** Preferred exact increments, smallest first. */
  ladder: readonly number[];
  absMinJump: number;
  relMinJump: number;
  absMaxJump: number;
  relMaxJump: number;
}

export interface RampStep {
  offsetSec: number;
  durationSec: number;
  value: number;
}

export const WATT_OPTS: QuantizeOptions = {
  minStepSec: 30,
  maxSteps: 8,
  grid: [5, 10, 25, 50],
  ladder: [10, 20, 25, 50, 100],
  absMinJump: 10,
  relMinJump: 0.06,
  absMaxJump: 50,
  relMaxJump: 0.2,
};

export const PCT_OPTS: QuantizeOptions = {
  minStepSec: 30,
  maxSteps: 8,
  grid: [1, 5, 10],
  ladder: [2, 5, 10, 20],
  absMinJump: 3,
  relMinJump: 0.06,
  absMaxJump: 15,
  relMaxJump: 0.2,
};

export const EFFORT_OPTS: QuantizeOptions = {
  minStepSec: 30,
  maxSteps: 8,
  grid: [1],
  ladder: [1, 2],
  absMinJump: 1,
  relMinJump: 0,
  absMaxJump: 2,
  relMaxJump: 0,
};

/** Half-up rounding that does not depend on the sign of the ramp direction. */
const roundTo = (v: number, g: number): number => Math.floor(v / g + 0.5 + 1e-9) * g;

function withOffsets(blocks: { durationSec: number; value: number }[]): RampStep[] {
  let offset = 0;
  return blocks.map((b) => {
    const step = { offsetSec: offset, durationSec: b.durationSec, value: b.value };
    offset += b.durationSec;
    return step;
  });
}

export function quantizeRamp(
  from: number,
  to: number,
  durationSec: number,
  opts: QuantizeOptions,
): RampStep[] {
  if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(durationSec)) return [];
  const T = Math.round(durationSec);
  if (T <= 0) return [];
  const fine = opts.grid[0] ?? 1;
  const abs = Math.abs(to - from);
  const top = Math.max(Math.abs(from), Math.abs(to));
  const minJump = Math.max(opts.absMinJump, opts.relMinJump * top);
  const maxJump = Math.max(opts.absMaxJump, opts.relMaxJump * top);
  const single = (): RampStep[] =>
    withOffsets([{ durationSec: T, value: roundTo((from + to) / 2, fine) }]);

  // 1) Tiny change or too short to step: one block at the mean (work preserving).
  if (abs < minJump || T < 2 * opts.minStepSec) return single();

  // 2) Number of levels.
  const lTime = Math.min(opts.maxSteps, Math.floor(T / opts.minStepSec));
  const lJump = Math.floor(abs / minJump + 1e-9) + 1;
  const lMax = Math.min(lTime, lJump);
  if (lMax < 2) return single();
  let L = lMax;
  for (const inc of opts.ladder) {
    if (inc < minJump - 1e-9) continue;
    const n = abs / inc;
    if (Math.abs(n - Math.round(n)) < 1e-9 && Math.round(n) + 1 <= lMax) {
      L = Math.round(n) + 1;
      break;
    }
  }

  // 3) Include the endpoints unless the jumps would exceed maxJump (then midpoint sampling).
  const inclusive = abs / (L - 1) <= maxJump;
  const realStep = inclusive ? abs / (L - 1) : abs / L;
  const at = (k: number): number =>
    inclusive
      ? (from * (L - 1 - k) + to * k) / (L - 1)
      : (from * (2 * L - 2 * k - 1) + to * (2 * k + 1)) / (2 * L);

  // 4) Snap inner levels to the coarsest grid whose error is small.
  const tol = Math.min(0.15 * realStep, (realStep - minJump) / 2 + fine / 2);
  const grids = [...opts.grid].reverse();
  const prettify = (x: number): number => {
    for (const g of grids) {
      const y = roundTo(x, g);
      if (Math.abs(y - x) <= tol + 1e-9) return y;
    }
    return roundTo(x, fine);
  };
  const levels = Array.from({ length: L }, (_, k) =>
    inclusive && (k === 0 || k === L - 1) ? roundTo(at(k), fine) : prettify(at(k)),
  );

  // 5) Equal whole-second durations; the remainder goes to the last steps.
  const base = Math.floor(T / L);
  const rem = T - base * L;
  const raw = levels.map((value, k) => ({
    durationSec: base + (k >= L - rem ? 1 : 0),
    value,
  }));

  // 6) Merge equal neighbours that rounding may have produced.
  const merged: { durationSec: number; value: number }[] = [];
  for (const s of raw) {
    const last = merged[merged.length - 1];
    if (last && last.value === s.value) last.durationSec += s.durationSec;
    else merged.push({ ...s });
  }
  return withOffsets(merged);
}

/**
 * Exactly `n` equal-duration steps (RampBlock.steps override). `n` is capped by the
 * duration so no step is shorter than one second; 1 holds the mean; equal neighbours
 * produced by a coarse grid are merged.
 */
export function quantizeRampExact(
  from: number,
  to: number,
  durationSec: number,
  n: number,
  opts: QuantizeOptions,
): RampStep[] {
  if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(durationSec)) return [];
  const T = Math.round(durationSec);
  if (T <= 0) return [];
  const fine = opts.grid[0] ?? 1;
  const L = Math.max(1, Math.min(Math.floor(n), T));
  if (L === 1) return withOffsets([{ durationSec: T, value: roundTo((from + to) / 2, fine) }]);
  const base = Math.floor(T / L);
  const rem = T - base * L;
  const merged: { durationSec: number; value: number }[] = [];
  for (let k = 0; k < L; k++) {
    const value = roundTo((from * (L - 1 - k) + to * k) / (L - 1), fine);
    const dur = base + (k >= L - rem ? 1 : 0);
    const last = merged[merged.length - 1];
    if (last && last.value === value) last.durationSec += dur;
    else merged.push({ durationSec: dur, value });
  }
  return withOffsets(merged);
}
