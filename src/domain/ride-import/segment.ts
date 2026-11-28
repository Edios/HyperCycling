/**
 * A ride (1 Hz series) -> editor blocks (spec fit-import §2). A pure, deterministic function:
 * the same ride and settings always give the same blocks.
 *
 * 1. The signal: power, else heart rate (read 20 s late), else power estimated from speed and
 *    grade, as %FTP per second (`signal.ts`). "Shorten to" first squeezes the ride in time.
 * 2. Smoothing by the detail level (60 s ... 10 s), then change points on 5 s bins: PELT with a
 *    penalty from the detail level (or the zone-band fallback).
 * 3. Each stretch: steady, or a ramp when a straight line explains it (rise over 15 pp, R² > 0.6).
 * 4. Effort from the user's effort table (plus %FTP from power), cadence from the file or the
 *    defaults (90 steady, 95 work, 85 rest, 75 climbing seated, 65 standing), climbs, standing
 *    and descents from the grade.
 * 5. Warm-up and cool-down as ramps, same-level neighbours merged, times snapped to 5 or 15 s,
 *    work/rest pairs folded into a repeat, at most `maxBlocks` blocks (the penalty grows until
 *    the ride fits).
 * Also returned: how well the blocks fit the ride (RMSE, energy), for the preview and the tests.
 */

import { DEFAULT_EFFORT_TABLE, ftpPctToEffort, type EffortTable } from '../effort';
import { newId } from '../ids';
import type { Block, Intensity, RampBlock, RepeatBlock, SteadyBlock } from '../workout';
import { pelt, zoneSplits } from './pelt';
import {
  fillGaps,
  gradeSeries,
  intensitySignal,
  estimateFtp,
  median,
  movingAverage,
  movingMedian,
  type IntensitySource,
} from './signal';
import type { RideSeries } from './types';

export type DetailLevel = 1 | 2 | 3 | 4 | 5;

export interface SegmentOptions {
  /** 1 = a few big blocks ... 5 = every interval. Default 3. */
  detail?: DetailLevel;
  /** Change-point method; 'zones' is the simpler fallback. Default 'pelt'. */
  method?: 'pelt' | 'zones';
  /** Most top-level blocks. Default 40. */
  maxBlocks?: number;
  /** Warm-up and cool-down as single ramps. Default true. */
  rampWarmCool?: boolean;
  /** Fold work/rest pairs into a repeat. Default true. */
  mergeRepeats?: boolean;
  /** "Shorten to": squeeze the ride into this many seconds (only shorter than the ride). */
  targetSec?: number;
  /** Language of the block labels ("Climb 6%"). Default 'en'. */
  lang?: 'pl' | 'en';
}

export interface SegmentProfile {
  ftpW?: number;
  hrMaxBpm?: number;
  riderKg?: number;
  effortTable?: EffortTable;
}

export type SegmentWarning =
  /** Heart rate max taken from the ride itself (no setting, no device value). */
  | 'hrMaxFromRide'
  /** Built from speed and grade: a rough estimate. */
  | 'estimatedFromSpeed'
  /** A short stretch with sprints was averaged (its peaks are not in the block). */
  | 'sprintsAveraged'
  /** An intensity was outside 20-200 % FTP and was clamped. */
  | 'intensityClamped'
  /** Longer than 4 hours: the editor and the sessions are made for up to 4 h. */
  | 'longRide';

export interface SegmentDiagnostics {
  source: IntensitySource;
  ftpW?: number;
  hrMaxBpm?: number;
  /** Share of the ride the signal covers (0..1). */
  coverage: number;
  pauses: number;
  /** Root mean square gap between the smoothed ride and the blocks, in % FTP points. */
  rmsePct: number;
  /** 0..100: how closely the blocks follow the ride ("fit 92 %"). */
  fitPct: number;
  /** Work in kJ: from the ride, and from the blocks (power and speed only). */
  workKjRide?: number;
  workKjBlocks?: number;
  /** Stretches too uneven to be one level (group riding): shown hatched in the preview. */
  variableBlocks: number;
  /** The block profile per second (%FTP), for the preview chart. */
  profilePct: Float32Array;
  /** The smoothed ride per second (%FTP), for the preview chart. */
  ridePct: Float32Array;
}

