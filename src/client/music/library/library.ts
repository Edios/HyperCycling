/**
 * The rider's imported songs (M19b): a local, per-device list of tracks from their own playlists
 * with a tempo per track. Only title, artist, the Spotify track id and a number are kept: no
 * audio, no covers, and nothing is sent anywhere but the two tempo providers (queue in
 * tag-queue.ts). A tempo found by a provider is good for 30 days (then it is asked again); a
 * tempo the rider typed never expires.
 */
import { BPM_MAX, BPM_MIN, rankTracks, type RankedTrack } from '../../../domain/bpm-match';
import type { BpmSource, TrackRef } from '../../../domain/workout';
import { readCompat } from '../../data/storage-compat';

export type LibrarySource = BpmSource | 'manual';

export interface LibraryTrack {
  /** Spotify track id (the library is built from Spotify playlists). */
  id: string;
  title: string;
  artist?: string;
  bpm?: number;
  /** Where `bpm` came from; 'manual' = typed by the rider. */
  bpmSource?: LibrarySource;
  /** When a provider answered (epoch ms): the 30 day clock. */
  taggedAt?: number;
  /** When every provider said "unknown": not asked again for 7 days. */
  missAt?: number;
}

const DAY_MS = 86_400_000;
export const TAG_TTL_MS = 30 * DAY_MS;
export const MISS_TTL_MS = 7 * DAY_MS;
/** Hard cap so a huge account cannot fill localStorage. */
export const MAX_LIBRARY = 1000;
const KEY = 'hypercycling.library.songs';
const MAX_TEXT = 200;

export function needsTag(t: LibraryTrack, now: number): boolean {
  if (t.bpmSource === 'manual' && t.bpm !== undefined) return false;
  if (t.bpm !== undefined && t.taggedAt !== undefined && now - t.taggedAt < TAG_TTL_MS)
    return false;
  if (t.missAt !== undefined && now - t.missAt < MISS_TTL_MS) return false;
  return true;
}

/** How many songs a tagging run would ask about right now. */
export function pendingCount(tracks: LibraryTrack[], now: number = Date.now()): number {
  return tracks.filter((t) => needsTag(t, now)).length;
}

/** Adds tracks not yet in the library (by id), keeping existing tempos; capped at MAX_LIBRARY. */
export function mergeTracks(
  current: LibraryTrack[],
  incoming: Pick<LibraryTrack, 'id' | 'title' | 'artist'>[],
): { tracks: LibraryTrack[]; added: number; truncated: boolean } {
  const have = new Set(current.map((t) => t.id));
  const out = [...current];
  let added = 0;
  let truncated = false;
  for (const t of incoming) {
    if (have.has(t.id)) continue;
    if (out.length >= MAX_LIBRARY) {
      truncated = true;
      break;
    }
    have.add(t.id);
    out.push({
      id: t.id,
      title: t.title.slice(0, MAX_TEXT),
      ...(t.artist ? { artist: t.artist.slice(0, MAX_TEXT) } : {}),
    });
    added++;
  }
  return { tracks: out, added, truncated };
}

/** The rider's correction: always wins, never expires. Out-of-range or empty clears the tempo. */
export function withManualBpm(t: LibraryTrack, bpm: number | undefined, now: number): LibraryTrack {
  const { bpm: _b, bpmSource: _s, taggedAt: _t, missAt: _m, ...rest } = t;
  void _b;
  void _s;
  void _t;
  void _m;
  if (bpm === undefined || !(bpm >= BPM_MIN && bpm <= BPM_MAX)) return rest;
  return { ...rest, bpm: Math.round(bpm), bpmSource: 'manual', taggedAt: now };
}

/** Library tracks that fit a cadence, best first (2 BPM = 1 RPM, half and double time too). */
export function suggestFor(
  tracks: LibraryTrack[],
  rpm: number | undefined,
): RankedTrack<LibraryTrack>[] {
  if (rpm === undefined) return [];
  return rankTracks(tracks, rpm);
}

/** A pin for a library track: the same shape 'Find a song' and the URL field produce. */
export function toTrackRef(t: LibraryTrack, startAtSec: number): TrackRef {
  return {
    provider: 'spotify',
    id: t.id,
    title: t.title,
    ...(t.artist ? { artist: t.artist } : {}),
    ...(t.bpm !== undefined ? { bpm: t.bpm } : {}),
    // A typed tempo carries no source (as in the editor's BPM field).
    ...(t.bpm !== undefined && t.bpmSource && t.bpmSource !== 'manual'
      ? { bpmSource: t.bpmSource }
      : {}),
    startAtSec,
  };
}

function valid(v: unknown): v is LibraryTrack {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  const num = (x: unknown): boolean =>
    x === undefined || (typeof x === 'number' && Number.isFinite(x));
  return (
    typeof o.id === 'string' &&
    /^[A-Za-z0-9]{1,40}$/.test(o.id) &&
    typeof o.title === 'string' &&
    o.title.length <= MAX_TEXT &&
    (o.artist === undefined || (typeof o.artist === 'string' && o.artist.length <= MAX_TEXT)) &&
    (o.bpm === undefined || (typeof o.bpm === 'number' && o.bpm >= BPM_MIN && o.bpm <= BPM_MAX)) &&
    (o.bpmSource === undefined ||
      o.bpmSource === 'manual' ||
      o.bpmSource === 'deezer' ||
      o.bpmSource === 'getsongbpm') &&
    num(o.taggedAt) &&
    num(o.missAt)
  );
}

type Storage_ = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): Storage_ | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export interface LibraryStore {
  get(): LibraryTrack[];
  set(next: LibraryTrack[]): void;
  /** Applies a change to the latest list (safe while a queue is running). */
  update(fn: (current: LibraryTrack[]) => LibraryTrack[]): void;
  subscribe(listener: () => void): () => void;
}

export function createLibraryStore(storage: Storage_ | undefined = defaultStorage()): LibraryStore {
  let cache: LibraryTrack[] | undefined;
  const listeners = new Set<() => void>();
  const load = (): LibraryTrack[] => {
    try {
      const raw = storage ? readCompat(storage, KEY) : null;
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter(valid).slice(0, MAX_LIBRARY) : [];
    } catch {
      return [];
    }
  };
  const store: LibraryStore = {
    get() {
      cache ??= load();
      return cache;
    },
    set(next) {
      cache = next;
      try {
        storage?.setItem(KEY, JSON.stringify(next));
      } catch {
        /* full or blocked storage: the list stays in memory for this page */
      }
      listeners.forEach((l) => l());
    },
    update(fn) {
      store.set(fn(store.get()));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return store;
}

let shared: LibraryStore | undefined;
export function getSharedLibraryStore(): LibraryStore {
  return (shared ??= createLibraryStore());
}
/** Tests swap in a store; no argument restores the default. */
export function setLibraryStoreForTests(store?: LibraryStore): void {
  shared = store;
}
