/**
 * RawRide (any format, any sampling rate) -> RideSeries on an even 1 Hz axis of riding time
 * (spec fit-import §2.1). A pure function:
 *
 * 1. Impossible readings are left out (power over 2000 W, heart rate under 30 or over 230,
 *    cadence over 200, ...), with one warning.
 * 2. Readings are grouped by wall-clock second: power and cadence are averaged, heart rate,
 *    speed, altitude and distance take the last reading of the second.
 * 3. Pauses are cut out: the timer stopped (FIT), a gap of more than 10 s between readings, or
 *    standing still (speed under 0.5 m/s, no power) for more than 30 s. Each cut is listed.
 * 4. Missing seconds inside riding: up to 4 in a row are filled in linearly, longer runs are NaN.
 * 5. Without a speed reading, speed comes from the distance (GPX).
 */

import type { RawRide, RideImportResult, RideImportWarning, RideSeries } from './types';

export const MAX_RIDE_SEC = 12 * 3600;
export const MIN_RIDE_SEC = 5 * 60;
/** A longer gap between readings is a pause. */
const PAUSE_GAP_SEC = 10;
/** Missing seconds up to this many in a row are filled in. */
const MAX_FILL_SEC = 4;
/** Standing still for longer than this is a pause (auto-pause). */
const STILL_SEC = 30;
const STILL_SPEED = 0.5;

const COLUMNS = ['power', 'cadence', 'heartRate', 'speed', 'altitude', 'distance'] as const;
type Column = (typeof COLUMNS)[number];

/** Plausible range per column; anything outside is a broken reading. */
const RANGES: Record<Column, [number, number]> = {
  power: [0, 2000],
  cadence: [0, 200],
  heartRate: [30, 230],
  speed: [0, 40],
  altitude: [-500, 9000],
  distance: [0, 5_000_000],
};

/** Readings of one wall-clock second. */
interface Bucket {
  /** Whole seconds since the first reading. */
  w: number;
  values: Record<Column, number>;
  paused: boolean;
}

function buckets(ride: RawRide, t0: number): { list: Bucket[]; dropped: number } {
  const list: Bucket[] = [];
  let dropped = 0;
  let sums: Record<'power' | 'cadence', [number, number]> = { power: [0, 0], cadence: [0, 0] };
  const close = () => {
    const b = list[list.length - 1];
    if (!b) return;
    b.values.power = sums.power[1] > 0 ? sums.power[0] / sums.power[1] : NaN;
    b.values.cadence = sums.cadence[1] > 0 ? sums.cadence[0] / sums.cadence[1] : NaN;
  };
  for (const s of ride.samples) {
    const w = Math.floor((s.t - t0) / 1000);
    if (list[list.length - 1]?.w !== w) {
      close();
      sums = { power: [0, 0], cadence: [0, 0] };
      list.push({
        w,
        paused: false,
        values: {
          power: NaN,
          cadence: NaN,
          heartRate: NaN,
          speed: NaN,
          altitude: NaN,
          distance: NaN,
        },
      });
    }
    const b = list[list.length - 1] as Bucket;
    for (const col of COLUMNS) {
      const v = s[col];
      if (v === undefined) continue;
      const [min, max] = RANGES[col];
      if (!Number.isFinite(v) || v < min || v > max) {
        dropped += 1;
        continue;
      }
      if (col === 'power' || col === 'cadence') {
        sums[col][0] += v;
        sums[col][1] += 1;
      } else {
        b.values[col] = v;
      }
    }
  }
  close();
  return { list, dropped };
}

/** Stopped stretches of the timer, as open intervals of wall-clock ms. */
function stoppedIntervals(ride: RawRide): [number, number][] {
  const out: [number, number][] = [];
  let stoppedAt: number | undefined;
  for (const e of ride.timer) {
    if (!e.running) stoppedAt ??= e.t;
    else if (stoppedAt !== undefined) {
      out.push([stoppedAt, e.t]);
      stoppedAt = undefined;
    }
  }
  if (stoppedAt !== undefined) out.push([stoppedAt, Infinity]);
  return out;
}