export type SegmentResult =
  | {
      ok: true;
      blocks: Block[];
      tags: string[];
      warnings: SegmentWarning[];
      diagnostics: SegmentDiagnostics;
    }
  | { ok: false; need: 'ftp'; suggestedFtpW?: number }
  | { ok: false; need: 'signal' };

export const DEFAULT_MAX_BLOCKS = 40;
const MAX_BLOCK_SEC = 14_400;
const BIN_SEC = 5;
const SMOOTH_SEC: Record<DetailLevel, number> = { 1: 60, 2: 45, 3: 30, 4: 20, 5: 10 };
/** Smallest change (pp of FTP) worth a new block, per detail level (sets the PELT penalty). */
const STEP_PCT: Record<DetailLevel, number> = { 1: 25, 2: 18, 3: 12, 4: 8, 5: 5 };
const MIN_SEC: Record<IntensitySource, number> = { power: 30, heartRate: 60, speed: 120 };
const RAMP_RISE_PCT = 15;
const RAMP_R2 = 0.6;
const VARIABLE_STD_PCT = 8;
const WARM_COOL_MAX_EFFORT = 5;
const CADENCE = { steady: 90, work: 95, rest: 85, climbSeated: 75, climbStanding: 65 } as const;
const LABELS = {
  pl: { climb: (g: number) => `Podjazd ${g}%`, descent: 'Zjazd / luz' },
  en: { climb: (g: number) => `Climb ${g}%`, descent: 'Descent / coast' },
} as const;

type Role = 'warmup' | 'cooldown' | 'work' | 'rest';

/** A stretch of the ride, before it becomes a block. Times in seconds of riding. */
interface Stretch {
  start: number;
  end: number;
  kind: 'steady' | 'ramp';
  mean: number;
  from: number;
  to: number;
  variable: boolean;
  rpm?: number;
  standing?: boolean;
  label?: string;
  climb?: boolean;
  role?: Role;
}

interface Fit {
  mean: number;
  std: number;
  /** Line through the points: value at the start and at the end. */
  from: number;
  to: number;
  r2: number;
  max: number;
}

function fitLine(a: ArrayLike<number>, start: number, end: number): Fit {
  const n = end - start;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  let max = -Infinity;
  for (let i = 0; i < n; i += 1) {
    const y = a[start + i] as number;
    sx += i;
    sy += y;
    sxx += i * i;
    sxy += i * y;
    syy += y * y;
    if (y > max) max = y;
  }
  const mean = sy / n;
  const varY = syy / n - mean * mean;
  const den = n * sxx - sx * sx;
  const slope = den === 0 ? 0 : (n * sxy - sx * sy) / den;
  const intercept = (sy - slope * sx) / n;
  const ssTot = varY * n;
  let ssRes = 0;
  for (let i = 0; i < n; i += 1) {
    const d = (a[start + i] as number) - (intercept + slope * i);
    ssRes += d * d;
  }
  return {
    mean,
    std: Math.sqrt(Math.max(0, varY)),
    from: intercept,
    to: intercept + slope * Math.max(0, n - 1),
    r2: ssTot > 1e-9 ? 1 - ssRes / ssTot : 0,
    max,
  };
}

