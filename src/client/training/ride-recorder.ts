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
  /** Wall-clock origin (epoch ms) of `timeMs` / `atMs`: the first sample or event; null before. */
  originMs: number | null;
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

/** The live values, or a reader called only when a sample is due (a second's power is taken then). */
export type LiveInput = RideSampleInput | (() => RideSampleInput);

export interface RideRecorder {
  /** The ride runs (start or resume) from now on the riding clock. */
  run(): void;
  /** The ride stops running (pause, end, leaving): catch up first, then stop the riding clock. */
  halt(input: LiveInput): void;
  /**
   * Adds every sample the riding clock says is due: the live values for the latest second and
   * null for seconds a late or throttled timer missed (a hidden tab), so the record keeps one
   * sample per real second of riding.
   */
  catchUp(input: LiveInput): void;
  /** Something happened at the current second of riding (now, or at a known earlier time). */
  event(kind: RideEventKind, atMs?: number): void;
  data(): RideBuffer;
}

/** A missing or nonsense reading is null, never 0 (no signal is not zero watts). */
function value(v: number | null): number | null {
  return v !== null && Number.isFinite(v) && v >= 0 ? v : null;
}

const SAMPLE_MS = RIDE_SAMPLE_SEC * 1000;

/**
 * The riding clock counts wall-clock time while the ride runs, like the session engine's own
 * clock (accumulated running time), but not the engine's workout position: skipping a block
 * forward or back moves the workout, not the time ridden.
 */
export function createRideRecorder(
  initial?: RideBuffer,
  now: () => number = () => Date.now(),
): RideRecorder {
  const samples = initial ? cloneSamples(initial.samples) : emptySamples();
  const events: RideEvent[] = initial ? initial.events.map((e) => ({ ...e })) : [];
  let originMs = initial?.originMs ?? null;
  let lastMs = Math.max(0, samples.timeMs.at(-1) ?? 0, events.at(-1)?.atMs ?? 0);
  /** Riding time before the current run (a resumed buffer counts its samples). */
  let accMs = samples.power.length * SAMPLE_MS;
  let runStart: number | null = null;

  /** Ms after the origin, never going back (a clock change must not reorder the record). */
  const stamp = (t: number): number => {
    originMs ??= t;
    lastMs = Math.max(lastMs, Math.round(t - originMs));
    return lastMs;
  };
  const push = (timeMs: number, input: RideSampleInput | null): void => {
    samples.timeMs.push(timeMs);
    samples.power.push(input ? value(input.powerW) : null);
    samples.cadence.push(input ? value(input.cadenceRpm) : null);
    samples.heartRate.push(input ? value(input.hrBpm) : null);
    samples.targetW.push(input ? value(input.targetW) : null);
    samples.segmentIndex.push(Math.max(0, input?.segmentIndex ?? samples.segmentIndex.at(-1) ?? 0));
  };
  const catchUp = (live: LiveInput): void => {
    if (runStart === null) return;
    const t = now();
    const due = Math.floor((accMs + Math.max(0, t - runStart)) / SAMPLE_MS);
    const missing = due - samples.power.length;
    if (missing <= 0) return;
    // Seconds nobody sampled: no data (null), each at its own second of wall-clock time.
    for (let k = missing - 1; k >= 1; k--) push(stamp(t - k * SAMPLE_MS), null);
    push(stamp(t), typeof live === 'function' ? live() : live);
  };
  return {
    run() {
      if (runStart !== null) return;
      runStart = now();
      originMs ??= runStart;
    },
    halt(input) {
      if (runStart === null) return;
      catchUp(input);
      accMs += Math.max(0, now() - runStart);
      runStart = null;
    },
    catchUp,
    event(kind, atMs) {
      const at = atMs !== undefined ? Math.max(0, Math.round(atMs)) : stamp(now());
      events.push({ atSec: samples.power.length * RIDE_SAMPLE_SEC, atMs: at, kind });
    },
    data: () => ({ originMs, samples, events }),
  };
}

function cloneSamples(s: RideSamples): RideSamples {
  return {
    timeMs: [...s.timeMs],
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
    startedAt: buffer.originMs !== null ? new Date(buffer.originMs).toISOString() : meta.startedAt,
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
  /** D21 results of the blocks closed so far, restored into the tracker after a reload. */
  blocks?: RideBlock[];
}

function isBuffer(v: unknown): v is StoredBuffer {
  if (typeof v !== 'object' || v === null) return false;
  const b = v as Record<string, unknown>;
  const s = b['samples'] as Record<string, unknown> | undefined;
  if (typeof b['workoutId'] !== 'string' || !Array.isArray(b['events'])) return false;
  if (typeof s !== 'object' || s === null || !Array.isArray(s['power'])) return false;
  if (b['originMs'] !== null && typeof b['originMs'] !== 'number') return false;
  const n = s['power'].length;
  return ['timeMs', 'cadence', 'heartRate', 'targetW', 'segmentIndex'].every(
    (k) => Array.isArray(s[k]) && (s[k] as unknown[]).length === n,
  );
}

/** Keeps the recording so a reload in the middle of a ride does not lose it. */
export function saveRideBuffer(
  workoutId: string,
  buffer: RideBuffer,
  blocks: readonly RideBlock[] = [],
): void {
  try {
    const stored: StoredBuffer = { workoutId, ...buffer, blocks: [...blocks] };
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
    return { originMs: parsed.originMs, samples: parsed.samples, events: parsed.events };
  } catch {
    return undefined;
  }
}

/** The D21 block results kept with the buffer (empty when none or not valid). */
export function loadRideBlocks(workoutId: string): RideBlock[] {
  try {
    const raw = readCompat(sessionStorage, BUFFER_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!isBuffer(parsed) || parsed.workoutId !== workoutId || !Array.isArray(parsed.blocks)) {
      return [];
    }
    return parsed.blocks.filter(
      (b): b is RideBlock =>
        typeof b === 'object' &&
        b !== null &&
        Number.isInteger(b.segmentIndex) &&
        typeof b.score === 'number' &&
        typeof b.met === 'boolean' &&
        typeof b.measuredSec === 'number',
    );
  } catch {
    return [];
  }
}

export function clearRideBuffer(): void {
  try {
    removeCompat(sessionStorage, BUFFER_KEY);
  } catch {
    // Storage blocked: nothing was kept either.
  }
}

/** File name for one ride's export (JSON or FIT), from its start time (local clock). */
export function rideFileName(
  ride: Pick<RideRecord, 'startedAt'>,
  extension: 'json' | 'fit' = 'json',
): string {
  const d = new Date(ride.startedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = Number.isNaN(d.getTime())
    ? 'ride'
    : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `hypercycling-ride-${stamp}.${extension}`;
}
