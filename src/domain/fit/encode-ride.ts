/**
 * RideRecord (T6) -> FIT activity file, for Strava, Garmin Connect, intervals.icu and friends.
 * A pure function: bytes in, bytes out. Field numbers and enum values are the public FIT profile's.
 *
 * What is in the file: file_id, timer events (a stop for every pause, a start for every resume),
 * one record per sample (heart rate, cadence, power; a missing reading is "invalid", never 0), one
 * lap per run of the same block, a cycling / indoor_cycling session and the activity. Not in the
 * file (the JSON export keeps them): the ERG target, the block results, signal and ERG events.
 * There is no GPS and no distance (a stationary ride).
 */

import type { RideRecord } from '../ride';
import { createFitWriter, fitTimestamp, type FitField, type FitValue } from './writer';

export interface FitOptions {
  /** Leave the heart rate out of the file (records, laps and session). Default: in. */
  includeHeartRate?: boolean;
  /** Local time minus UTC, in seconds, for the activity's local timestamp. Default 0. */
  utcOffsetSec?: number;
}

// Global message numbers (FIT profile).
const FILE_ID = 0;
const SESSION = 18;
const LAP = 19;
const RECORD = 20;
const EVENT = 21;
const ACTIVITY = 34;

// Enum values (FIT profile).
const FILE_TYPE_ACTIVITY = 4;
const MANUFACTURER_DEVELOPMENT = 255;
const EVENT_TIMER = 0;
const EVENT_SESSION = 8;
const EVENT_LAP = 9;
const EVENT_ACTIVITY = 26;
const EVENT_TYPE_START = 0;
const EVENT_TYPE_STOP = 1;
const EVENT_TYPE_STOP_ALL = 4;
const SPORT_CYCLING = 2;
const SUB_SPORT_INDOOR_CYCLING = 6;
const LAP_TRIGGER_MANUAL = 0;
const LAP_TRIGGER_SESSION_END = 7;
const ACTIVITY_TYPE_MANUAL = 0;

const PRODUCT_NAME = 'HyperCycling';

const TIMESTAMP: FitField = { num: 253, type: 'uint32' };
const MESSAGE_INDEX: FitField = { num: 254, type: 'uint16' };

/** A stable device serial from the ride id, so uploading the same ride twice is recognised. */
function serialOf(id: string): number {
  let hash = 0x811c9dc5; // FNV-1a, 32 bit
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash === 0 ? 1 : hash;
}

