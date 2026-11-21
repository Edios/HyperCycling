/**
 * Ride recording (T6): what a ride with a smart trainer and/or a heart rate strap leaves behind.
 * One record per ride, keyed by the SessionLog id, versioned for the future Coach (M3).
 *
 * Samples are taken once per second of riding (pauses are left out and noted as events).
 * A missing value is null, never 0 (no signal is not zero watts).
 */

import { z } from 'zod';
import { HR_ZONES } from './hr-zones';

export const RIDE_SCHEMA_VERSION = 1;
export const RIDE_SAMPLE_SEC = 1;

export type RideEventKind =
  | 'pause'
  | 'resume'
  | 'autoPause'
  | 'signalLost'
  | 'signalBack'
  | 'ergOff'
  | 'ergOn'
  | 'deviceStop';

export interface RideEvent {
  /** Sample index (seconds of riding) at which it happened. */
  atSec: number;
  kind: RideEventKind;
}

export interface RideBlock {
  segmentIndex: number;
  score: number;
  met: boolean;
  measuredSec: number;
}

export interface RideSamples {
  power: (number | null)[];
  cadence: (number | null)[];
  heartRate: (number | null)[];
  targetW: (number | null)[];
  segmentIndex: number[];
}

export interface RideSummary {
  ridingSec: number;
  avgPowerW: number | null;
  maxPowerW: number | null;
  /** Normalized power (30 s rolling average, 4th power); null under 30 s of power data. */
  normalizedPowerW: number | null;
  workKj: number | null;
  avgCadence: number | null;
  maxCadence: number | null;
  avgHr: number | null;
  maxHr: number | null;
  /** Seconds in HR zones 1–5; null without HRmax or HR data. */
  hrZoneSec: [number, number, number, number, number] | null;
  /** Execution (D21): time-weighted % on target and blocks met; null when nothing was scored. */
  executionPct: number | null;
  blocksMet: number;
  blocksTotal: number;
}

export interface RideRecord {
  id: string;
  schemaVersion: typeof RIDE_SCHEMA_VERSION;
  sessionLogId: string;
  workoutId: string;
  startedAt: string;
  endedAt: string;
  sampleSec: typeof RIDE_SAMPLE_SEC;
  /** FTP and HRmax used for targets and zones during the ride. */
  ftp: number | null;
  hrMax: number | null;
  samples: RideSamples;
  events: RideEvent[];
  blocks: RideBlock[];
  summary: RideSummary;
}

const nullableNumber = z.number().finite().nullable();

export const rideSchema: z.ZodType<RideRecord> = z
  .object({
    id: z.string().min(1),
    schemaVersion: z.literal(RIDE_SCHEMA_VERSION),
    sessionLogId: z.string().min(1),
    workoutId: z.string().min(1),
    startedAt: z.iso.datetime({ offset: true }),
    endedAt: z.iso.datetime({ offset: true }),
    sampleSec: z.literal(RIDE_SAMPLE_SEC),
    ftp: nullableNumber,
    hrMax: nullableNumber,
    samples: z.object({
      power: z.array(nullableNumber),
      cadence: z.array(nullableNumber),
      heartRate: z.array(nullableNumber),
      targetW: z.array(nullableNumber),
      segmentIndex: z.array(z.number().int().min(0)),
    }),
    events: z.array(
      z.object({
        atSec: z.number().int().min(0),
        kind: z.enum([
          'pause',
          'resume',
          'autoPause',
          'signalLost',
          'signalBack',
          'ergOff',
          'ergOn',
          'deviceStop',
        ]),
      }),
    ),
    blocks: z.array(
      z.object({
        segmentIndex: z.number().int().min(0),
        score: z.number().min(0).max(100),
        met: z.boolean(),
        measuredSec: z.number().min(0),
      }),
    ),
    summary: z.object({
      ridingSec: z.number().min(0),
      avgPowerW: nullableNumber,
      maxPowerW: nullableNumber,
      normalizedPowerW: nullableNumber,
      workKj: nullableNumber,
      avgCadence: nullableNumber,
      maxCadence: nullableNumber,
      avgHr: nullableNumber,
      maxHr: nullableNumber,
      hrZoneSec: z.tuple([z.number(), z.number(), z.number(), z.number(), z.number()]).nullable(),
      executionPct: nullableNumber,
      blocksMet: z.number().int().min(0),
      blocksTotal: z.number().int().min(0),
    }),
  })
  .refine(
    (r) => {
      const n = r.samples.power.length;
      const s = r.samples;
      return (
        s.cadence.length === n &&
        s.heartRate.length === n &&
        s.targetW.length === n &&
        s.segmentIndex.length === n
      );
    },
    { message: 'sample arrays must have the same length' },
  ) as unknown as z.ZodType<RideRecord>;