/** "Shorten to": each new second is the average of `durationSec / targetSec` old ones. */
export function shortenSeries(series: RideSeries, targetSec: number): RideSeries {
  const n = series.durationSec;
  const m = Math.max(1, Math.round(targetSec));
  if (m >= n) return series;
  const squeeze = (col: Float32Array): Float32Array => {
    const out = new Float32Array(m);
    for (let j = 0; j < m; j += 1) {
      const a = Math.floor((j * n) / m);
      const b = Math.max(a + 1, Math.floor(((j + 1) * n) / m));
      let sum = 0;
      let count = 0;
      for (let i = a; i < b; i += 1) {
        const v = col[i] as number;
        if (!Number.isNaN(v)) {
          sum += v;
          count += 1;
        }
      }
      out[j] = count > 0 ? sum / count : NaN;
    }
    return out;
  };
  const scale = (sec: number) => Math.round((sec * m) / n);
  return {
    ...series,
    durationSec: m,
    power: squeeze(series.power),
    cadence: squeeze(series.cadence),
    heartRate: squeeze(series.heartRate),
    speed: squeeze(series.speed),
    altitude: squeeze(series.altitude),
    distance: squeeze(series.distance),
    pauses: series.pauses.map((p) => ({ atSec: scale(p.atSec), durationSec: p.durationSec })),
    laps: series.laps.map((l) => ({ startSec: scale(l.startSec), endSec: scale(l.endSec) })),
  };
}

interface Context {
  series: RideSeries;
  source: IntensitySource;
  /** %FTP per second for classification (spikes removed, gaps filled). */
  pct: Float64Array;
  /** Raw %FTP (NaN where no reading), for sprint peaks. */
  raw: Float64Array;
  smooth: Float64Array;
  grade: Float64Array | undefined;
  table: EffortTable;
  detail: DetailLevel;
  lang: 'pl' | 'en';
  hasCadence: boolean;
}

const effortOf = (pct: number, table: EffortTable) =>
  ftpPctToEffort(Math.min(200, Math.max(20, pct)), table);

function cadenceIn(ctx: Context, a: number, b: number): number | undefined {
  if (!ctx.hasCadence) return undefined;
  const values: number[] = [];
  for (let i = a; i < b; i += 1) {
    const v = ctx.series.cadence[i] as number;
    if (v > 0) values.push(v);
  }
  if (values.length === 0) return undefined;
  return Math.min(150, Math.max(30, Math.round(median(values) / 5) * 5));
}

function gradeIn(ctx: Context, a: number, b: number): number | undefined {
  if (!ctx.grade) return undefined;
  const d = fillGaps(ctx.series.distance.subarray(a, b));
  const alt = fillGaps(ctx.series.altitude.subarray(a, b));
  const dist = (d[d.length - 1] as number) - (d[0] as number);
  if (!(dist >= 100)) return undefined;
  return (((alt[alt.length - 1] as number) - (alt[0] as number)) / dist) * 100;
}

function toStretch(ctx: Context, start: number, end: number): Stretch {
  const f = fitLine(ctx.pct, start, end);
  const isRamp = Math.abs(f.to - f.from) > RAMP_RISE_PCT && f.r2 > RAMP_R2;
  const s: Stretch = {
    start,
    end,
    kind: isRamp ? 'ramp' : 'steady',
    mean: f.mean,
    from: f.from,
    to: f.to,
    variable: !isRamp && f.std >= VARIABLE_STD_PCT,
  };
  const rpm = cadenceIn(ctx, start, end);
  if (rpm !== undefined) s.rpm = rpm;
  const effort = effortOf(f.mean, ctx.table);
  const grade = gradeIn(ctx, start, end);
  const len = end - start;
  if (grade !== undefined && grade >= 4 && len >= 120) {
    s.climb = true;
    s.label = LABELS[ctx.lang].climb(Math.round(grade));
  }
  // Standing is a guess from cadence, grade and effort (there is no position sensor).
  const cad = rpm ?? Infinity;
  if (len >= 20 && s.kind === 'steady') {
    if (grade !== undefined ? cad < 70 && grade >= 6 && effort >= 7 : cad < 65 && effort >= 8) {
      s.standing = true;
    }
  }
  if (grade !== undefined && grade <= -3) {
    let coast = 0;
    for (let i = start; i < end; i += 1) {
      // Freewheeling: (nearly) no power, measured or estimated, or the cranks standing still.
      if ((ctx.raw[i] as number) <= 4 || ctx.series.cadence[i] === 0) coast += 1;
    }
    if (coast / len > 0.3) {
      s.kind = 'steady';
      s.mean = Math.min(s.mean, ctx.table[1]?.ftpPct ?? 55);
      s.label = LABELS[ctx.lang].descent;
      s.variable = false;
    }
  }
  return s;
}

