/**
 * Background tempo tagging for the imported songs (M19b). One song at a time, with a pause
 * between songs, through the same lookup the editor uses (GetSongBPM with the rider's key,
 * Deezer only when the rider turned it on in Settings), so the providers' own hourly ceilings
 * (2500 / 600) and their 1 h stop after 429/403 still apply. The queue itself stops on the first
 * "no" from a provider and never retries it. The list is the state: a stopped or aborted run
 * is resumed by running again, which skips every song that already has a fresh answer.
 */
import type { BpmQuery } from '../getsongbpm/client';
import { trackQuery } from '../getsongbpm/query';
import { errorInfo, type ErrorInfo } from '../provider-labels';
import type { TempoResult } from '../bpmLookup';
import { needsTag, type LibraryTrack } from './library';

/** Provider answers that mean "stop asking": the same ones the single clients stop on. */
const STOP_KINDS = new Set<ErrorInfo['kind']>([
  'rate-limited',
  'forbidden',
  'blocked',
  'unauthorized',
  'no-key',
]);
/** Network or format trouble in a row: the provider (or the connection) is down. */
const MAX_CONSECUTIVE_FAILURES = 5;
export const DEFAULT_PACE_MS = 800;

export interface TagProgress {
  /** Songs handled in this run, of those that needed it at the start. */
  done: number;
  total: number;
  tagged: number;
  missed: number;
  failed: number;
  current?: LibraryTrack;
}

export type TagOutcome =
  | { status: 'finished'; progress: TagProgress }
  | { status: 'aborted'; progress: TagProgress }
  | { status: 'stopped'; progress: TagProgress; reason: ErrorInfo };

export interface TagQueueOptions {
  /** Reads the latest list; the queue works through a snapshot of the songs that need a tempo. */
  getTracks: () => LibraryTrack[];
  /** Applies the result for one song (by id) to the stored list. */
  patch: (id: string, change: (t: LibraryTrack) => LibraryTrack) => void;
  lookup: (query: BpmQuery) => Promise<TempoResult | undefined>;
  signal: AbortSignal;
  onProgress?: (p: TagProgress) => void;
  now?: () => number;
  paceMs?: number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export function sleepAbortable(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

export async function runTagQueue(opts: TagQueueOptions): Promise<TagOutcome> {
  const now = opts.now ?? Date.now;
  const pace = opts.paceMs ?? DEFAULT_PACE_MS;
  const sleep = opts.sleep ?? sleepAbortable;
  const todo = opts
    .getTracks()
    .filter((t) => needsTag(t, now()))
    .map((t) => t.id);
  const progress: TagProgress = { done: 0, total: todo.length, tagged: 0, missed: 0, failed: 0 };
  const emit = (current?: LibraryTrack): void => {
    opts.onProgress?.({ ...progress, ...(current ? { current } : {}) });
  };
  emit();
  let streak = 0;
  for (const id of todo) {
    if (opts.signal.aborted) return { status: 'aborted', progress };
    // The rider may have typed a tempo or removed the song meanwhile: look at the latest list.
    const track = opts.getTracks().find((t) => t.id === id);
    if (!track || !needsTag(track, now())) {
      progress.done++;
      continue;
    }
    emit(track);
    const query = trackQuery({
      provider: 'spotify',
      title: track.title,
      ...(track.artist ? { artist: track.artist } : {}),
    });
    if (!query) {
      opts.patch(id, (t) => ({ ...t, missAt: now() }));
      progress.missed++;
      progress.done++;
      continue;
    }
    try {
      const hit = await opts.lookup(query);
      streak = 0;
      const at = now();
      if (hit) {
        // A tempo typed while the request was in flight wins.
        opts.patch(id, (t) =>
          t.bpmSource === 'manual' && t.bpm !== undefined
            ? t
            : { ...t, bpm: hit.bpm, bpmSource: hit.source, taggedAt: at },
        );
        progress.tagged++;
      } else {
        opts.patch(id, (t) => ({ ...t, missAt: at }));
        progress.missed++;
      }
      progress.done++;
    } catch (err) {
      const info = errorInfo(err);
      if (STOP_KINDS.has(info.kind)) {
        emit();
        return { status: 'stopped', progress, reason: info };
      }
      progress.failed++;
      progress.done++;
      if (++streak >= MAX_CONSECUTIVE_FAILURES) {
        emit();
        return { status: 'stopped', progress, reason: info };
      }
    }
    emit();
    if (progress.done < progress.total) await sleep(pace, opts.signal);
  }
  if (opts.signal.aborted) return { status: 'aborted', progress };
  emit();
  return { status: 'finished', progress };
}
