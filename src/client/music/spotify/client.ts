import type { SpotifySettings } from '../../../domain/settings';
import { refreshTokens, type TokenSet } from './auth';
import { resolveClientId } from './client-id';
import { SpotifyError } from './errors';

export const SPOTIFY_API = 'https://api.spotify.com';
/** An access token this close to expiry is refreshed before use. */
export const EXPIRY_SKEW_MS = 60_000;

/** Where the tokens live. The app backs it with `settings.spotify`; tests use a plain object. */
export interface SpotifyStore {
  read(): SpotifySettings | undefined;
  write(next: SpotifySettings): Promise<void>;
}

export interface ClientOptions {
  store: SpotifyStore;
  fetch?: typeof fetch;
  now?: () => number;
}

export interface RequestOptions {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

export interface SpotifyClient {
  /** Calls the Web API with a valid bearer token; resolves to the JSON body (undefined for 204). */
  request(method: string, path: string, options?: RequestOptions): Promise<unknown>;
  /** Makes sure a usable access token exists, refreshing it when it is about to expire. */
  ensureToken(): Promise<void>;
  /** True when tokens are stored (they may still need a refresh). */
  hasCredentials(): boolean;
  /** Forgets the tokens but keeps the client id and device choice. */
  clearCredentials(): Promise<void>;
}

export function hasCredentials(cfg: SpotifySettings | undefined): boolean {
  return Boolean(cfg && (cfg.refreshToken || cfg.accessToken));
}

/** Persists a fresh token set into the config, keeping the old refresh token when none is sent. */
export function withTokens(cfg: SpotifySettings, tokens: TokenSet): SpotifySettings {
  const refreshToken = tokens.refreshToken ?? cfg.refreshToken;
  return {
    ...cfg,
    accessToken: tokens.accessToken,
    ...(refreshToken ? { refreshToken } : {}),
    expiresAt: tokens.expiresAt,
  };
}

function parseJson(res: Response): Promise<unknown> {
  return res.json().catch(() => undefined);
}

function reasonOf(body: unknown): { reason: string; message: string } {
  const err = (body as { error?: { reason?: unknown; message?: unknown } } | undefined)?.error;
  return {
    reason: typeof err?.reason === 'string' ? err.reason : '',
    message: typeof err?.message === 'string' ? err.message : '',
  };
}

function toError(res: Response, body: unknown, path: string): SpotifyError {
  const status = res.status;
  const { reason, message } = reasonOf(body);
  if (status === 403) {
    if (/restriction/i.test(message)) return new SpotifyError('restrictionViolated', { status });
    const premium = reason === 'PREMIUM_REQUIRED' || /premium/i.test(message);
    return new SpotifyError(premium ? 'premiumRequired' : 'forbidden', { status });
  }
  if (status === 404 && path.startsWith('/v1/me/player')) {
    return new SpotifyError('noActiveDevice', { status });
  }
  if (status === 429) {
    const retry = Number(res.headers.get('Retry-After'));
    return new SpotifyError('rateLimited', {
      status,
      ...(Number.isFinite(retry) && retry > 0 ? { retryAfterSec: retry } : {}),
    });
  }
  return new SpotifyError('http', { status });
}

/** One refresh at a time per store, even across client instances (refresh tokens may rotate). */
const refreshLocks = new WeakMap<SpotifyStore, Promise<string>>();

export function createSpotifyClient(options: ClientOptions): SpotifyClient {
  const { store } = options;
  const doFetch = options.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const now = options.now ?? Date.now;

  const isFresh = (cfg: SpotifySettings): boolean =>
    Boolean(cfg.accessToken) &&
    cfg.expiresAt !== undefined &&
    cfg.expiresAt - now() > EXPIRY_SKEW_MS;

  function refresh(cfg: SpotifySettings): Promise<string> {
    const running = refreshLocks.get(store);
    if (running) return running;
    const started = (async () => {
      if (!cfg.refreshToken) throw new SpotifyError('notAuthorized');
      let tokens: TokenSet;
      try {
        tokens = await refreshTokens(
          { refreshToken: cfg.refreshToken, clientId: resolveClientId(cfg.clientId) },
          { fetch: doFetch, now },
        );
      } catch (err) {
        // Only a rejected grant means the refresh token is dead. Rate limits, outages and
        // network errors keep the credentials so the next attempt can still succeed.
        if (err instanceof SpotifyError && err.code === 'notAuthorized') {
          await dropTokens(cfg.refreshToken); // show "disconnected" instead of failing forever
        }
        throw err;
      }
      const latest = store.read() ?? cfg;
      try {
        await store.write(withTokens(latest, tokens));
      } catch {
        // The token still works in memory for this page; only persistence failed.
        console.warn('Saving Spotify credentials failed');
      }
      return tokens.accessToken;
    })().finally(() => {
      refreshLocks.delete(store);
    });
    refreshLocks.set(store, started);
    return started;
  }

  /** Clears the tokens; with `onlyIfRefreshToken` only if that token is still the stored one. */
  async function dropTokens(onlyIfRefreshToken?: string): Promise<void> {
    const cfg = store.read();
    if (!cfg) return;
    if (onlyIfRefreshToken !== undefined && cfg.refreshToken !== onlyIfRefreshToken) return;
    const cleared = { ...cfg };
    delete cleared.accessToken;
    delete cleared.refreshToken;
    delete cleared.expiresAt;
    try {
      await store.write(cleared);
    } catch {
      console.warn('Clearing Spotify credentials failed');
    }
  }

  async function currentToken(): Promise<{ token: string; refreshed: boolean }> {
    const cfg = store.read();
    if (!cfg || !hasCredentials(cfg)) throw new SpotifyError('notAuthorized');
    if (isFresh(cfg) && cfg.accessToken) return { token: cfg.accessToken, refreshed: false };
    return { token: await refresh(cfg), refreshed: true };
  }

  async function send(
    token: string,
    method: string,
    path: string,
    opts: RequestOptions,
  ): Promise<Response> {
    const url = new URL(path, SPOTIFY_API);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const hasBody = opts.body !== undefined;
    try {
      return await doFetch(url.toString(), {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(hasBody ? { body: JSON.stringify(opts.body) } : {}),
      });
    } catch {
      throw new SpotifyError('network');
    }
  }

  return {
    async request(method, path, opts = {}) {
      const first = await currentToken();
      let res = await send(first.token, method, path, opts);
      if (res.status === 401) {
        // Exactly one refresh attempt per request; a token refreshed a moment ago is not retried.
        if (first.refreshed) throw new SpotifyError('notAuthorized', { status: 401 });
        const cfg = store.read();
        if (!cfg) throw new SpotifyError('notAuthorized', { status: 401 });
        res = await send(await refresh(cfg), method, path, opts);
        if (res.status === 401) throw new SpotifyError('notAuthorized', { status: 401 });
      }
      const body = res.status === 204 ? undefined : await parseJson(res);
      if (!res.ok) throw toError(res, body, path);
      return body;
    },
    async ensureToken() {
      await currentToken();
    },
    hasCredentials() {
      return hasCredentials(store.read());
    },
    clearCredentials: () => dropTokens(),
  };
}
