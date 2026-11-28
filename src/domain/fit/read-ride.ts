/**
 * FIT activity file -> RawRide: the readings of every `record` message (time, power, cadence,
 * heart rate, speed, altitude, distance, position), the timer events, the laps, the sport and
 * the device's profile values as hints. Field numbers, scales and enum values are the public FIT
 * profile's. Clean-up (junk values, pauses, 1 Hz) is the next step's job, not this one's.
 */

import type {
  RawLap,
  RawRide,
  RawSample,
  RideHints,
  RideImportWarning,
  RideMeta,
  RideReadResult,
  RideSport,
  TimerEvent,
} from '../ride-import/types';
import { decodeFit, FIT_TIMESTAMP_FIELD as TS, type FitMessage, type FitRawValue } from './decode';
import { FIT_EPOCH_UNIX_SEC } from './writer';

// Global message numbers.
const FILE_ID = 0;
const USER_PROFILE = 3;
const ZONES_TARGET = 7;
const SPORT = 12;
const SESSION = 18;
const LAP = 19;
const RECORD = 20;
const EVENT = 21;
const WANTED = new Set([FILE_ID, USER_PROFILE, ZONES_TARGET, SPORT, SESSION, LAP, RECORD, EVENT]);

const FILE_TYPE_ACTIVITY = 4;
const EVENT_TIMER = 0;
const EVENT_TYPE_START = 0;
/** stop, stop_all, stop_disable, stop_disable_all */
const EVENT_TYPES_STOP = new Set([1, 4, 8, 9]);
const SPORT_RUNNING = 1;
const SPORT_CYCLING = 2;
const SUB_SPORT_INDOOR_CYCLING = 6;
const SUB_SPORT_VIRTUAL_ACTIVITY = 58;

/** Makers by their FIT manufacturer number; anything else stays unnamed. */
const MANUFACTURERS: Record<number, string> = {
  1: 'Garmin',
  15: 'Garmin', // Dynastream (Garmin's ANT+ company)
  13: 'Garmin', // Dynastream OEM
  23: 'Suunto',
  32: 'Wahoo',
  69: 'Stages',
  89: 'Tacx',
  255: 'HyperCycling', // "development": what our own exporter writes
  260: 'Zwift',
};

/**
 * Readings beyond this many mean a ride far longer than 12 hours even at 4 per second; refusing
 * them keeps a hostile or broken file from filling the memory.
 */
export const MAX_RAW_SAMPLES = 12 * 3600 * 4;

const SEMICIRCLE_DEG = 180 / 2 ** 31;

function num(m: FitMessage, field: number): number | undefined {
  const v: FitRawValue | undefined = m.fields[field];
  return typeof v === 'number' ? v : undefined;
}

function unixMs(fitTs: number | undefined): number | undefined {
  return fitTs === undefined ? undefined : (fitTs + FIT_EPOCH_UNIX_SEC) * 1000;
}

/** Scaled value: raw / scale - offset, or undefined. */
function scaled(raw: number | undefined, scale: number, offset = 0): number | undefined {
  return raw === undefined ? undefined : raw / scale - offset;
}

function inRange(v: number | undefined, min: number, max: number): number | undefined {
  return v !== undefined && v >= min && v <= max ? v : undefined;
}

function toSample(m: FitMessage): RawSample | undefined {
  const t = unixMs(num(m, TS));
  if (t === undefined) return undefined;
  const s: RawSample = { t };
  const lat = num(m, 0);
  const lon = num(m, 1);
  // Enhanced fields (wider range) win over the plain ones when both are there.
  const altitude = scaled(num(m, 78) ?? num(m, 2), 5, 500);
  const heartRate = num(m, 3);
  const cadence = num(m, 4);
  const fraction = num(m, 53);
  const distance = scaled(num(m, 5), 100);
  const speed = scaled(num(m, 73) ?? num(m, 6), 1000);
  const power = num(m, 7);
  if (power !== undefined) s.power = power;
  if (cadence !== undefined) s.cadence = cadence + (fraction ?? 0) / 128;
  if (heartRate !== undefined) s.heartRate = heartRate;
  if (speed !== undefined) s.speed = speed;
  if (altitude !== undefined) s.altitude = altitude;
  if (distance !== undefined) s.distance = distance;
  if (lat !== undefined && lon !== undefined) {
    s.lat = lat * SEMICIRCLE_DEG;
    s.lon = lon * SEMICIRCLE_DEG;
  }
  return s;
}

function sportOf(sport: number | undefined): RideSport | undefined {
  if (sport === undefined) return undefined;
  if (sport === SPORT_CYCLING) return 'cycling';
  if (sport === SPORT_RUNNING) return 'running';
  return 'other';
}

