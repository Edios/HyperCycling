import {
  emptySamples,
  hasData,
  RIDE_SAMPLE_SEC,
  RIDE_SCHEMA_VERSION,
  summarizeRide,
  type RideBlock,
  type RideEvent,
  type RideEventKind,
  type RideRecord,
  type RideSamples,
} from '../../domain/ride';
import { readCompat, removeCompat } from '../data/storage-compat';

/** What the recorder holds during a ride (also the reload buffer in session storage). */
export interface RideBuffer {
  samples: RideSamples;
  events: RideEvent[];
}

export interface RideSampleInput {
  powerW: number | null;
  cadenceRpm: number | null;
  hrBpm: number | null;
  targetW: number | null;
  segmentIndex: number;
}

export interface RideRecorder {
  /** One second of riding. */
  sample(input: RideSampleInput): void;
  /** Something happened at the current second of riding. */
  event(kind: RideEventKind): void;
  data(): RideBuffer;
}

/** A missing or nonsense reading is null, never 0 (no signal is not zero watts). */
function value(v: number | null): number | null {
  return v !== null && Number.isFinite(v) && v >= 0 ? v : null;
}

export function createRideRecorder(initial?: RideBuffer): RideRecorder {
  const samples = initial ? cloneSamples(initial.samples) : emptySamples();
  const events: RideEvent[] = initial ? initial.events.map((e) => ({ ...e })) : [];
  return {
    sample(input) {
      samples.power.push(value(input.powerW));
      samples.cadence.push(value(input.cadenceRpm));
      samples.heartRate.push(value(input.hrBpm));
      samples.targetW.push(value(input.targetW));
      samples.segmentIndex.push(Math.max(0, input.segmentIndex));
    },
    event(kind) {
      events.push({ atSec: samples.power.length * RIDE_SAMPLE_SEC, kind });
    },
    data: () => ({ samples, events }),
  };
}

function cloneSamples(s: RideSamples): RideSamples {
  return {
    power: [...s.power],
    cadence: [...s.cadence],
    heartRate: [...s.heartRate],
    targetW: [...s.targetW],
    segmentIndex: [...s.segmentIndex],
  };
}

export interface RideMeta {
  id: string;
  workoutId: string;
  startedAt: string;
  endedAt: string;
  ftp: number | null;
  hrMax: number | null;
  blocks: readonly RideBlock[];
}

/** The ride record to keep, or null when no sensor sent anything (nothing worth saving). */
export function buildRideRecord(buffer: RideBuffer, meta: RideMeta): RideRecord | null {
  if (!hasData(buffer.samples)) return null;
  const blocks = meta.blocks.map(({ segmentIndex, score, met, measuredSec }) => ({
    segmentIndex,
    score,
    met,
    measuredSec,
  }));
  return {
    id: meta.id,
    schemaVersion: RIDE_SCHEMA_VERSION,
    sessionLogId: meta.id,
    workoutId: meta.workoutId,
    startedAt: meta.startedAt,
    endedAt: meta.endedAt,
    sampleSec: RIDE_SAMPLE_SEC,
    ftp: meta.ftp,
    hrMax: meta.hrMax,
    samples: cloneSamples(buffer.samples),
    events: buffer.events.map((e) => ({ ...e })),
    blocks,
    summary: summarizeRide(buffer.samples, blocks, meta.hrMax),
  };
}

// ---- reload buffer ------------------------------------------------------------------------------

const BUFFER_KEY = 'hypercycling.rideBuffer';

interface StoredBuffer extends RideBuffer {
  workoutId: string;
}

function isBuffer(v: unknown): v is StoredBuffer {
  if (typeof v !== 'object' || v === null) return false;
  const b = v as Record<string, unknown>;
  const s = b['samples'] as Record<string, unknown> | undefined;
  if (typeof b['workoutId'] !== 'string' || !Array.isArray(b['events'])) return false;
  if (typeof s !== 'object' || s === null || !Array.isArray(s['power'])) return false;
  const n = s['power'].length;
  return ['cadence', 'heartRate', 'targetW', 'segmentIndex'].every(
    (k) => Array.isArray(s[k]) && (s[k] as unknown[]).length === n,
  );
}

/** Keeps the recording so a reload in the middle of a ride does not lose it. */
export function saveRideBuffer(workoutId: string, buffer: RideBuffer): void {
  try {
    const stored: StoredBuffer = { workoutId, ...buffer };
    sessionStorage.setItem(BUFFER_KEY, JSON.stringify(stored));
  } catch {
    // Storage full or blocked: the ride is still recorded in memory.
  }
}

/** The buffer of the same workout's ride, if one was kept. */
export function loadRideBuffer(workoutId: string): RideBuffer | undefined {
  try {
    const raw = readCompat(sessionStorage, BUFFER_KEY);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (!isBuffer(parsed) || parsed.workoutId !== workoutId) return undefined;
    return { samples: parsed.samples, events: parsed.events };
  } catch {
    return undefined;
  }
}

export function clearRideBuffer(): void {
  try {
    removeCompat(sessionStorage, BUFFER_KEY);
  } catch {
    // Storage blocked: nothing was kept either.
  }
}

/** File name for one ride's JSON export, from its start time (local clock). */
export function rideFileName(ride: Pick<RideRecord, 'startedAt'>): string {
  const d = new Date(ride.startedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = Number.isNaN(d.getTime())
    ? 'ride'
    : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `hypercycling-ride-${stamp}.json`;
}
