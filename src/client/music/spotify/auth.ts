import { z } from 'zod';
import { SpotifyError } from './errors';
import { challengeFor, generateState, generateVerifier } from './pkce';

export const SPOTIFY_AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
export const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
export const SPOTIFY_SCOPES = 'user-modify-playback-state user-read-playback-state';

/** Pending login kept in sessionStorage only: it dies with the tab and is never persisted. */
const PENDING_KEY = 'spinning-tutor.spotify.login';

export interface PendingLogin {
  verifier: string;
  state: string;
  clientId: string;
  /** Route to return to after the redirect (the app uses hash routing). */
  returnHash: string;
}

export interface TokenSet {
  accessToken: string;
  /** Absent when Spotify keeps the previous refresh token. */
  refreshToken?: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export interface AuthEnv {
  fetch?: typeof fetch;
  now?: () => number;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}

/** The URI that has to be registered in the Spotify dashboard: app origin + base path. */
export function getRedirectUri(
  origin: string = location.origin,
  baseUrl: string = import.meta.env.BASE_URL,
): string {
  return `${origin}${baseUrl}`;
}

export function buildAuthorizeUrl(args: {
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: args.clientId,
    response_type: 'code',
    redirect_uri: args.redirectUri,
    code_challenge_method: 'S256',
    code_challenge: args.challenge,
    scope: SPOTIFY_SCOPES,
    state: args.state,
  });
  return `${SPOTIFY_AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Starts the Authorization Code + PKCE flow: remembers verifier and state for this tab and
 * returns (or navigates to) the Spotify consent URL.
 */
export async function beginLogin(
  clientId: string,
  options: {
    storage?: AuthEnv['storage'];
    navigate?: (url: string) => void;
    redirectUri?: string;
    returnHash?: string;
  } = {},
): Promise<string> {
  const trimmed = clientId.trim();
  if (!trimmed) throw new SpotifyError('notAuthorized', { message: 'Spotify: missing client id' });
  const storage = options.storage ?? sessionStorage;
  const verifier = generateVerifier();
  const state = generateState();
  const pending: PendingLogin = {
    verifier,
    state,
    clientId: trimmed,
    returnHash: options.returnHash ?? location.hash,
  };
  storage.setItem(PENDING_KEY, JSON.stringify(pending));
  const url = buildAuthorizeUrl({
    clientId: trimmed,
    redirectUri: options.redirectUri ?? getRedirectUri(),
    challenge: await challengeFor(verifier),
    state,
  });
  (options.navigate ?? ((u: string) => location.assign(u)))(url);
  return url;
}

const pendingSchema = z.object({
  verifier: z.string().min(1),
  state: z.string().min(1),
  clientId: z.string().min(1),
  returnHash: z.string(),
});

function readPending(storage: NonNullable<AuthEnv['storage']>): PendingLogin | undefined {
  try {
    const raw = storage.getItem(PENDING_KEY);
    if (!raw) return undefined;
    const parsed = pendingSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
  refresh_token: z.string().min(1).optional(),
});

/** Grants that can never work again: the user has to run the consent flow once more. */
const DEAD_GRANT_ERRORS = new Set(['invalid_grant', 'invalid_client']);

async function tokenEndpointError(res: Response): Promise<SpotifyError> {
  const status = res.status;
  if (status === 429) {
    const retry = Number(res.headers.get('Retry-After'));
    return new SpotifyError('rateLimited', {
      status,
      ...(Number.isFinite(retry) && retry > 0 ? { retryAfterSec: retry } : {}),
    });
  }
  if (status === 400 || status === 401) {
    const body = (await res.json().catch(() => undefined)) as { error?: unknown } | undefined;
    if (typeof body?.error === 'string' && DEAD_GRANT_ERRORS.has(body.error)) {
      return new SpotifyError('notAuthorized', { status });
    }
  }
  // Anything else (5xx, proxy 403, other 400s) is transient from our point of view.
  return new SpotifyError('http', { status });
}

async function postToken(body: URLSearchParams, env: AuthEnv): Promise<TokenSet> {
  const doFetch = env.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const now = env.now ?? Date.now;
  let res: Response;
  try {
    res = await doFetch(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch {
    throw new SpotifyError('network');
  }
  if (!res.ok) throw await tokenEndpointError(res);
  const parsed = tokenResponseSchema.safeParse(await res.json().catch(() => undefined));
  if (!parsed.success) throw new SpotifyError('http', { status: res.status });
  const { access_token, expires_in, refresh_token } = parsed.data;
  return {
    accessToken: access_token,
    ...(refresh_token ? { refreshToken: refresh_token } : {}),
    expiresAt: now() + expires_in * 1000,
  };
}

export function exchangeCode(
  args: { code: string; verifier: string; clientId: string; redirectUri?: string },
  env: AuthEnv = {},
): Promise<TokenSet> {
  return postToken(
    new URLSearchParams({
      grant_type: 'authorization_code',
      code: args.code,
      redirect_uri: args.redirectUri ?? getRedirectUri(),
      client_id: args.clientId,
      code_verifier: args.verifier,
    }),
    env,
  );
}

export function refreshTokens(
  args: { refreshToken: string; clientId: string },
  env: AuthEnv = {},
): Promise<TokenSet> {
  return postToken(
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: args.refreshToken,
      client_id: args.clientId,
    }),
    env,
  );
}

export type CallbackResult =
  | { status: 'none' }
  | { status: 'connected'; tokens: TokenSet; clientId: string }
  | { status: 'error'; error: SpotifyError };

/**
 * Handles the OAuth redirect when the page loads with `?code=` (or `?error=`): verifies `state`
 * against the one stored by `beginLogin`, exchanges the code, then removes the query string from
 * the address bar. Returns `none` when the URL is not a callback. Tokens are returned, never
 * stored here.
 */
export async function handleCallback(
  options: AuthEnv & {
    search?: string;
    redirectUri?: string;
    /** Rewrites the address bar; defaults to `history.replaceState`. */
    replaceUrl?: (url: string) => void;
  } = {},
): Promise<CallbackResult> {
  const params = new URLSearchParams(options.search ?? location.search);
  const code = params.get('code');
  const oauthError = params.get('error');
  if (!code && !oauthError) return { status: 'none' };

  const storage = options.storage ?? sessionStorage;
  const pending = readPending(storage);
  // One-shot: a callback can never be replayed against the same verifier.
  try {
    storage.removeItem(PENDING_KEY);
  } catch {
    // storage unavailable: nothing to clean up
  }
  const replace =
    options.replaceUrl ?? ((url: string) => history.replaceState(history.state, '', url));
  replace(`${location.pathname}${pending?.returnHash ?? location.hash}`);

  const state = params.get('state');
  if (!pending || !state || state !== pending.state) {
    return { status: 'error', error: new SpotifyError('stateMismatch') };
  }
  if (oauthError || !code) return { status: 'error', error: new SpotifyError('authDenied') };

  try {
    const tokens = await exchangeCode(
      {
        code,
        verifier: pending.verifier,
        clientId: pending.clientId,
        ...(options.redirectUri ? { redirectUri: options.redirectUri } : {}),
      },
      options,
    );
    return { status: 'connected', tokens, clientId: pending.clientId };
  } catch (err) {
    return {
      status: 'error',
      error: err instanceof SpotifyError ? err : new SpotifyError('http'),
    };
  }
}