/** Reads a FIT activity file. Never throws; damage becomes a warning when the records survive. */
export function readFitRide(bytes: Uint8Array): RideReadResult {
  const decoded = decodeFit(bytes, { wanted: WANTED });
  if (!decoded.ok) return { ok: false, error: { code: 'fitCorrupt' } };

  const warnings = new Set<RideImportWarning>();
  for (const issue of decoded.issues) {
    if (issue === 'headerCrc' || issue === 'fileCrc') warnings.add('fitChecksum');
    else if (issue === 'truncated' || issue === 'badMessage') warnings.add('fitIncomplete');
  }

  const samples: RawSample[] = [];
  const timer: TimerEvent[] = [];
  const laps: RawLap[] = [];
  const meta: RideMeta = {};
  const hints: RideHints = {};
  let fileType: number | undefined;
  let fileCreated: number | undefined;
  let untimed = 0;
  let sessionSeen = false;
  let sport: number | undefined;
  let subSport: number | undefined;

  for (const m of decoded.messages) {
    switch (m.global) {
      case RECORD: {
        if (samples.length >= MAX_RAW_SAMPLES) return { ok: false, error: { code: 'tooLong' } };
        const s = toSample(m);
        if (s) samples.push(s);
        else untimed += 1;
        break;
      }
      case EVENT: {
        const t = unixMs(num(m, TS));
        const type = num(m, 1);
        if (t === undefined || num(m, 0) !== EVENT_TIMER || type === undefined) break;
        if (type === EVENT_TYPE_START) timer.push({ t, running: true });
        else if (EVENT_TYPES_STOP.has(type)) timer.push({ t, running: false });
        break;
      }
      case LAP: {
        const start = unixMs(num(m, 2));
        const end = unixMs(num(m, TS));
        if (start !== undefined && end !== undefined && end >= start) laps.push({ start, end });
        break;
      }
      case FILE_ID:
        fileType ??= num(m, 0);
        fileCreated ??= unixMs(num(m, 4));
        meta.device ??= MANUFACTURERS[num(m, 1) ?? -1];
        break;
      case SESSION:
        // A multi-sport file has one session per sport; the first one describes the ride.
        if (sessionSeen) break;
        sessionSeen = true;
        sport = num(m, 5) ?? sport;
        subSport = num(m, 6) ?? subSport;
        meta.startedAt = unixMs(num(m, 2));
        meta.totalElapsedSec = scaled(num(m, 7), 1000);
        meta.totalTimerSec = scaled(num(m, 8), 1000);
        meta.totalDistanceM = scaled(num(m, 9), 100);
        hints.ftpW ??= inRange(num(m, 45), 50, 2000);
        break;
      case SPORT: {
        sport ??= num(m, 0);
        subSport ??= num(m, 1);
        const name = m.fields[3];
        if (typeof name === 'string' && name.trim() !== '') meta.name ??= name.trim();
        break;
      }
      case ZONES_TARGET:
        hints.hrMaxBpm ??= inRange(num(m, 1), 100, 240);
        hints.ftpW = inRange(num(m, 3), 50, 2000) ?? hints.ftpW;
        break;
      case USER_PROFILE:
        hints.age ??= inRange(num(m, 1), 5, 120);
        hints.weightKg ??= inRange(scaled(num(m, 4), 10), 20, 300);
        break;
    }
  }

  if (fileType !== undefined && fileType !== FILE_TYPE_ACTIVITY) {
    return { ok: false, error: { code: 'fitNotActivity', fileType } };
  }
  if (samples.length === 0) {
    // Nothing readable at all from a damaged file is a damaged file, not an empty ride.
    const damaged = warnings.has('fitIncomplete') || warnings.has('fitChecksum');
    return { ok: false, error: { code: damaged ? 'fitCorrupt' : 'noSamples' } };
  }
  if (untimed > 0) warnings.add('samplesWithoutTime');

  samples.sort((a, b) => a.t - b.t);
  timer.sort((a, b) => a.t - b.t);
  laps.sort((a, b) => a.start - b.start);

  meta.sport = sportOf(sport);
  if (meta.sport === 'running' || meta.sport === 'other') warnings.add('notCycling');
  if (subSport === SUB_SPORT_INDOOR_CYCLING || subSport === SUB_SPORT_VIRTUAL_ACTIVITY) {
    meta.indoor = true;
  }
  meta.startedAt ??= fileCreated ?? samples[0]?.t;
  for (const key of Object.keys(meta) as (keyof RideMeta)[]) {
    if (meta[key] === undefined) delete meta[key];
  }
  for (const key of Object.keys(hints) as (keyof RideHints)[]) {
    if (hints[key] === undefined) delete hints[key];
  }

  const ride: RawRide = { format: 'fit', samples, timer, laps, meta, hints };
  return { ok: true, ride, warnings: [...warnings] };
}
