/**
 * Deezer client (https://developers.deezer.com/api): tempo of a song by title and artist, no key.
 *
 * api.deezer.com sends no CORS headers (checked 2026-11-07), so `fetch` cannot read it from a
 * browser. It does answer JSONP (`output=jsonp&callback=name`), so each request is a short-lived
 * <script> tag; that is why `script-src` lists api.deezer.com (src/shared/csp.ts). The callback
 * name is generated here, never taken from data. `bpm` is optional in Deezer's data and 0 means
 * "unknown" (treated as not found). Results are cached locally. Terms: non-commercial use, and
 * Deezer's logos are off limits, so the UI shows the plain text "Deezer" with a link only.
 */
import { BPM_MAX, BPM_MIN } from '../../../domain/bpm-match';
import {
  asRecord,
  GetSongBpmError,
  identity,
  type BpmQuery,
  type KeyValueStorage,
} from '../getsongbpm/client';

export const DEEZER_BASE = 'https://api.deezer.com';
export const DEEZER_SITE = 'https://www.deezer.com';

export interface DeezerHit {
  title: string;
  artist?: string;
  bpm: number;
  /** Page of the track on deezer.com. */
  url: string;
}

export interface DeezerClient {
  /** Tempo of one song, or undefined when Deezer does not know it (or has no tempo for it). */
  lookupBpm(query: BpmQuery): Promise<DeezerHit | undefined>;
  /** Songs matching a free search (artist and/or title), each with a tempo; may be empty. */
  searchSongs(query: BpmQuery, limit?: number): Promise<DeezerHit[]>;
}

/** Loads a JSONP URL; `url` builds it for the callback name the loader generated. */
export type JsonpLoader = (
  url: (callback: string) => string,
  timeoutMs: number,
) => Promise<unknown>;

export interface DeezerOptions {
  jsonp?: JsonpLoader;
  now?: () => number;
  storage?: KeyValueStorage | undefined;
  timeoutMs?: number;
  /** Own ceiling, well below Deezer's 50 requests per 5 seconds. */
  maxPerHour?: number;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const FOUND_TTL_MS = 30 * DAY_MS;
const MISSING_TTL_MS = 7 * DAY_MS;
const MAX_ENTRIES = 300;
const CACHE_KEY = 'hypercycling.deezer.cache';
const MAX_CANDIDATES = 3;
const SEARCH_DEFAULT_LIMIT = 5;

let counter = 0;

/** Real loader: a <script> tag and a one-shot global callback, both removed afterwards. */
export const scriptJsonp: JsonpLoader = (url, timeoutMs) =>
  new Promise((resolve, reject) => {
    const name = `__hcDeezer${Date.now().toString(36)}${counter++}`;
    const w = window as unknown as Record<string, unknown>;
    const script = document.createElement('script');
    const done = (): void => {
      clearTimeout(timer);
      delete w[name];
      script.remove();
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error('timeout'));
    }, timeoutMs);
    w[name] = (data: unknown) => {
      done();
      resolve(data);
    };
    script.onerror = () => {
      done();
      reject(new Error('load'));
    };
    script.async = true;
    script.referrerPolicy = 'no-referrer';
    script.src = url(name);
    document.head.appendChild(script);
  });

function defaultStorage(): KeyValueStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** Deezer gives fractional tempos (171.6); 0, missing or out of range means no data. */
function parseDeezerBpm(v: unknown): number | undefined {
  if (typeof v !== 'number') return undefined;
  const r = Math.round(v);
  return Number.isFinite(r) && r >= BPM_MIN && r <= BPM_MAX ? r : undefined;
}

function safeUrl(v: unknown): string | undefined {
  return typeof v === 'string' && v.startsWith(`${DEEZER_SITE}/`) ? v : undefined;
}

function validHit(v: unknown): v is DeezerHit {
  const o = asRecord(v);
  return (
    o !== undefined &&
    typeof o.title === 'string' &&
    o.title !== '' &&
    (o.artist === undefined || typeof o.artist === 'string') &&
    parseDeezerBpm(o.bpm) === o.bpm &&
    safeUrl(o.url) === o.url
  );
}

interface Candidate {
  id: number;
  title: string;
  artist: string | undefined;
}

function candidates(body: unknown, query: BpmQuery): Candidate[] {
  const data = asRecord(body)?.data;
  if (!Array.isArray(data)) return [];
  const title = identity(query.title);
  const artist = query.artist ? identity(query.artist) : undefined;
  const list: Candidate[] = [];
  for (const item of data) {
    const o = asRecord(item);
    const id = o?.id;
    const t = o?.title;
    if (typeof id !== 'number' || !Number.isInteger(id) || typeof t !== 'string') continue;
    const name = asRecord(o?.artist)?.name;
    list.push({ id, title: t, artist: typeof name === 'string' ? name : undefined });
  }
  // A different title is a different song (cover, medley): no match beats somebody else's tempo.
  const same = list.filter((c) => identity(c.title) === title);
  const exact = same.filter(
    (c) => artist !== undefined && c.artist !== undefined && identity(c.artist) === artist,
  );
  return [...exact, ...same.filter((c) => !exact.includes(c))].slice(0, MAX_CANDIDATES);
}

type CacheValue = DeezerHit | DeezerHit[] | null;
type CacheMap = Record<string, { at: number; ttl: number; v: CacheValue }>;

