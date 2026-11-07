/**
 * GetSongBPM client (https://getsongbpm.com/api): tempo of a song by title and artist, and songs
 * at a given tempo. Numbers and links only; no audio. Needs the user's own API key, which is sent
 * as `api_key` (a simple GET, so browsers need no CORS preflight) and never logged or put into an
 * error. Results are cached locally; the app keeps itself under the 3000 requests per hour limit
 * and stops asking for an hour when the API says no. Attribution: the UI links to getsongbpm.com.
 */
import { BPM_MAX, BPM_MIN } from '../../../domain/bpm-match';

export const GETSONGBPM_BASE = 'https://api.getsong.co';
export const GETSONGBPM_SITE = 'https://getsongbpm.com';

export type GetSongBpmErrorKind =
  'no-key' | 'unauthorized' | 'rate-limited' | 'blocked' | 'network' | 'bad-response';

export class GetSongBpmError extends Error {
  constructor(readonly kind: GetSongBpmErrorKind) {
    super(`GetSongBPM: ${kind}`);
    this.name = 'GetSongBpmError';
  }
}

export interface BpmHit {
  title: string;
  artist?: string;
  bpm: number;
  /** Page of the song on getsongbpm.com. */
  url: string;
}

export interface BpmQuery {
  title: string;
  artist?: string;
}

/** Minimal sync string storage (localStorage-shaped); injected in tests. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ClientOptions {
  apiKey: string;
  fetch?: typeof fetch;
  now?: () => number;
  storage?: KeyValueStorage | undefined;
  /** Own ceiling, below the API's 3000 per hour. */
  maxPerHour?: number;
  timeoutMs?: number;
}

