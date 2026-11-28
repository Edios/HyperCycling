/**
 * The intensity signal of a ride (spec fit-import §2.2, §2.3): which column the workout is built
 * from (power, else heart rate, else speed and grade), turned into one series of %FTP per second,
 * plus the small numeric helpers the segmentation shares (median, moving average, fill-in).
 */

import { DEFAULT_EFFORT_TABLE, type EffortTable } from '../effort';
import type { RideSeries } from './types';

export type IntensitySource = 'power' | 'heartRate' | 'speed';

/** Power must cover this share of the ride to be the signal. */
const POWER_COVERAGE = 0.8;
/** Heart rate or speed must cover this share to be used. */
const OTHER_COVERAGE = 0.5;
/** Heart rate lags behind effort: it is read this many seconds later. */
export const HR_LAG_SEC = 20;

// Rider and bike for the power estimate from speed (spec §2.2.3).
const DEFAULT_RIDER_KG = 75;
const BIKE_KG = 9;
const CDA = 0.32;
const CRR = 0.005;
const AIR_DENSITY = 1.225;
const G = 9.81;

export function pickSource(series: RideSeries): IntensitySource | undefined {
  if (series.coverage.power >= POWER_COVERAGE) return 'power';
  if (series.coverage.heartRate >= OTHER_COVERAGE) return 'heartRate';
  if (series.coverage.speed >= OTHER_COVERAGE) return 'speed';
  return undefined;
}

/** Copy with every NaN replaced by the last value before it (the first ones by the first value). */
export function fillGaps(a: ArrayLike<number>): Float64Array {
  const out = new Float64Array(a.length);
  let first = NaN;
  for (let i = 0; i < a.length; i += 1) {
    const v = a[i] as number;
    if (!Number.isNaN(v)) {
      first = v;
      break;
    }
  }
  let last = Number.isNaN(first) ? 0 : first;
  for (let i = 0; i < a.length; i += 1) {
    const v = a[i] as number;
    if (!Number.isNaN(v)) last = v;
    out[i] = last;
  }
  return out;
}

/** Centred moving average over `window` seconds (shorter at the ends). */
export function movingAverage(a: ArrayLike<number>, window: number): Float64Array {
  const n = a.length;
  const out = new Float64Array(n);
  const half = Math.floor(Math.max(1, window) / 2);
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i += 1) prefix[i + 1] = (prefix[i] as number) + (a[i] as number);
  for (let i = 0; i < n; i += 1) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n, i + half + 1);
    out[i] = ((prefix[hi] as number) - (prefix[lo] as number)) / (hi - lo);
  }
  return out;
}

export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((x, y) => x - y);
  const mid = s.length >> 1;
  return s.length % 2 === 1
    ? (s[mid] as number)
    : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/** Centred running median over `window` seconds (kills single spikes). */
export function movingMedian(a: ArrayLike<number>, window: number): Float64Array {
  const n = a.length;
  const out = new Float64Array(n);
  const half = Math.floor(window / 2);
  for (let i = 0; i < n; i += 1) {
    const part: number[] = [];
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j += 1) {
      part.push(a[j] as number);
    }
    out[i] = median(part);
  }
  return out;
}

/** %FTP of a continuous effort level (0.5..10.5), read off the effort table between its rows. */
export function effortToPct(effort: number, table: EffortTable = DEFAULT_EFFORT_TABLE): number {
  const e = Math.min(10, Math.max(1, effort));
  const lo = Math.floor(e);
  const hi = Math.min(10, lo + 1);
  const a = table[lo - 1]?.ftpPct ?? 0;
  const b = table[hi - 1]?.ftpPct ?? a;
  return a + (b - a) * (e - lo);
}

/**
 * Effort level (continuous) of a heart rate in % of HR max, by the five zones of `hr-zones.ts`:
 * each zone is 10 % wide and two levels high (50-60 % -> 1-2, ..., 90-100 % -> 9-10).
 */
export function hrPctToEffort(pct: number): number {
  return Math.min(10.5, Math.max(0.5, 0.5 + (pct - 50) / 5));
}

