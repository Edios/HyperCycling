import type { CandidateEvent } from './director';

/** One line of the music log: which recording of a song's chain played or failed. */
export interface MusicLogEntry {
  at: number;
  provider: 'spotify' | 'youtube';
  id: string;
  title: string;
  /** Place in the song's chain, 0 = the main recording. */
  index: number;
  outcome: 'played' | 'failed';
  error?: string;
}

const KEY = 'hypercycling.music.log';
export const MAX_LOG = 60;

let entries: MusicLogEntry[] | undefined;
const listeners = new Set<() => void>();

function load(): MusicLogEntry[] {
  if (entries) return entries;
  entries = [];
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      entries = parsed.filter(
        (e): e is MusicLogEntry =>
          typeof e === 'object' &&
          e !== null &&
          typeof (e as MusicLogEntry).id === 'string' &&
          typeof (e as MusicLogEntry).at === 'number',
      );
    }
  } catch {
    // a log that cannot be read is simply empty
  }
  return entries;
}

const notify = (): void => {
  for (const l of [...listeners]) l();
};

/** Records what the music director tried; never throws (the log must not touch a workout). */
export function logMusicEvent(e: CandidateEvent, at: number = Date.now()): void {
  const list = load();
  list.push({
    at,
    provider: e.track.provider,
    id: e.track.id,
    title: e.track.title,
    index: e.index,
    outcome: e.outcome,
    ...(e.error !== undefined
      ? { error: e.error instanceof Error ? e.error.message : String(e.error) }
      : {}),
  });
  while (list.length > MAX_LOG) list.shift();
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // storage full or blocked: the in-memory log still works
  }
  notify();
}

export const getMusicLog = (): readonly MusicLogEntry[] => load();

export function clearMusicLog(): void {
  entries = [];
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  notify();
}

export function subscribeMusicLog(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Plain text for the diagnostics report. */
export function formatMusicLog(list: readonly MusicLogEntry[]): string {
  return list
    .map(
      (e) =>
        `${new Date(e.at).toISOString()} ${e.outcome} #${e.index} ${e.provider}:${e.id} ${e.title}${e.error ? ` (${e.error})` : ''}`,
    )
    .join('\n');
}

/** Only for tests. */
export function resetMusicLogForTests(): void {
  entries = undefined;
  listeners.clear();
}