export interface GetSongBpmClient {
  /** Tempo of one song, or undefined when the database does not know it. */
  lookupBpm(query: BpmQuery): Promise<BpmHit | undefined>;
  /** Popular songs at this tempo (40-220). */
  findByBpm(bpm: number, limit?: number): Promise<BpmHit[]>;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const FOUND_TTL_MS = 30 * DAY_MS;
const MISSING_TTL_MS = DAY_MS;
const LIST_TTL_MS = DAY_MS;
const MAX_ENTRIES = 300;
const CACHE_KEY = 'hypercycling.getsongbpm.cache';

interface CacheEntry {
  at: number;
  ttl: number;
  /** `null` = looked up, not found. */
  v: unknown;
}
interface CacheFile {
  entries: Record<string, CacheEntry>;
  /** The API refused us; no requests before this time. */
  blockedUntil?: number;
}

function defaultStorage(): KeyValueStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function parseTempo(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  const r = Math.round(n);
  return Number.isFinite(r) && r >= BPM_MIN && r <= BPM_MAX ? r : undefined;
}

/** Only links to the service itself are kept (the data comes from outside). */
function safeUrl(v: unknown): string | undefined {
  return typeof v === 'string' && v.startsWith(`${GETSONGBPM_SITE}/`) ? v : undefined;
}

function artistName(v: unknown): string | undefined {
  const name = asRecord(v)?.name;
  return typeof name === 'string' && name ? name : undefined;
}

function toHit(item: unknown, kind: 'search' | 'tempo'): BpmHit | undefined {
  const o = asRecord(item);
  if (!o) return undefined;
  const title = kind === 'search' ? o.title : o.song_title;
  const url = safeUrl(kind === 'search' ? o.uri : o.song_uri);
  const bpm = parseTempo(o.tempo);
  if (typeof title !== 'string' || !title || bpm === undefined || !url) return undefined;
  const artist = artistName(o.artist);
  return { title, ...(artist ? { artist } : {}), bpm, url };
}

/** Prefers the result whose title (and artist) equals the query; else the first usable one. */
function pickBest(hits: BpmHit[], query: BpmQuery): BpmHit | undefined {
  const title = normalizeForMatch(query.title);
  const artist = query.artist ? normalizeForMatch(query.artist) : undefined;
  const sameTitle = hits.filter((h) => normalizeForMatch(h.title) === title);
  const exact = sameTitle.find(
    (h) => artist !== undefined && h.artist && normalizeForMatch(h.artist) === artist,
  );
  return exact ?? sameTitle[0] ?? hits[0];
}

export function createGetSongBpmClient(opts: ClientOptions): GetSongBpmClient {
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const now = opts.now ?? Date.now;
  const storage = 'storage' in opts ? opts.storage : defaultStorage();
  const maxPerHour = opts.maxPerHour ?? 2500;
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const apiKey = opts.apiKey.trim();
  const sent: number[] = [];

  const readFile = (): CacheFile => {
    try {
      const raw = storage?.getItem(CACHE_KEY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : undefined;
      const entries = asRecord(asRecord(parsed)?.entries);
      const blockedUntil = asRecord(parsed)?.blockedUntil;
      return {
        entries: (entries ?? {}) as Record<string, CacheEntry>,
        ...(typeof blockedUntil === 'number' ? { blockedUntil } : {}),
      };
    } catch {
      return { entries: {} };
    }
  };
  const writeFile = (file: CacheFile): void => {
    const keys = Object.keys(file.entries);
    if (keys.length > MAX_ENTRIES) {
      keys
        .sort((a, b) => (file.entries[a]?.at ?? 0) - (file.entries[b]?.at ?? 0))
        .slice(0, keys.length - MAX_ENTRIES)
        .forEach((k) => delete file.entries[k]);
    }
    try {
      storage?.setItem(CACHE_KEY, JSON.stringify(file));
    } catch {
      /* full or blocked storage: the cache is only an optimisation */
    }
  };
  const cached = (key: string): { v: unknown } | undefined => {
    const e = readFile().entries[key];
    return e && now() - e.at < e.ttl ? { v: e.v } : undefined;
  };
  const remember = (key: string, v: unknown, ttl: number): void => {
    const file = readFile();
    file.entries[key] = { at: now(), ttl, v };
    writeFile(file);
  };
  const block = (): void => {
    const file = readFile();
    file.blockedUntil = now() + HOUR_MS;
    writeFile(file);
  };

  async function request(path: string, params: Record<string, string>): Promise<unknown> {
    if (!apiKey) throw new GetSongBpmError('no-key');
    const blockedUntil = readFile().blockedUntil;
    if (blockedUntil !== undefined && now() < blockedUntil) throw new GetSongBpmError('blocked');
    const t = now();
    while (sent.length > 0 && t - (sent[0] as number) >= HOUR_MS) sent.shift();
    if (sent.length >= maxPerHour) throw new GetSongBpmError('rate-limited');
    sent.push(t);

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
      const query = new URLSearchParams({ api_key: apiKey, ...params });
      const res = await doFetch(`${GETSONGBPM_BASE}${path}?${query.toString()}`, {
        signal: abort.signal,
        referrerPolicy: 'no-referrer',
        credentials: 'omit',
      });
      if (res.status === 401) throw new GetSongBpmError('unauthorized');
      if (res.status === 429 || res.status === 403) {
        block();
        throw new GetSongBpmError(res.status === 429 ? 'rate-limited' : 'blocked');
      }
      if (!res.ok) throw new GetSongBpmError('bad-response');
      try {
        return (await res.json()) as unknown;
      } catch {
        throw new GetSongBpmError('bad-response');
      }
    } catch (err) {
      if (err instanceof GetSongBpmError) throw err;
      throw new GetSongBpmError('network');
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async lookupBpm(query) {
      const title = query.title.trim();
      if (!title) return undefined;
      const artist = query.artist?.trim();
      const key = `s:${normalizeForMatch(title)}|${normalizeForMatch(artist ?? '')}`;
      const hit = cached(key);
      if (hit) return hit.v === null ? undefined : (hit.v as BpmHit);
      const body = await request('/search/', {
        type: 'both',
        lookup: `song:${title}${artist ? ` artist:${artist}` : ''}`,
        limit: '5',
      });
      const list = asRecord(body)?.search;
      // "No result" comes back as an object, not an array.
      const hits = Array.isArray(list)
        ? list.map((x) => toHit(x, 'search')).filter((h): h is BpmHit => h !== undefined)
        : [];
      const best = pickBest(hits, { title, ...(artist ? { artist } : {}) });
      remember(key, best ?? null, best ? FOUND_TTL_MS : MISSING_TTL_MS);
      return best;
    },

    async findByBpm(bpm, limit = 20) {
      const target = Math.round(bpm);
      if (target < BPM_MIN || target > BPM_MAX) return [];
      const key = `t:${target}:${limit}`;
      const hit = cached(key);
      if (hit) return hit.v as BpmHit[];
      const body = await request('/tempo/', { bpm: String(target), limit: String(limit) });
      const list = asRecord(body)?.tempo;
      const hits = Array.isArray(list)
        ? list.map((x) => toHit(x, 'tempo')).filter((h): h is BpmHit => h !== undefined)
        : [];
      remember(key, hits, LIST_TTL_MS);
      return hits;
    },
  };
}