/** Smoothed altitude and the grade (%) over at least 100 m of distance, per second. */
export function gradeSeries(series: RideSeries): Float64Array | undefined {
  if (series.coverage.altitude < OTHER_COVERAGE || series.coverage.distance < OTHER_COVERAGE) {
    return undefined;
  }
  const alt = movingAverage(movingMedian(fillGaps(series.altitude), 9), 30);
  const dist = fillGaps(series.distance);
  const n = alt.length;
  const out = new Float64Array(n);
  let j = 0;
  for (let i = 0; i < n; i += 1) {
    // Look back to the first point at least 100 m behind.
    while (j < i && (dist[i] as number) - (dist[j + 1] as number) >= 100) j += 1;
    const d = (dist[i] as number) - (dist[j] as number);
    out[i] = d >= 100 ? (((alt[i] as number) - (alt[j] as number)) / d) * 100 : 0;
  }
  return out;
}

/** Watts from speed and grade (rolling, gravity, air), never below 0. */
export function powerFromSpeed(speed: number, gradePct: number, riderKg: number): number {
  const m = riderKg + BIKE_KG;
  const theta = Math.atan(gradePct / 100);
  const p =
    speed * m * G * (Math.sin(theta) + CRR * Math.cos(theta)) +
    0.5 * AIR_DENSITY * CDA * speed ** 3;
  return Math.max(0, p);
}

/** 95 % of the best 20 minute average power: a rough FTP when the rider has none set. */
export function estimateFtp(series: RideSeries): number | undefined {
  const p = series.power;
  const w = 20 * 60;
  if (series.coverage.power < OTHER_COVERAGE || p.length < w) return undefined;
  const filled = fillGaps(p);
  let sum = 0;
  for (let i = 0; i < w; i += 1) sum += filled[i] as number;
  let best = sum;
  for (let i = w; i < filled.length; i += 1) {
    sum += (filled[i] as number) - (filled[i - w] as number);
    if (sum > best) best = sum;
  }
  const ftp = Math.round((0.95 * best) / w);
  return ftp > 0 ? ftp : undefined;
}

export interface SignalProfile {
  ftpW?: number;
  hrMaxBpm?: number;
  riderKg?: number;
  effortTable?: EffortTable;
}

export type SignalResult =
  | {
      ok: true;
      source: IntensitySource;
      /** %FTP per second (raw; NaN where there was no reading). */
      pct: Float64Array;
      /** The FTP or HR max the numbers were worked out with. */
      ftpW?: number;
      hrMaxBpm?: number;
      /** HR max came from the ride itself (no setting, no device value). */
      hrMaxFromRide?: boolean;
    }
  | { ok: false; need: 'ftp' | 'signal' };

/** The %FTP series of a ride from its best signal. */
export function intensitySignal(series: RideSeries, profile: SignalProfile): SignalResult {
  const source = pickSource(series);
  if (!source) return { ok: false, need: 'signal' };
  const n = series.durationSec;
  const pct = new Float64Array(n);
  const table = profile.effortTable ?? DEFAULT_EFFORT_TABLE;

  if (source === 'heartRate') {
    let hrMax = profile.hrMaxBpm ?? series.hints.hrMaxBpm;
    let fromRide = false;
    if (hrMax === undefined) {
      hrMax = Math.max(...Array.from(series.heartRate).filter((v) => !Number.isNaN(v)));
      fromRide = true;
    }
    for (let i = 0; i < n; i += 1) {
      const hr = series.heartRate[Math.min(n - 1, i + HR_LAG_SEC)] as number;
      pct[i] = Number.isNaN(hr) ? NaN : effortToPct(hrPctToEffort((hr / hrMax) * 100), table);
    }
    return { ok: true, source, pct, hrMaxBpm: hrMax, ...(fromRide ? { hrMaxFromRide: true } : {}) };
  }

  const ftp = profile.ftpW;
  if (ftp === undefined || !(ftp > 0)) return { ok: false, need: 'ftp' };
  if (source === 'power') {
    for (let i = 0; i < n; i += 1) pct[i] = ((series.power[i] as number) / ftp) * 100;
  } else {
    const grade = gradeSeries(series);
    const kg = profile.riderKg ?? series.hints.weightKg ?? DEFAULT_RIDER_KG;
    for (let i = 0; i < n; i += 1) {
      const v = series.speed[i] as number;
      pct[i] = Number.isNaN(v) ? NaN : (powerFromSpeed(v, grade?.[i] ?? 0, kg) / ftp) * 100;
    }
  }
  return { ok: true, source, pct, ftpW: ftp };
}
