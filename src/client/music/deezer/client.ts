/**
 * Deezer client (https://developers.deezer.com/api): tempo of a song by title and artist, no key.
 *
 * api.deezer.com sends no CORS headers (checked 2026-11-07), so `fetch` cannot read it from a
 * browser. It does answer JSONP (`output=jsonp&callback=name`), i.e. it returns script. To keep
 * that script out of the app's origin, requests go to a sandboxed iframe (opaque origin) with its
 * own CSP (public/deezer-bridge.html, src/shared/csp.ts); the page's `script-src` does not list
 * api.deezer.com. The client only exists while Settings -> Music enables it (off by default).
 * The callback name is generated here, never taken from data. `bpm` is optional in Deezer's data and 0 means
 * "unknown" (treated as not found). Results are cached locally. Terms: non-commercial use, and
 * Deezer's logos are off limits, so the UI shows the plain text "Deezer" with a link only.
 */
import { BPM_MAX, BPM_MIN } from '../../../domain/bpm-match';
import { DEEZER_BRIDGE_FILE } from '../../../shared/csp';
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

const BRIDGE_READY_MS = 5_000;

interface Pending {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
const pending = new Map<number, Pending>();
let frame: HTMLIFrameElement | undefined;
let ready: Promise<HTMLIFrameElement> | undefined;
let onReady: (() => void) | undefined;
let nextId = 0;
let listening = false;

function onMessage(event: MessageEvent): void {
  // Only the bridge frame we created may talk to us; its origin is opaque ("null") by design.
  if (!frame || event.source !== frame.contentWindow) return;
  const m = asRecord(event.data);
  if (!m) return;
  if (m.type === 'hc-ready') {
    onReady?.();
  } else if (m.type === 'hc-jsonp-result' && typeof m.id === 'number') {
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    clearTimeout(p.timer);
    if (m.ok === true) p.resolve(m.data);
    else p.reject(new Error('load'));
  }
}

function openBridge(): Promise<HTMLIFrameElement> {
  if (ready) return ready;
  if (!listening) {
    window.addEventListener('message', onMessage);
    listening = true;
  }
  const el = document.createElement('iframe');
  el.setAttribute('sandbox', 'allow-scripts'); // opaque origin: no storage, tokens or DOM of ours
  el.referrerPolicy = 'no-referrer';
  el.hidden = true;
  el.tabIndex = -1;
  el.title = 'Deezer bridge';
  el.setAttribute('aria-hidden', 'true');
  frame = el;
  ready = new Promise<HTMLIFrameElement>((resolve, reject) => {
    const timer = setTimeout(() => {
      closeDeezerBridge();
      reject(new Error('bridge'));
    }, BRIDGE_READY_MS);
    onReady = () => {
      clearTimeout(timer);
      resolve(el);
    };
  });
  el.src = `${import.meta.env.BASE_URL}${DEEZER_BRIDGE_FILE}`;
  document.body.appendChild(el);
  return ready;
}

/** Removes the sandboxed frame and fails whatever is still waiting; used when the setting is turned off. */
export function closeDeezerBridge(): void {
  frame?.remove();
  frame = undefined;
  ready = undefined;
  onReady = undefined;
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(new Error('closed'));
  }
  pending.clear();
}

let counter = 0;

/**
 * Real loader: the request goes to a sandboxed iframe (public/deezer-bridge.html) that runs the
 * JSONP <script> under its own CSP, so Deezer's script never runs in the app's origin. The
 * callback name is generated here, never taken from data.
 */
export const bridgeJsonp: JsonpLoader = async (url, timeoutMs) => {
  const el = await openBridge();
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const name = `__hcDeezer${Date.now().toString(36)}${counter++}`;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('timeout'));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    el.contentWindow?.postMessage({ type: 'hc-jsonp', id, name, url: url(name) }, '*');
  });
};

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

const MAX_TEXT = 200;
const clip = (v: string): string => v.slice(0, MAX_TEXT);

function safeUrl(v: unknown): string | undefined {
  return typeof v === 'string' && v.startsWith(`${DEEZER_SITE}/`) ? v : undefined;
}

function validHit(v: unknown): v is DeezerHit {
  const o = asRecord(v);
  return (
    o !== undefined &&
    typeof o.title === 'string' &&
    o.title !== '' &&
    o.title.length <= MAX_TEXT &&
    (o.artist === undefined || (typeof o.artist === 'string' && o.artist.length <= MAX_TEXT)) &&
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
    list.push({ id, title: clip(t), artist: typeof name === 'string' ? clip(name) : undefined });
  }
  // A different title is a different song (cover, medley): no match beats somebody else's tempo.
  const same = list.filter((c) => identity(c.title) === title);
  const exact = same.filter(
    (c) => artist !== undefined && c.artist !== undefined && identity(c.artist) === artist,
  );
  // With an artist given, a same-title song by somebody else is not the song asked for ("Home",
  // "Intro", "Stay" exist many times); only when the artist is unknown do same-title songs count.
  return (artist === undefined ? same : exact).slice(0, MAX_CANDIDATES);
}

type CacheValue = DeezerHit | DeezerHit[] | null;
type CacheMap = Record<string, { at: number; ttl: number; v: CacheValue }>;

export function createDeezerClient(opts: DeezerOptions = {}): DeezerClient {
  const load = opts.jsonp ?? bridgeJsonp;
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
        let track: Record<string, unknown> | undefined;
        try {
          track = asRecord(await request(`/track/${id}`, {}));
        } catch (err) {
          // One failed track must not throw away the ones already found; a spent quota stops all.
          if (err instanceof GetSongBpmError && err.kind === 'rate-limited') throw err;
          continue;
        }
        const bpm = parseDeezerBpm(track?.bpm);
        const url = safeUrl(track?.link);
        // No tempo in Deezer's data: nothing to offer for this one.
        if (bpm === undefined || !url) continue;
        out.push({
          title: clip(t),
          ...(typeof name === 'string' && name ? { artist: clip(name) } : {}),
          bpm,
          url,
        });
      }
      remember(key, out, out.length > 0 ? FOUND_TTL_MS : MISSING_TTL_MS);
      return out;
    },
  };
}