function avgMax(values: readonly (number | null)[]): { avg: number | null; max: number | null } {
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

interface Item {
  ts: number;
  /** Order within one second: timer start, then the record, then timer stop. */
  rank: 0 | 1 | 2;
  /** Sample index of a record; unset for a timer event. */
  sample?: number;
  /** Timer event: stop (true) or start (false). */
  stop?: boolean;
}

export function encodeRideToFit(ride: RideRecord, options: FitOptions = {}): Uint8Array {
  const withHr = options.includeHeartRate !== false;
  const startMs = Date.parse(ride.startedAt);
  const s = ride.samples;
  const n = s.power.length;

  // Strictly increasing whole-second timestamps for the samples (they are 1 Hz, but their clock
  // times are not exactly a second apart).
  const startTs = fitTimestamp(startMs);
  const ts: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const raw = fitTimestamp(startMs + (s.timeMs[i] ?? 0));
    ts.push(Math.max(raw, (ts[i - 1] ?? startTs) + 1));
  }
  const lastSampleTs = ts[n - 1] ?? startTs;

  // Timer events: running from the start, stopped by every pause, started again by a resume.
  const items: Item[] = [{ ts: startTs, rank: 0, stop: false }];
  let running = true;
  for (const e of [...ride.events].sort((a, b) => a.atMs - b.atMs)) {
    const at = Math.max(fitTimestamp(startMs + e.atMs), startTs);
    const isPause = e.kind === 'pause' || e.kind === 'autoPause' || e.kind === 'deviceStop';
    if (isPause && running) {
      running = false;
      items.push({ ts: at, rank: 2, stop: true });
    } else if (e.kind === 'resume' && !running) {
      running = true;
      items.push({ ts: at, rank: 0, stop: false });
    }
  }
  if (running) items.push({ ts: lastSampleTs, rank: 2, stop: true });
  for (let i = 0; i < n; i += 1) items.push({ ts: ts[i] ?? startTs, rank: 1, sample: i });
  items.sort((a, b) => a.ts - b.ts || a.rank - b.rank);

  const endTs = Math.max(lastSampleTs, ...items.map((it) => it.ts));
  // Timer time = the seconds that were ridden (one sample each); elapsed time includes pauses.
  const timerSec = n;
  const elapsedSec = Math.max(endTs - startTs, timerSec);

  const w = createFitWriter();
  const fileId = w.define(FILE_ID, [
    { num: 0, type: 'enum' },
    { num: 1, type: 'uint16' },
    { num: 2, type: 'uint16' },
    { num: 3, type: 'uint32z' },
    { num: 4, type: 'uint32' },
    { num: 8, type: 'string', size: PRODUCT_NAME.length + 1 },
  ]);
  w.write(fileId, [
    FILE_TYPE_ACTIVITY,
    MANUFACTURER_DEVELOPMENT,
    0,
    serialOf(ride.id),
    startTs,
    PRODUCT_NAME,
  ]);

  const event = w.define(EVENT, [TIMESTAMP, { num: 0, type: 'enum' }, { num: 1, type: 'enum' }]);
  const recordFields: FitField[] = [
    TIMESTAMP,
    ...(withHr ? [{ num: 3, type: 'uint8' } as const] : []),
    { num: 4, type: 'uint8' },
    { num: 7, type: 'uint16' },
  ];
  const record = w.define(RECORD, recordFields);

  for (const it of items) {
    if (it.sample === undefined) {
      w.write(event, [it.ts, EVENT_TIMER, it.stop ? EVENT_TYPE_STOP_ALL : EVENT_TYPE_START]);
      continue;
    }
    const i = it.sample;
    const values: FitValue[] = [
      it.ts,
      ...(withHr ? [s.heartRate[i]] : []),
      s.cadence[i],
      s.power[i],
    ];
    w.write(record, values);
  }

  // Laps: one per run of the same block.
  const runs: { from: number; to: number }[] = [];
  for (let i = 0; i < n; i += 1) {
    const last = runs[runs.length - 1];
    if (last && s.segmentIndex[i] === s.segmentIndex[i - 1]) last.to = i;
    else runs.push({ from: i, to: i });
  }
  const lap = w.define(LAP, [
    MESSAGE_INDEX,
    TIMESTAMP,
    { num: 0, type: 'enum' },
    { num: 1, type: 'enum' },
    { num: 2, type: 'uint32' },
    { num: 7, type: 'uint32' },
    { num: 8, type: 'uint32' },
    ...(withHr ? [{ num: 15, type: 'uint8' } as const, { num: 16, type: 'uint8' } as const] : []),
    { num: 17, type: 'uint8' },
    { num: 18, type: 'uint8' },
    { num: 19, type: 'uint16' },
    { num: 20, type: 'uint16' },
    { num: 24, type: 'enum' },
    { num: 25, type: 'enum' },
    { num: 39, type: 'enum' },
  ]);
  let lapStart = startTs;
  runs.forEach((run, index) => {
    const range = (a: readonly (number | null)[]) => a.slice(run.from, run.to + 1);
    const hr = avgMax(range(s.heartRate));
    const cad = avgMax(range(s.cadence));
    const pw = avgMax(range(s.power));
    const lapEnd = ts[run.to] ?? lapStart;
    w.write(lap, [
      index,
      lapEnd,
      EVENT_LAP,
      EVENT_TYPE_STOP,
      lapStart,
      (lapEnd - lapStart) * 1000,
      (run.to - run.from + 1) * 1000,
      ...(withHr ? [hr.avg, hr.max] : []),
      cad.avg,
      cad.max,
      pw.avg,
      pw.max,
      index === runs.length - 1 ? LAP_TRIGGER_SESSION_END : LAP_TRIGGER_MANUAL,
      SPORT_CYCLING,
      SUB_SPORT_INDOOR_CYCLING,
    ]);
    lapStart = lapEnd;
  });

  const sum = ride.summary;
  const session = w.define(SESSION, [
    MESSAGE_INDEX,
    TIMESTAMP,
    { num: 0, type: 'enum' },
    { num: 1, type: 'enum' },
    { num: 2, type: 'uint32' },
    { num: 5, type: 'enum' },
    { num: 6, type: 'enum' },
    { num: 7, type: 'uint32' },
    { num: 8, type: 'uint32' },
    ...(withHr ? [{ num: 16, type: 'uint8' } as const, { num: 17, type: 'uint8' } as const] : []),
    { num: 18, type: 'uint8' },
    { num: 19, type: 'uint8' },
    { num: 20, type: 'uint16' },
    { num: 21, type: 'uint16' },
    { num: 25, type: 'uint16' },
    { num: 26, type: 'uint16' },
    { num: 34, type: 'uint16' },
    { num: 45, type: 'uint16' },
    { num: 48, type: 'uint32' },
  ]);
  w.write(session, [
    0,
    endTs,
    EVENT_SESSION,
    EVENT_TYPE_STOP,
    startTs,
    SPORT_CYCLING,
    SUB_SPORT_INDOOR_CYCLING,
    elapsedSec * 1000,
    timerSec * 1000,
    ...(withHr ? [sum.avgHr, sum.maxHr] : []),
    sum.avgCadence,
    sum.maxCadence,
    sum.avgPowerW,
    sum.maxPowerW,
    0,
    runs.length,
    sum.normalizedPowerW,
    ride.ftp === null ? null : Math.round(ride.ftp),
    sum.workKj === null ? null : Math.round(sum.workKj * 1000),
  ]);

  const activity = w.define(ACTIVITY, [
    TIMESTAMP,
    { num: 0, type: 'uint32' },
    { num: 1, type: 'uint16' },
    { num: 2, type: 'enum' },
    { num: 3, type: 'enum' },
    { num: 4, type: 'enum' },
    { num: 5, type: 'uint32' },
  ]);
  w.write(activity, [
    endTs,
    timerSec * 1000,
    1,
    ACTIVITY_TYPE_MANUAL,
    EVENT_ACTIVITY,
    EVENT_TYPE_STOP,
    endTs + (options.utcOffsetSec ?? 0),
  ]);

  return w.finish();
}
