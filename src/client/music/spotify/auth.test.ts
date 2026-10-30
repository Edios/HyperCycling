import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpotifySettings } from '../../../domain/settings';
import {
  beginLogin,
  buildAuthorizeUrl,
  getRedirectUri,
  handleCallback,
  SPOTIFY_SCOPES,
  SPOTIFY_TOKEN_URL,
} from './auth';
import { completeSpotifyCallbackOnLoad, getLastSpotifyCallbackResult } from './callback';
import type { SpotifyStore } from './client';
import { challengeFor } from './pkce';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const PENDING_KEY = 'spinning-tutor.spotify.login';
const NOW = 1_700_000_000_000;

beforeEach(() => sessionStorage.clear());

function tokenEndpoint() {
  const bodies: URLSearchParams[] = [];
  server.use(
    http.post(SPOTIFY_TOKEN_URL, async ({ request }) => {
      bodies.push(new URLSearchParams(await request.text()));
      return HttpResponse.json({ access_token: 'AT1', refresh_token: 'RT1', expires_in: 3600 });
    }),
  );
  return bodies;
}

describe('redirect URI', () => {
  it('is the current origin plus the base path', () => {
    expect(getRedirectUri('http://127.0.0.1:5175', '/')).toBe('http://127.0.0.1:5175/');
    expect(getRedirectUri('https://edios.github.io', '/Spinning-Tutor/')).toBe(
      'https://edios.github.io/Spinning-Tutor/',
    );
  });
  it('defaults to location.origin + BASE_URL', () => {
    expect(getRedirectUri()).toBe(`${location.origin}${import.meta.env.BASE_URL}`);
  });
});

describe('buildAuthorizeUrl', () => {
  it('asks for the code flow with S256 and exactly the playback scopes', () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: 'cid',
        redirectUri: 'http://127.0.0.1:5175/',
        challenge: 'CH',
        state: 'ST',
      }),
    );
    expect(url.origin + url.pathname).toBe('https://accounts.spotify.com/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'cid',
      response_type: 'code',
      redirect_uri: 'http://127.0.0.1:5175/',
      code_challenge_method: 'S256',
      code_challenge: 'CH',
      scope: 'user-modify-playback-state user-read-playback-state',
      state: 'ST',
    });
    expect(SPOTIFY_SCOPES).toBe('user-modify-playback-state user-read-playback-state');
  });
});

describe('beginLogin', () => {
  it('keeps verifier and state in sessionStorage and sends a matching challenge', async () => {
    const navigate = vi.fn();
    const url = await beginLogin('  cid  ', {
      navigate,
      redirectUri: 'http://127.0.0.1:5175/',
      returnHash: '#/settings',
    });
    const stored = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? '{}') as {
      verifier: string;
      state: string;
      clientId: string;
      returnHash: string;
    };
    expect(stored.verifier).toHaveLength(64);
    expect(stored).toMatchObject({ clientId: 'cid', returnHash: '#/settings' });
    const params = new URL(url).searchParams;
    expect(params.get('state')).toBe(stored.state);
    expect(params.get('code_challenge')).toBe(await challengeFor(stored.verifier));
    expect(navigate).toHaveBeenCalledWith(url);
    // never in localStorage
    expect(localStorage.length).toBe(0);
  });
  it('refuses an empty client id', async () => {
    await expect(beginLogin('  ', { navigate: vi.fn() })).rejects.toMatchObject({
      code: 'notAuthorized',
    });
  });
});