export function createDeezerClient(opts: DeezerOptions = {}): DeezerClient {
  const load = opts.jsonp ?? scriptJsonp;
  const now = opts.now ?? Date.now;
  const storage = 'storage' in opts ? opts.storage : defaultStorage();
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const maxPerHour = opts.maxPerHour ?? 600;
  const sent: number[] = [];

  const readCache = (): CacheMap => {
    try {
      const raw = storage?.getItem(CACHE_KEY);
      const parsed = asRecord(raw ? (JSON.parse(raw) as unknown) : undefined);
      const out: CacheMap = {};
      for (const [k, e] of Object.entries(parsed ?? {})) {
        const o = asRecord(e);
        if (o && typeof o.at === 'number' && typeof o.ttl === 'number') {
          if (o.v === null) out[k] = { at: o.at, ttl: o.ttl, v: null };
          else if (k.startsWith('q:')) {
            if (Array.isArray(o.v) && o.v.every(validHit))
              out[k] = { at: o.at, ttl: o.ttl, v: o.v };
          } else if (validHit(o.v)) out[k] = { at: o.at, ttl: o.ttl, v: o.v };
        }
      }
      return out;
    } catch {
      return {};
    }
  };
  const remember = (key: string, v: CacheValue, ttl: number): void => {
    const all = readCache();
    all[key] = { at: now(), ttl, v };
    const keys = Object.keys(all).sort((a, b) => (all[a]?.at ?? 0) - (all[b]?.at ?? 0));
    keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES)).forEach((k) => delete all[k]);
    try {
      storage?.setItem(CACHE_KEY, JSON.stringify(all));
    } catch {
      /* full or blocked storage: the cache is only an optimisation */
    }
  };

  async function request(path: string, params: Record<string, string>): Promise<unknown> {
    const t = now();
    while (sent.length > 0 && t - (sent[0] as number) >= HOUR_MS) sent.shift();
    if (sent.length >= maxPerHour) throw new GetSongBpmError('rate-limited', 'deezer');
    sent.push(t);
    let body: unknown;
    try {
      body = await load((callback) => {
        const q = new URLSearchParams({ ...params, output: 'jsonp', callback });
        return `${DEEZER_BASE}${path}?${q.toString()}`;
      }, timeoutMs);
    } catch {
      throw new GetSongBpmError('network', 'deezer');
    }
    const record = asRecord(body);
    if (!record) throw new GetSongBpmError('bad-response', 'deezer');
    const error = asRecord(record.error);
    if (error) {
      // 800 = "no data" (unknown id); 4 = quota; anything else is an unexpected answer.
      if (error.code === 800) return undefined;
      throw new GetSongBpmError(error.code === 4 ? 'rate-limited' : 'bad-response', 'deezer');
    }
    return record;
  }

  return {
    async lookupBpm(query) {
      const title = query.title.trim();
      if (!title) return undefined;
      const artist = query.artist?.trim();
      const key = `s:${identity(title)}|${identity(artist ?? '')}`;
      const hit = readCache()[key];
      if (hit && now() - hit.at < hit.ttl && !Array.isArray(hit.v)) return hit.v ?? undefined;

      const found = await request('/search', {
        q: artist ? `${artist} ${title}` : title,
        limit: '10',
      });
      for (const c of candidates(found, { title, ...(artist ? { artist } : {}) })) {
        const track = asRecord(await request(`/track/${c.id}`, {}));
        const bpm = parseDeezerBpm(track?.bpm);
        const url = safeUrl(track?.link);
        // bpm 0 / missing = Deezer has no tempo for this one; try the next same-title candidate.
        if (bpm === undefined || !url) continue;
        const result: DeezerHit = {
          title: c.title,
          ...(c.artist ? { artist: c.artist } : {}),
          bpm,
          url,
        };
        remember(key, result, FOUND_TTL_MS);
        return result;
      }
      remember(key, null, MISSING_TTL_MS);
      return undefined;
    },

    async searchSongs(query, limit = SEARCH_DEFAULT_LIMIT) {
      const title = query.title.trim();
      const artist = query.artist?.trim();
      const text = [artist, title].filter(Boolean).join(' ');
      if (!text) return [];
      const n = Math.min(Math.max(Math.round(limit), 1), 10);
      const key = `q:${identity(text)}|${n}`;
      const hit = readCache()[key];
      if (hit && now() - hit.at < hit.ttl && Array.isArray(hit.v)) return hit.v;

      const found = asRecord(await request('/search', { q: text, limit: String(n) }));
      const data = Array.isArray(found?.data) ? (found.data as unknown[]) : [];
      const out: DeezerHit[] = [];
      for (const item of data) {
        const o = asRecord(item);
        const id = o?.id;
        const t = o?.title;
        if (typeof id !== 'number' || !Number.isInteger(id) || typeof t !== 'string' || !t)
          continue;
        const name = asRecord(o?.artist)?.name;
        const track = asRecord(await request(`/track/${id}`, {}));
        const bpm = parseDeezerBpm(track?.bpm);
        const url = safeUrl(track?.link);
        // No tempo in Deezer's data: nothing to offer for this one.
        if (bpm === undefined || !url) continue;
        out.push({
          title: t,
          ...(typeof name === 'string' && name ? { artist: name } : {}),
          bpm,
          url,
        });
      }
      remember(key, out, out.length > 0 ? FOUND_TTL_MS : MISSING_TTL_MS);
      return out;
    },
  };
}