export function emptySamples(): RideSamples {
  return { power: [], cadence: [], heartRate: [], targetW: [], segmentIndex: [] };
}

/** True when the ride has any sensor value at all (otherwise nothing is worth saving). */
export function hasData(s: RideSamples): boolean {
  return (
    s.power.some((v) => v !== null) ||
    s.cadence.some((v) => v !== null) ||
    s.heartRate.some((v) => v !== null)
  );
}

function stats(values: readonly (number | null)[]): { avg: number | null; max: number | null } {
  let sum = 0;
  let n = 0;
  let max = -Infinity;
  for (const v of values) {
    if (v === null) continue;
    sum += v;
    n += 1;
    if (v > max) max = v;
  }
  return n === 0 ? { avg: null, max: null } : { avg: Math.round(sum / n), max: Math.round(max) };
}

/** Normalized power over the samples with power data (gaps are skipped, not counted as 0 W). */
export function normalizedPower(power: readonly (number | null)[]): number | null {
  const p = power.filter((v): v is number => v !== null);
  const window = 30;
  if (p.length < window) return null;
  let sum = 0;
  for (let i = 0; i < window; i++) sum += p[i] ?? 0;
  let acc = (sum / window) ** 4;
  let count = 1;
  for (let i = window; i < p.length; i++) {
    sum += (p[i] ?? 0) - (p[i - window] ?? 0);
    acc += (sum / window) ** 4;
    count += 1;
  }
  return Math.round((acc / count) ** 0.25);
}

export function hrZoneSeconds(
  heartRate: readonly (number | null)[],
  hrMax: number | null,
): [number, number, number, number, number] | null {
  if (!hrMax || !(hrMax > 0)) return null;
  const out: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  let any = false;
  for (const bpm of heartRate) {
    if (bpm === null) continue;
    const pct = (bpm / hrMax) * 100;
    // Under zone 1 counts as zone 1 here (warm-up, recovery): every second with HR is placed.
    const idx = HR_ZONES.findIndex((z) => pct < z.maxPct);
    const zone = (idx < 0 ? 4 : idx) as 0 | 1 | 2 | 3 | 4;
    out[zone] += RIDE_SAMPLE_SEC;
    any = true;
  }
  return any ? out : null;
}

export function summarizeRide(
  samples: RideSamples,
  blocks: readonly RideBlock[],
  hrMax: number | null,
): RideSummary {
  const power = stats(samples.power);
  const cadence = stats(samples.cadence);
  const hr = stats(samples.heartRate);
  let joules = 0;
  let anyPower = false;
  for (const w of samples.power) {
    if (w === null) continue;
    joules += w * RIDE_SAMPLE_SEC;
    anyPower = true;
  }
  let measured = 0;
  let weighted = 0;
  for (const b of blocks) {
    measured += b.measuredSec;
    weighted += b.score * b.measuredSec;
  }
  return {
    ridingSec: samples.power.length * RIDE_SAMPLE_SEC,
    avgPowerW: power.avg,
    maxPowerW: power.max,
    normalizedPowerW: normalizedPower(samples.power),
    workKj: anyPower ? Math.round(joules / 100) / 10 : null,
    avgCadence: cadence.avg,
    maxCadence: cadence.max,
    avgHr: hr.avg,
    maxHr: hr.max,
    hrZoneSec: hrZoneSeconds(samples.heartRate, hrMax),
    executionPct: measured > 0 ? Math.round(weighted / measured) : null,
    blocksMet: blocks.filter((b) => b.met).length,
    blocksTotal: blocks.length,
  };
}