/** Replaces a run of stretches at the start or the end with one ramp, when the trend says so. */
function warmCool(ctx: Context, list: Stretch[], which: 'warmup' | 'cooldown'): Stretch[] {
  const total = ctx.series.durationSec;
  const [minSec, maxSec] = which === 'warmup' ? [300, 1200] : [180, 900];
  const ordered = which === 'warmup' ? list : [...list].reverse();
  let take = 0;
  let span = 0;
  for (let k = 0; k < ordered.length; k += 1) {
    const s = ordered[k] as Stretch;
    const len = s.end - s.start;
    if (span + len > maxSec) break;
    // A warm-up or cool-down is easy riding: a hard stretch (above tempo) ends it.
    if (effortOf(s.mean, ctx.table) > WARM_COOL_MAX_EFFORT) break;
    const before = ordered[k - 1];
    // Going in: never easier than the stretch before (with a little slack).
    if (before && s.mean < before.mean - 3) break;
    span += len;
    take = k + 1;
  }
  if (take === 0 || span < minSec || take === list.length) return list;
  const [a, b] = which === 'warmup' ? [0, span] : [total - span, total];
  const f = fitLine(ctx.pct, a, b);
  const first = ordered[0] as Stretch;
  const rising = which === 'warmup' ? f.to > f.from : f.to < f.from;
  if (!((rising && f.r2 > 0.5) || effortOf(first.mean, ctx.table) < 4)) return list;
  const ramp: Stretch = {
    start: a,
    end: b,
    kind: 'ramp',
    mean: f.mean,
    // A warm-up climbs and a cool-down falls, whatever the noise says.
    from: which === 'warmup' ? Math.min(f.from, f.to) : Math.max(f.from, f.to),
    to: which === 'warmup' ? Math.max(f.from, f.to) : Math.min(f.from, f.to),
    variable: false,
    role: which,
  };
  const rpm = cadenceIn(ctx, a, b);
  if (rpm !== undefined) ramp.rpm = rpm;
  return which === 'warmup'
    ? [ramp, ...list.slice(take)]
    : [...list.slice(0, list.length - take), ramp];
}

/** Neighbouring steady stretches of the same effort (and cadence within 5 rpm) become one. */
function mergeSameLevel(ctx: Context, list: Stretch[]): Stretch[] {
  const out: Stretch[] = [];
  for (const s of list) {
    const last = out[out.length - 1];
    const same =
      last &&
      last.kind === 'steady' &&
      s.kind === 'steady' &&
      !last.role &&
      !s.role &&
      last.label === s.label &&
      !!last.standing === !!s.standing &&
      effortOf(last.mean, ctx.table) === effortOf(s.mean, ctx.table) &&
      Math.abs((last.rpm ?? 0) - (s.rpm ?? 0)) <= 5;
    if (!last || !same) {
      out.push({ ...s });
      continue;
    }
    const a = last.end - last.start;
    const b = s.end - s.start;
    last.mean = (last.mean * a + s.mean * b) / (a + b);
    last.from = last.mean;
    last.to = last.mean;
    last.end = s.end;
    last.variable = last.variable || s.variable;
    const rpm = cadenceIn(ctx, last.start, last.end);
    if (rpm !== undefined) last.rpm = rpm;
  }
  return out;
}

/** Block boundaries on whole 5 s (detail 1-3: 15 s); the total stays the ride's length. */
function snap(list: Stretch[], step: number, total: number): Stretch[] {
  const out: Stretch[] = [];
  for (const s of list) {
    const start = out.length === 0 ? 0 : (out[out.length - 1] as Stretch).end;
    const end = s.end >= total ? total : Math.round(s.end / step) * step;
    if (end <= start) {
      // Snapped away: its time goes to the stretch before.
      const last = out[out.length - 1];
      if (last) last.end = Math.max(last.end, end);
      continue;
    }
    out.push({ ...s, start, end });
  }
  return out;
}

type Item = { stretch: Stretch } | { repeat: { times: number; work: Stretch; rest: Stretch } };

