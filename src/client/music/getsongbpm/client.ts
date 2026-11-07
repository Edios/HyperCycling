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
  'no-key' | 'unauthorized' | 'rate-limited' | 'forbidden' | 'blocked' | 'network' | 'bad-response';

export class GetSongBpmError extends Error {
  /** `provider` tells the UI whose name to show; the Deezer client reuses this error type. */
  constructor(
    readonly kind: GetSongBpmErrorKind,
    readonly provider: 'getsongbpm' | 'deezer' = 'getsongbpm',
  ) {
    super(`${provider === 'deezer' ? 'Deezer' : 'GetSongBPM'}: ${kind}`);
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
  /** The API refused us; no requests before this time (only for the key named in blockedFor). */
  blockedUntil?: number;
  /** Fingerprint of the key that was refused; another key is not blocked. Not the key itself. */
  blockedFor?: string;
}

function defaultStorage(): KeyValueStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** Lowercase letters and digits of any script; accents folded; letters NFKD cannot split mapped. */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(
      /[łøđðþßæœ]/g,
      (c) => ({ ł: 'l', ø: 'o', đ: 'd', ð: 'd', þ: 'th', ß: 'ss', æ: 'ae', œ: 'oe' })[c] ?? c,
    )
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Cache identity of a text: its normal form, or the lowercased text when nothing letter-like is left. */
export function identity(text: string): string {
  return normalizeForMatch(text) || text.trim().toLowerCase();
}

/** Short non-reversible fingerprint (not a secret store): tells keys apart without keeping one. */
function fingerprint(key: string): string {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function asRecord(v: unknown): Record<string, unknown> | undefined {
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

/**
 * The result with the same title as the query (artist breaks ties). A different title is a
 * different song (cover, medley): no match is better than somebody else's tempo.
 */
function pickBest(hits: BpmHit[], query: BpmQuery): BpmHit | undefined {
  const title = identity(query.title);
  const artist = query.artist ? identity(query.artist) : undefined;
  const sameTitle = hits.filter((h) => identity(h.title) === title);
  const exact = sameTitle.find(
    (h) => artist !== undefined && h.artist && identity(h.artist) === artist,
  );
  return exact ?? sameTitle[0];
}

function validHit(v: unknown): v is BpmHit {
  const o = asRecord(v);
  return (
    o !== undefined &&
    typeof o.title === 'string' &&
    o.title !== '' &&
    (o.artist === undefined || typeof o.artist === 'string') &&
    parseTempo(o.bpm) === o.bpm &&
    safeUrl(o.url) === o.url
  );
}

/** A cached value is used only when it has the shape its key promises (single hit/miss or a list). */
function validCached(key: string, v: unknown): boolean {
  if (key.startsWith('t:')) return Array.isArray(v) && v.every(validHit);
  return v === null || validHit(v);
}

export function createGetSongBpmClient(opts: ClientOptions): GetSongBpmClient {
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const now = opts.now ?? Date.now;
  const storage = 'storage' in opts ? opts.storage : defaultStorage();
  const maxPerHour = opts.maxPerHour ?? 2500;
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const apiKey = opts.apiKey.trim();
  const sent: number[] = [];
  const keyId = fingerprint(apiKey);

  const readFile = (): CacheFile => {
    try {
      const raw = storage?.getItem(CACHE_KEY);
      const parsed = asRecord(raw ? (JSON.parse(raw) as unknown) : undefined);
      const entries: Record<string, CacheEntry> = {};
      for (const [k, e] of Object.entries(asRecord(parsed?.entries) ?? {})) {
        const o = asRecord(e);
        if (
          o &&
          typeof o.at === 'number' &&
          typeof o.ttl === 'number' &&
          'v' in o &&
          validCached(k, o.v)
        ) {
          entries[k] = { at: o.at, ttl: o.ttl, v: o.v };
        }
      }
      const { blockedUntil, blockedFor } = parsed ?? {};
      return {
        entries,
        ...(typeof blockedUntil === 'number' && typeof blockedFor === 'string'
          ? { blockedUntil, blockedFor }
          : {}),
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
    file.blockedFor = keyId;
    writeFile(file);
  };

  async function request(path: string, params: Record<string, string>): Promise<unknown> {
    if (!apiKey) throw new GetSongBpmError('no-key');
    const file = readFile();
    // A pause belongs to the key that was refused: a different or newly typed key may try at once.
    if (file.blockedFor === keyId && file.blockedUntil !== undefined && now() < file.blockedUntil) {
      throw new GetSongBpmError('blocked');
    }
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
        throw new GetSongBpmError(res.status === 429 ? 'rate-limited' : 'forbidden');
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
      const key = `s:${identity(title)}|${identity(artist ?? '')}`;
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