/** Marks seconds of standing still for longer than STILL_SEC (auto-pause in the field). */
function markStill(list: Bucket[]): void {
  let from = -1;
  const flush = (to: number) => {
    const first = list[from];
    const last = list[to - 1];
    if (from >= 0 && first && last && last.w - first.w + 1 > STILL_SEC) {
      for (let i = from; i < to; i += 1) (list[i] as Bucket).paused = true;
    }
    from = -1;
  };
  list.forEach((b, i) => {
    const { speed, power } = b.values;
    const still = speed < STILL_SPEED && !(power > 0);
    const contiguous = from >= 0 && b.w - (list[i - 1] as Bucket).w <= PAUSE_GAP_SEC;
    if (still && (from < 0 || contiguous)) {
      if (from < 0) from = i;
    } else {
      flush(i);
      if (still) from = i;
    }
  });
  flush(list.length);
}

function lowerBound(sorted: readonly number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid] as number) < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function normalizeRide(ride: RawRide): RideImportResult {
  const t0 = ride.samples[0]?.t;
  if (t0 === undefined) return { ok: false, error: { code: 'noSamples' } };
  const warnings: RideImportWarning[] = [];

  const { list, dropped } = buckets(ride, t0);
  if (dropped > 0) warnings.push('implausibleValues');
  const stopped = stoppedIntervals(ride);
  for (const b of list) {
    const t = t0 + b.w * 1000;
    if (stopped.some(([a, z]) => a < t && t < z)) b.paused = true;
  }
  markStill(list);

  const cols: Record<Column, number[]> = {
    power: [],
    cadence: [],
    heartRate: [],
    speed: [],
    altitude: [],
    distance: [],
  };
  /** Wall-clock second of every second of riding (for the laps). */
  const wallOf: number[] = [];
  const pauses: RideSeries['pauses'] = [];
  let prev: Bucket | undefined;
  let skipped = false;

  for (const b of list) {
    if (b.paused) {
      skipped = true;
      continue;
    }
    if (prev) {
      const gap = b.w - prev.w;
      const prevT = t0 + prev.w * 1000;
      const curT = t0 + b.w * 1000;
      const timerStop = stopped.some(([a, z]) => a < curT && z > prevT);
      if (skipped || timerStop || gap > PAUSE_GAP_SEC) {
        pauses.push({ atSec: wallOf.length, durationSec: gap - 1 });
      } else {
        const missing = gap - 1;
        for (let k = 1; k <= missing; k += 1) {
          for (const col of COLUMNS) {
            const a = prev.values[col];
            const z = b.values[col];
            cols[col].push(missing <= MAX_FILL_SEC ? a + ((z - a) * k) / gap : NaN);
          }
          wallOf.push(prev.w + k);
        }
      }
    }
    for (const col of COLUMNS) cols[col].push(b.values[col]);
    wallOf.push(b.w);
    if (wallOf.length > MAX_RIDE_SEC) return { ok: false, error: { code: 'tooLong' } };
    prev = b;
    skipped = false;
  }

  const durationSec = wallOf.length;
  if (durationSec < MIN_RIDE_SEC) return { ok: false, error: { code: 'tooShort' } };

  // GPX has no speed: take it from the distance covered each second.
  const has = (col: Column) => cols[col].some((v) => !Number.isNaN(v));
  if (!has('speed') && has('distance')) {
    const d = cols.distance;
    cols.speed = d.map((v, i) => {
      const before = d[i - 1];
      const step = before === undefined ? NaN : v - before;
      return step >= 0 && step <= RANGES.speed[1] ? step : NaN;
    });
  }

  const series = (col: Column) => Float32Array.from(cols[col]);
  const coverage = Object.fromEntries(
    COLUMNS.map((col) => [
      col,
      durationSec === 0 ? 0 : cols[col].filter((v) => !Number.isNaN(v)).length / durationSec,
    ]),
  ) as RideSeries['coverage'];

  const laps: RideSeries['laps'] = [];
  for (const lap of ride.laps) {
    const startSec = lowerBound(wallOf, Math.ceil((lap.start - t0) / 1000));
    const endSec = lowerBound(wallOf, Math.ceil((lap.end - t0) / 1000));
    if (endSec > startSec) laps.push({ startSec, endSec });
  }

  return {
    ok: true,
    warnings,
    series: {
      format: ride.format,
      durationSec,
      power: series('power'),
      cadence: series('cadence'),
      heartRate: series('heartRate'),
      speed: series('speed'),
      altitude: series('altitude'),
      distance: series('distance'),
      coverage,
      pauses,
      laps,
      meta: ride.meta,
      hints: ride.hints,
    },
  };
}