const similar = (ctx: Context, a: Stretch, b: Stretch) => {
  const la = a.end - a.start;
  const lb = b.end - b.start;
  return (
    a.kind === 'steady' &&
    b.kind === 'steady' &&
    !a.role &&
    !b.role &&
    (Math.abs(la - lb) <= 10 || Math.abs(la - lb) <= 0.15 * Math.max(la, lb)) &&
    Math.abs(effortOf(a.mean, ctx.table) - effortOf(b.mean, ctx.table)) <= 1
  );
};

function average(list: Stretch[]): Stretch {
  const total = list.reduce((s, x) => s + (x.end - x.start), 0);
  const mean = list.reduce((s, x) => s + x.mean * (x.end - x.start), 0) / total;
  const first = list[0] as Stretch;
  const rpms = list.map((x) => x.rpm).filter((r): r is number => r !== undefined);
  return {
    ...first,
    end: first.start + total / list.length,
    mean,
    from: mean,
    to: mean,
    variable: list.some((x) => x.variable),
    ...(rpms.length > 0 ? { rpm: Math.round(median(rpms) / 5) * 5 } : {}),
  };
}

/** Work/rest pairs that repeat (times within 15 % or 10 s, effort within 1) become a repeat. */
function foldRepeats(ctx: Context, list: Stretch[]): Item[] {
  const items: Item[] = [];
  let i = 0;
  while (i < list.length) {
    const w = list[i] as Stretch;
    const r = list[i + 1];
    let k = 0;
    if (r && effortOf(w.mean, ctx.table) > effortOf(r.mean, ctx.table)) {
      while (
        i + 2 * k + 1 < list.length &&
        similar(ctx, w, list[i + 2 * k] as Stretch) &&
        similar(ctx, r, list[i + 2 * k + 1] as Stretch)
      ) {
        k += 1;
      }
    }
    if (k >= 2) {
      const works: Stretch[] = [];
      const rests: Stretch[] = [];
      for (let j = 0; j < k; j += 1) {
        works.push(list[i + 2 * j] as Stretch);
        rests.push(list[i + 2 * j + 1] as Stretch);
      }
      items.push({
        repeat: {
          times: Math.min(50, k),
          work: { ...average(works), role: 'work' },
          rest: { ...average(rests), role: 'rest' },
        },
      });
      i += 2 * k;
    } else {
      items.push({ stretch: w });
      i += 1;
    }
  }
  return items;
}

interface Built {
  blocks: Block[];
  clamped: boolean;
}

function intensity(ctx: Context, pct: number, built: Built): Intensity {
  const clamped = Math.min(200, Math.max(20, pct));
  if (clamped !== pct && ctx.source === 'power') built.clamped = true;
  const out: Intensity = { effort: effortOf(clamped, ctx.table) };
  // Watts were measured: keep the exact %FTP too (ERG). Heart rate and speed give effort only.
  if (ctx.source === 'power') out.ftpPct = Math.round(clamped);
  return out;
}

function defaultRpm(s: Stretch): number | undefined {
  if (s.role === 'warmup' || s.role === 'cooldown') return undefined;
  if (s.role === 'work') return CADENCE.work;
  if (s.role === 'rest') return CADENCE.rest;
  if (s.climb) return s.standing ? CADENCE.climbStanding : CADENCE.climbSeated;
  return CADENCE.steady;
}

function toBlocks(
  ctx: Context,
  s: Stretch,
  built: Built,
  durationSec?: number,
): (SteadyBlock | RampBlock)[] {
  const dur = Math.round(durationSec ?? s.end - s.start);
  const rpm = s.rpm ?? defaultRpm(s);
  const extra = {
    ...(rpm !== undefined ? { rpm } : {}),
    ...(s.standing ? { position: 'standing' as const } : {}),
    ...(s.label ? { label: s.label } : {}),
  };
  if (s.kind === 'ramp') {
    return [
      {
        kind: 'ramp',
        id: newId(),
        durationSec: Math.min(MAX_BLOCK_SEC, dur),
        from: intensity(ctx, s.from, built),
        to: intensity(ctx, s.to, built),
        ...extra,
      },
    ];
  }
  // A block is at most 4 hours: a longer steady stretch becomes several.
  const out: SteadyBlock[] = [];
  for (let left = dur; left > 0; left -= MAX_BLOCK_SEC) {
    out.push({
      kind: 'steady',
      id: newId(),
      durationSec: Math.min(MAX_BLOCK_SEC, left),
      intensity: intensity(ctx, s.mean, built),
      ...extra,
    });
  }
  return out;
}

