/**
 * "Check the music": before a ride, every recording of every slot is tried (oEmbed, then a muted
 * trial embed), so a blocked upload shows up on the spot and not in the middle of a song. The
 * result is kept on this device and sorts dead uploads to the end of their chain.
 */
import { trackKey } from '../../domain/music-chain';
import type { TrackRef } from '../../domain/workout';
import { checkYoutubeEmbeddable, type YoutubeCheck } from './youtube-check';
import { probeYoutube, type ProbeResult } from './youtube-probe';

export type RecordingStatus = 'ok' | 'dead' | 'unverified';
export type Health = 'green' | 'yellow' | 'red';

export interface RecordingResult {
  /** `provider:id` */
  key: string;
  status: RecordingStatus;
  /** Why it is dead / unverified: `blocked`, `missing`, `error:150`, `timeout`, `offline`, `spotify`. */
  reason?: string;
}

export type ResultMap = ReadonlyMap<string, RecordingResult>;

export interface PreflightDeps {
  oembed?: (id: string) => Promise<YoutubeCheck>;
  probe?: (id: string) => Promise<ProbeResult>;
  /** How many recordings are checked at the same time. */
  concurrency?: number;
}

/** Judges one YouTube recording from the oEmbed answer and the trial embed. */
export function judgeRecording(
  check: YoutubeCheck,
  probe: ProbeResult | undefined,
): {
  status: RecordingStatus;
  reason?: string;
} {
  if (check.status === 'blocked') return { status: 'dead', reason: 'blocked' };
  if (check.status === 'missing') return { status: 'dead', reason: 'missing' };
  if (probe?.kind === 'playing') return { status: 'ok' };
  if (probe?.kind === 'error') return { status: 'dead', reason: `error:${probe.code}` };
  // The trial did not finish: oEmbed liked it (or was unreachable), so it is likely but unproven.
  return {
    status: 'unverified',
    reason:
      probe?.kind === 'timeout' ? 'timeout' : check.status === 'unknown' ? 'offline' : 'no-trial',
  };
}

async function pool<T, R>(
  items: readonly T[],
  size: number,
  work: (x: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await work(items[i] as T);
    }
  });
  await Promise.all(runners);
  return out;
}

/** Checks each distinct recording once. Spotify recordings are not probed (matched playable). */
export async function checkRecordings(
  tracks: readonly TrackRef[],
  deps: PreflightDeps = {},
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, RecordingResult>> {
  const oembed = deps.oembed ?? ((id: string) => checkYoutubeEmbeddable(id));
  const probe = deps.probe ?? ((id: string) => probeYoutube(id));
  const distinct = [...new Map(tracks.map((t) => [trackKey(t), t])).values()];
  const results = new Map<string, RecordingResult>();
  let done = 0;
  await pool(distinct, deps.concurrency ?? 3, async (t) => {
    const key = trackKey(t);
    let result: RecordingResult;
    if (t.provider !== 'youtube') {
      result = { key, status: 'unverified', reason: 'spotify' };
    } else {
      const check = await oembed(t.id).catch((): YoutubeCheck => ({ status: 'unknown' }));
      // A video oEmbed already rejects needs no trial.
      const probed =
        check.status === 'blocked' || check.status === 'missing'
          ? undefined
          : await probe(t.id).catch((): ProbeResult => ({ kind: 'timeout' }));
      result = { key, ...judgeRecording(check, probed) };
    }
    results.set(key, result);
    onProgress?.(++done, distinct.length);
  });
  return results;
}

/**
 * Health of one song's chain, main recording first. Green: the main recording plays. Yellow: only
 * a backup plays (or the main one is unproven). Red: nothing in the chain plays.
 */
export function songHealth(chain: readonly TrackRef[], results: ResultMap): Health {
  const status = chain.map((t) => results.get(trackKey(t))?.status ?? 'unverified');
  if (status.length === 0 || status.every((s) => s === 'dead')) return 'red';
  return status[0] === 'ok' ? 'green' : 'yellow';
}

/** Health of a slot: its worst song. A slot without any song has nothing to play (red). */
export function slotHealth(queue: readonly TrackRef[], results: ResultMap): Health {
  if (queue.length === 0) return 'red';
  const all = queue.map((t) => songHealth([t, ...(t.alternates ?? [])], results));
  return all.includes('red') ? 'red' : all.includes('yellow') ? 'yellow' : 'green';
}

/** How many recordings of a song's chain are alive (ok or likely). */
export function liveCount(chain: readonly TrackRef[], results: ResultMap): number {
  return chain.filter((t) => (results.get(trackKey(t))?.status ?? 'unverified') !== 'dead').length;
}

// --- results kept on this device -------------------------------------------------------------

const KEY = 'hypercycling.music.check';
/** A result older than this is not trusted (blocks come and go). */
export const RESULT_TTL_MS = 7 * 24 * 3600 * 1000;

interface Stored {
  at: number;
  results: Record<string, RecordingResult>;
}

export function saveResults(results: ResultMap, at: number = Date.now()): void {
  try {
    const prev = readStored(at);
    const merged: Record<string, RecordingResult> = { ...prev };
    for (const [k, v] of results) merged[k] = v;
    const body: Stored = { at, results: merged };
    localStorage.setItem(KEY, JSON.stringify(body));
  } catch {
    // not kept this time
  }
}

function readStored(now: number): Record<string, RecordingResult> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (typeof parsed.at !== 'number' || now - parsed.at > RESULT_TTL_MS) return {};
    return parsed.results && typeof parsed.results === 'object' ? parsed.results : {};
  } catch {
    return {};
  }
}

/** Recordings the last music check on this device found dead (`provider:id`). */
export function deadRecordings(now: number = Date.now()): Set<string> {
  const out = new Set<string>();
  for (const [k, v] of Object.entries(readStored(now))) if (v?.status === 'dead') out.add(k);
  return out;
}

export const storedResults = (now: number = Date.now()): Map<string, RecordingResult> =>
  new Map(Object.entries(readStored(now)));