describe('handleCallback', () => {
  const REDIRECT = 'http://127.0.0.1:5175/';
  const seed = (state = 'ST') =>
    sessionStorage.setItem(
      PENDING_KEY,
      JSON.stringify({
        verifier: 'V'.repeat(64),
        state,
        clientId: 'cid',
        returnHash: '#/settings',
      }),
    );
  const run = (search: string, replaceUrl = vi.fn()) =>
    handleCallback({ search, replaceUrl, redirectUri: REDIRECT, now: () => NOW });

  it('ignores URLs that are not a callback', async () => {
    const replaceUrl = vi.fn();
    expect(await run('?dev', replaceUrl)).toEqual({ status: 'none' });
    expect(replaceUrl).not.toHaveBeenCalled();
  });

  it('exchanges the code with the stored verifier, cleans the URL and the pending login', async () => {
    seed();
    const bodies = tokenEndpoint();
    const replaceUrl = vi.fn();
    const result = await run('?code=CODE&state=ST', replaceUrl);
    expect(result).toEqual({
      status: 'connected',
      clientId: 'cid',
      tokens: { accessToken: 'AT1', refreshToken: 'RT1', expiresAt: NOW + 3_600_000 },
    });
    expect(Object.fromEntries(bodies[0] ?? [])).toEqual({
      grant_type: 'authorization_code',
      code: 'CODE',
      redirect_uri: REDIRECT,
      client_id: 'cid',
      code_verifier: 'V'.repeat(64),
    });
    expect(replaceUrl).toHaveBeenCalledWith(`${location.pathname}#/settings`);
    expect(replaceUrl.mock.calls[0]?.[0]).not.toContain('code=');
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it('rejects a state mismatch without calling the token endpoint', async () => {
    seed('EXPECTED');
    const bodies = tokenEndpoint();
    const replaceUrl = vi.fn();
    const result = await run('?code=EVIL&state=OTHER', replaceUrl);
    expect(result).toMatchObject({ status: 'error', error: { code: 'stateMismatch' } });
    expect(bodies).toHaveLength(0);
    expect(replaceUrl).toHaveBeenCalled(); // the code never stays in the address bar
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it('rejects a missing state and a callback nobody started', async () => {
    seed();
    expect(await run('?code=C')).toMatchObject({ error: { code: 'stateMismatch' } });
    sessionStorage.clear();
    expect(await run('?code=C&state=ST')).toMatchObject({ error: { code: 'stateMismatch' } });
  });

  it('cannot be replayed: the pending login is single use', async () => {
    seed();
    tokenEndpoint();
    await run('?code=C&state=ST');
    expect(await run('?code=C&state=ST')).toMatchObject({ error: { code: 'stateMismatch' } });
  });

  it('reports a declined consent as authDenied', async () => {
    seed();
    expect(await run('?error=access_denied&state=ST')).toMatchObject({
      status: 'error',
      error: { code: 'authDenied' },
    });
  });

  it('maps a rejected code to notAuthorized and a dead network to network', async () => {
    seed();
    server.use(
      http.post(SPOTIFY_TOKEN_URL, () =>
        HttpResponse.json({ error: 'invalid_grant' }, { status: 400 }),
      ),
    );
    expect(await run('?code=C&state=ST')).toMatchObject({ error: { code: 'notAuthorized' } });
    seed();
    server.use(http.post(SPOTIFY_TOKEN_URL, () => HttpResponse.error()));
    expect(await run('?code=C&state=ST')).toMatchObject({ error: { code: 'network' } });
  });
});

describe('completeSpotifyCallbackOnLoad', () => {
  const memoryStore = (initial?: SpotifySettings): SpotifyStore & { value?: SpotifySettings } => {
    const s: SpotifyStore & { value?: SpotifySettings } = {
      read: () => s.value,
      write: (next) => {
        s.value = next;
        return Promise.resolve();
      },
    };
    if (initial) s.value = initial;
    return s;
  };

  it('saves tokens into settings.spotify next to the existing device choice', async () => {
    sessionStorage.setItem(
      PENDING_KEY,
      JSON.stringify({ verifier: 'V'.repeat(64), state: 'ST', clientId: 'cid', returnHash: '' }),
    );
    tokenEndpoint();
    const store = memoryStore({ clientId: 'old', deviceId: 'dev' });
    const result = await completeSpotifyCallbackOnLoad(store, {
      search: '?code=C&state=ST',
      replaceUrl: vi.fn(),
      now: () => NOW,
    });
    expect(result).toEqual({ status: 'connected', clientId: 'cid' }); // no tokens in the outcome
    expect(getLastSpotifyCallbackResult()).toEqual({ status: 'connected', clientId: 'cid' });
    expect(JSON.stringify(getLastSpotifyCallbackResult())).not.toMatch(/AT1|RT1/);
    expect(store.value).toEqual({
      clientId: 'cid',
      deviceId: 'dev',
      accessToken: 'AT1',
      refreshToken: 'RT1',
      expiresAt: NOW + 3_600_000,
    });
  });

  it('writes nothing on a state mismatch', async () => {
    const store = memoryStore();
    const write = vi.spyOn(store, 'write');
    const result = await completeSpotifyCallbackOnLoad(store, {
      search: '?code=C&state=X',
      replaceUrl: vi.fn(),
    });
    expect(result).toMatchObject({ status: 'error', error: { code: 'stateMismatch' } });
    expect(write).not.toHaveBeenCalled();
  });

  it('never throws when sessionStorage is blocked', async () => {
    const blocked = {
      getItem: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
      setItem: () => undefined,
      removeItem: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
    };
    const result = await completeSpotifyCallbackOnLoad(memoryStore(), {
      search: '?code=C&state=ST',
      replaceUrl: vi.fn(),
      storage: blocked,
    });
    expect(result).toMatchObject({ status: 'error', error: { code: 'stateMismatch' } });
  });

  it('turns a failing settings write into an error result instead of throwing', async () => {
    sessionStorage.setItem(
      PENDING_KEY,
      JSON.stringify({ verifier: 'V'.repeat(64), state: 'ST', clientId: 'cid', returnHash: '' }),
    );
    tokenEndpoint();
    const store: SpotifyStore = {
      read: () => undefined,
      write: () => Promise.reject(new Error('disk')),
    };
    const result = await completeSpotifyCallbackOnLoad(store, {
      search: '?code=C&state=ST',
      replaceUrl: vi.fn(),
    });
    expect(result.status).toBe('error');
  });
});