function stretchesFor(ctx: Context, cuts: number[]): Stretch[] {
  const bounds = [0, ...cuts.map((c) => c * BIN_SEC), ctx.series.durationSec];
  const out: Stretch[] = [];
  for (let k = 0; k + 1 < bounds.length; k += 1) {
    const a = bounds[k] as number;
    const b = bounds[k + 1] as number;
    out.push(toStretch(ctx, a, b));
  }
  return out;
}

function bins(a: Float64Array): Float64Array {
  const m = Math.ceil(a.length / BIN_SEC);
  const out = new Float64Array(m);
  for (let j = 0; j < m; j += 1) {
    let sum = 0;
    let count = 0;
    for (let i = j * BIN_SEC; i < Math.min(a.length, (j + 1) * BIN_SEC); i += 1) {
      sum += a[i] as number;
      count += 1;
    }
    out[j] = sum / count;
  }
  return out;
}

export function segmentRide(
  input: RideSeries,
  profile: SegmentProfile,
  opts: SegmentOptions = {},
): SegmentResult {
  const series =
    opts.targetSec !== undefined && opts.targetSec < input.durationSec
      ? shortenSeries(input, opts.targetSec)
      : input;
  const sig = intensitySignal(series, profile);
  if (!sig.ok) {
    if (sig.need === 'signal') return { ok: false, need: 'signal' };
    const suggested = series.hints.ftpW ?? estimateFtp(series);
    return {
      ok: false,
      need: 'ftp',
      ...(suggested !== undefined ? { suggestedFtpW: suggested } : {}),
    };
  }

  const detail = opts.detail ?? 3;
  const table = profile.effortTable ?? DEFAULT_EFFORT_TABLE;
  const raw = sig.pct;
  const filled = fillGaps(raw);
  // Power: a 5 s median first (single spikes), then the moving average. HR is smooth already.
  const pct = sig.source === 'power' ? movingMedian(filled, 5) : movingAverage(filled, 15);
  const smooth = movingAverage(pct, SMOOTH_SEC[detail]);
  const ctx: Context = {
    series,
    source: sig.source,
    pct,
    raw,
    smooth,
    grade: gradeSeries(series),
    table,
    detail,
    lang: opts.lang ?? 'en',
    hasCadence: series.coverage.cadence >= 0.5,
  };
  const maxBlocks = Math.max(1, opts.maxBlocks ?? DEFAULT_MAX_BLOCKS);
  const minBins = Math.ceil(MIN_SEC[sig.source] / BIN_SEC);
  const binned = bins(smooth);
  const step = detail <= 3 ? 15 : 5;

  let penalty = (STEP_PCT[detail] ** 2 * minBins) / 2;
  let band = STEP_PCT[detail] / 2;
  let items: Item[] = [];
  // The penalty grows until the ride fits the limit; 40 rounds always end at one stretch.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const cuts =
      opts.method === 'zones'
        ? zoneSplits(binned, band, Math.ceil(20 / BIN_SEC)).filter(
            (c, i, all) => c - (all[i - 1] ?? 0) >= minBins,
          )
        : pelt(binned, penalty, minBins);
    let list = stretchesFor(ctx, cuts);
    if (opts.rampWarmCool !== false) {
      list = warmCool(ctx, list, 'warmup');
      list = warmCool(ctx, list, 'cooldown');
    }
    list = snap(mergeSameLevel(ctx, list), step, series.durationSec);
    items =
      opts.mergeRepeats === false ? list.map((stretch) => ({ stretch })) : foldRepeats(ctx, list);
    if (items.length <= maxBlocks) break;
    penalty *= 1.6;
    band *= 1.25;
  }

  const built: Built = { blocks: [], clamped: false };
  const profilePct = new Float32Array(series.durationSec);
  let sprints = false;
  let at = 0;
  const paint = (s: Stretch, len: number) => {
    for (let i = 0; i < len && at + i < profilePct.length; i += 1) {
      profilePct[at + i] =
        s.kind === 'ramp' ? s.from + ((s.to - s.from) * i) / Math.max(1, len - 1) : s.mean;
    }
    at += len;
  };
  for (const item of items) {
    if ('stretch' in item) {
      const s = item.stretch;
      const len = s.end - s.start;
      if (len < 120 && s.kind === 'steady') {
        let peak = 0;
        for (let i = s.start; i < s.end; i += 1) peak = Math.max(peak, (raw[i] as number) || 0);
        if (s.mean > 0 && peak / s.mean > 1.5) sprints = true;
      }
      built.blocks.push(...toBlocks(ctx, s, built));
      paint(s, len);
    } else {
      const { times, work, rest } = item.repeat;
      const wl = Math.round((work.end - work.start) / step) * step || step;
      const rl = Math.round((rest.end - rest.start) / step) * step || step;
      const repeat: RepeatBlock = {
        kind: 'repeat',
        id: newId(),
        times,
        blocks: [...toBlocks(ctx, work, built, wl), ...toBlocks(ctx, rest, built, rl)],
      };
      built.blocks.push(repeat);
      for (let k = 0; k < times; k += 1) {
        paint(work, wl);
        paint(rest, rl);
      }
    }
  }

  // Fit: the smoothed ride against the blocks, second by second.
  let sq = 0;
  let sum = 0;
  for (let i = 0; i < series.durationSec; i += 1) {
    const d = (smooth[i] as number) - (profilePct[i] as number);
    sq += d * d;
    sum += smooth[i] as number;
  }
  const n = Math.max(1, series.durationSec);
  const rmsePct = Math.sqrt(sq / n);
  const meanPct = sum / n;
  const fitPct = Math.round(Math.max(0, Math.min(100, 100 * (1 - rmsePct / Math.max(1, meanPct)))));
  const diagnostics: SegmentDiagnostics = {
    source: sig.source,
    coverage: series.coverage[sig.source],
    pauses: series.pauses.length,
    rmsePct: Math.round(rmsePct * 10) / 10,
    fitPct,
    variableBlocks: items.filter((it) => 'stretch' in it && it.stretch.variable).length,
    profilePct,
    ridePct: Float32Array.from(smooth),
  };
  if (sig.ftpW !== undefined) {
    diagnostics.ftpW = sig.ftpW;
    let ride = 0;
    let blocks = 0;
    for (let i = 0; i < series.durationSec; i += 1) {
      ride += ((filled[i] as number) * sig.ftpW) / 100;
      blocks += ((profilePct[i] as number) * sig.ftpW) / 100;
    }
    diagnostics.workKjRide = Math.round(ride / 1000);
    diagnostics.workKjBlocks = Math.round(blocks / 1000);
  }
  if (sig.hrMaxBpm !== undefined) diagnostics.hrMaxBpm = sig.hrMaxBpm;

  const warnings: SegmentWarning[] = [];
  if (sig.hrMaxFromRide) warnings.push('hrMaxFromRide');
  if (sig.source === 'speed') warnings.push('estimatedFromSpeed');
  if (sprints) warnings.push('sprintsAveraged');
  if (built.clamped) warnings.push('intensityClamped');
  if (series.durationSec > MAX_BLOCK_SEC) warnings.push('longRide');

  const tags: string[] = [];
  if (items.some((it) => 'stretch' in it && it.stretch.climb)) tags.push('climb');
  if (items.some((it) => 'repeat' in it && effortOf(it.repeat.work.mean, table) >= 9))
    tags.push('hiit');

  return { ok: true, blocks: built.blocks, tags, warnings, diagnostics };
}
