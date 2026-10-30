import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SpotifySettings } from '../../../domain/settings';
import type { TrackRef } from '../../../domain/workout';
import { SPOTIFY_TOKEN_URL } from './auth';
import type { SpotifyStore } from './client';
import { SpotifyError } from './errors';
import { createSpotifyProvider } from './provider';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const API = 'https://api.spotify.com';
const NOW = 1_700_000_000_000;
const FRESH: SpotifySettings = {
  clientId: 'cid',
  deviceId: 'DEV1',
  accessToken: 'AT-live',
  refreshToken: 'RT-live',
  expiresAt: NOW + 3_600_000,
};
const track: TrackRef = {
  provider: 'spotify',
  id: '4uLU6hMCjMI75M1A2tKUQC',
  title: 'T',
  startAtSec: 0,
};

function setup(initial: SpotifySettings | null = FRESH) {
  const state: { cfg: SpotifySettings | undefined; writes: SpotifySettings[] } = {
    cfg: initial ?? undefined,
    writes: [],
  };
  const store: SpotifyStore = {
    read: () => state.cfg,
    write: (next) => {
      state.cfg = next;
      state.writes.push(next);
      return Promise.resolve();
    },
  };
  const sleeps: number[] = [];
  const provider = createSpotifyProvider({
    store,
    now: () => NOW,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  });
  return { provider, state, sleeps };
}

interface Seen {
  method: string;
  path: string;
  query: Record<string, string>;
  auth: string | null;
  body: unknown;
}

/** Records every Web API request and answers with `reply` (default: 204). */
function api(reply: (seen: Seen) => Response | undefined = () => undefined) {
  const seen: Seen[] = [];
  server.use(
    http.all(`${API}/*`, async ({ request }) => {
      const url = new URL(request.url);
      const text = await request.text();
      const entry: Seen = {
        method: request.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        auth: request.headers.get('Authorization'),
        body: text ? JSON.parse(text) : undefined,
      };
      seen.push(entry);
      return reply(entry) ?? new HttpResponse(null, { status: 204 });
    }),
  );
  return seen;
}

function tokenEndpoint(
  respond: (body: URLSearchParams) => Response = () =>
    HttpResponse.json({ access_token: 'AT-new', expires_in: 3600 }),
) {
  const bodies: URLSearchParams[] = [];
  server.use(
    http.post(SPOTIFY_TOKEN_URL, async ({ request }) => {
      const body = new URLSearchParams(await request.text());
      bodies.push(body);
      return respond(body);
    }),
  );
  return bodies;
}

const error = (status: number, reason: string, message = '') =>
  HttpResponse.json({ error: { status, reason, message } }, { status });

describe('play', () => {
  it('PUTs /v1/me/player/play on the chosen device with uris and position_ms', async () => {
    const seen = api();
    const { provider } = setup();
    await provider.connect();
    await provider.play(track, 83.4);
    expect(seen).toEqual([
      {
        method: 'PUT',
        path: '/v1/me/player/play',
        query: { device_id: 'DEV1' },
        auth: 'Bearer AT-live',
        body: { uris: ['spotify:track:4uLU6hMCjMI75M1A2tKUQC'], position_ms: 83400 },
      },
    ]);
  });

  it('falls back to the first active device when none is chosen', async () => {
    const seen = api((s) =>
      s.path === '/v1/me/player/devices'
        ? HttpResponse.json({
            devices: [
              { id: 'A', name: 'Phone', type: 'Smartphone', is_active: false },
              { id: null, name: 'Restricted', type: 'Speaker', is_active: true },
              { id: 'B', name: 'PC', type: 'Computer', is_active: true },
              { id: 'C', name: 'TV', type: 'TV', is_active: true },
            ],
          })
        : undefined,
    );
    const { provider } = setup({ ...FRESH, deviceId: undefined });
    await provider.play(track, 0);
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual([
      'GET /v1/me/player/devices',
      'PUT /v1/me/player/play',
    ]);
    expect(seen[1]?.query).toEqual({ device_id: 'B' });
    expect(seen[1]?.body).toMatchObject({ position_ms: 0 });
  });

  it('fails with noActiveDevice when no device is active', async () => {
    api(() =>
      HttpResponse.json({ devices: [{ id: 'A', name: 'Phone', type: 'x', is_active: false }] }),
    );
    const { provider } = setup({ ...FRESH, deviceId: undefined });
    await expect(provider.play(track, 0)).rejects.toMatchObject({ code: 'noActiveDevice' });
  });

  it('refuses a non-Spotify track without calling the API', async () => {
    const seen = api();
    const { provider } = setup();
    await expect(provider.play({ ...track, provider: 'youtube' }, 0)).rejects.toBeInstanceOf(
      SpotifyError,
    );
    expect(seen).toHaveLength(0);
  });

  it('clamps a negative offset to 0', async () => {
    const seen = api();
    await setup().provider.play(track, -5);
    expect(seen[0]?.body).toMatchObject({ position_ms: 0 });
  });
});

describe('typed API errors', () => {
  it.each([
    [
      '404 -> noActiveDevice',
      error(404, 'NO_ACTIVE_DEVICE', 'Player command failed: No active device found'),
      'noActiveDevice',
    ],
    [
      '403 premium -> premiumRequired',
      error(403, 'PREMIUM_REQUIRED', 'Player command failed: Premium required'),
      'premiumRequired',
    ],
    ['403 other -> forbidden', error(403, 'UNKNOWN', 'Restriction violated'), 'forbidden'],
  ])('%s', async (_name, response, code) => {
    api(() => response);
    await expect(setup().provider.play(track, 0)).rejects.toMatchObject({ code });
  });

  it('reports 429 with Retry-After', async () => {
    api(() => new HttpResponse(null, { status: 429, headers: { 'Retry-After': '7' } }));
    await expect(setup().provider.play(track, 0)).rejects.toMatchObject({
      code: 'rateLimited',
      retryAfterSec: 7,
    });
  });

  it('reports a dead network and a server error', async () => {
    server.use(http.all(`${API}/*`, () => HttpResponse.error()));
    await expect(setup().provider.play(track, 0)).rejects.toMatchObject({ code: 'network' });
    server.use(http.all(`${API}/*`, () => new HttpResponse(null, { status: 502 })));
    await expect(setup().provider.play(track, 0)).rejects.toMatchObject({
      code: 'http',
      status: 502,
    });
  });

  it('keeps tokens out of error messages', async () => {
    api(() => error(403, 'PREMIUM_REQUIRED'));
    let err: Error | undefined;
    try {
      await setup().provider.play(track, 0);
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeInstanceOf(SpotifyError);
    expect(`${err?.message} ${JSON.stringify(err)}`).not.toMatch(/AT-live|RT-live/);
  });
});

describe('token refresh', () => {
  it('refreshes before the request when the token is about to expire', async () => {
    const bodies = tokenEndpoint(() =>
      HttpResponse.json({ access_token: 'AT-new', refresh_token: 'RT-rotated', expires_in: 3600 }),
    );
    const seen = api();
    const { provider, state } = setup({ ...FRESH, expiresAt: NOW + 30_000 });
    await provider.play(track, 0);
    expect(Object.fromEntries(bodies[0] ?? [])).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'RT-live',
      client_id: 'cid',
    });
    expect(seen[0]?.auth).toBe('Bearer AT-new');
    expect(state.cfg).toEqual({
      ...FRESH,
      accessToken: 'AT-new',
      refreshToken: 'RT-rotated',
      expiresAt: NOW + 3_600_000,
    });
  });

  it('keeps the old refresh token when Spotify does not send a new one', async () => {
    tokenEndpoint();
    api();
    const { provider, state } = setup({ ...FRESH, expiresAt: NOW - 1 });
    await provider.connect();
    expect(state.cfg?.refreshToken).toBe('RT-live');
    expect(state.cfg?.accessToken).toBe('AT-new');
  });

  it('on 401 refreshes once and retries the request with the new token', async () => {
    const bodies = tokenEndpoint();
    const seen = api((s) =>
      s.auth === 'Bearer AT-live' ? new HttpResponse(null, { status: 401 }) : undefined,
    );
    const { provider } = setup();
    await provider.play(track, 0);
    expect(bodies).toHaveLength(1);
    expect(seen.map((s) => s.auth)).toEqual(['Bearer AT-live', 'Bearer AT-new']);
  });

  it('gives up with notAuthorized after a second 401 (one refresh only)', async () => {
    const bodies = tokenEndpoint();
    const seen = api(() => new HttpResponse(null, { status: 401 }));
    await expect(setup().provider.play(track, 0)).rejects.toMatchObject({ code: 'notAuthorized' });
    expect(bodies).toHaveLength(1);
    expect(seen).toHaveLength(2);
  });

  it('does not refresh again when a token refreshed a moment ago is rejected', async () => {
    const bodies = tokenEndpoint();
    const seen = api(() => new HttpResponse(null, { status: 401 }));
    const { provider } = setup({ ...FRESH, expiresAt: NOW });
    await expect(provider.play(track, 0)).rejects.toMatchObject({ code: 'notAuthorized' });
    expect(bodies).toHaveLength(1);
    expect(seen).toHaveLength(1);
  });

  it('drops dead credentials when the refresh token is rejected', async () => {
    tokenEndpoint(() => HttpResponse.json({ error: 'invalid_grant' }, { status: 400 }));
    const seen = api();
    const { provider, state } = setup({ ...FRESH, expiresAt: NOW });
    await expect(provider.play(track, 0)).rejects.toMatchObject({ code: 'notAuthorized' });
    expect(seen).toHaveLength(0);
    expect(state.cfg).toEqual({ clientId: 'cid', deviceId: 'DEV1' });
    expect(provider.isReady()).toBe(false);
  });

  it('keeps credentials when the refresh fails only because of the network', async () => {
    server.use(http.post(SPOTIFY_TOKEN_URL, () => HttpResponse.error()));
    const { provider, state } = setup({ ...FRESH, expiresAt: NOW });
    await expect(provider.connect()).rejects.toMatchObject({ code: 'network' });
    expect(state.cfg?.refreshToken).toBe('RT-live');
  });

  it('shares one refresh between concurrent requests', async () => {
    const bodies = tokenEndpoint();
    api();
    const { provider } = setup({ ...FRESH, expiresAt: NOW });
    await Promise.all([provider.pause(), provider.resume(), provider.setVolume(0.5)]);
    expect(bodies).toHaveLength(1);
  });

  it('still plays when saving the refreshed tokens fails', async () => {
    tokenEndpoint();
    const seen = api();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const provider = createSpotifyProvider({
      store: {
        read: () => ({ ...FRESH, expiresAt: NOW }),
        write: () => Promise.reject(new Error('disk')),
      },
      now: () => NOW,
    });
    await provider.play(track, 0);
    expect(seen[0]?.auth).toBe('Bearer AT-new');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/AT-|RT-/);
    warn.mockRestore();
  });
});

describe('connect / isReady / disconnect', () => {
  it('needs stored credentials', async () => {
    const { provider } = setup(null);
    expect(provider.isReady()).toBe(false);
    await expect(provider.connect()).rejects.toMatchObject({ code: 'notAuthorized' });
    expect(provider.isReady()).toBe(false);
  });
  it('is ready after connect and not ready after disconnect, keeping client id and device', async () => {
    const { provider, state } = setup();
    expect(provider.kind).toBe('spotify');
    expect(provider.isReady()).toBe(false);
    await provider.connect();
    expect(provider.isReady()).toBe(true);
    await provider.disconnect();
    expect(provider.isReady()).toBe(false);
    expect(state.cfg).toEqual({ clientId: 'cid', deviceId: 'DEV1' });
  });
});

describe('volume and fade', () => {
  it('fades to 0 in 6 equal steps over the fade time, then pauses and restores the level', async () => {
    const seen = api();
    const { provider, sleeps } = setup();
    await provider.fadeOut(1500);
    expect(sleeps).toEqual([250, 250, 250, 250, 250, 250]);
    expect(seen.map((s) => `${s.method} ${s.path} ${s.query.volume_percent ?? ''}`.trim())).toEqual(
      [
        'PUT /v1/me/player/volume 83',
        'PUT /v1/me/player/volume 67',
        'PUT /v1/me/player/volume 50',
        'PUT /v1/me/player/volume 33',
        'PUT /v1/me/player/volume 17',
        'PUT /v1/me/player/volume 0',
        'PUT /v1/me/player/pause',
        'PUT /v1/me/player/volume 100',
      ],
    );
    expect(seen.every((s) => s.query.device_id === 'DEV1')).toBe(true);
  });

  it('scales the fade from the level set with setVolume and restores to it', async () => {
    const seen = api();
    const { provider } = setup();
    await provider.setVolume(0.6);
    seen.length = 0;
    await provider.fadeOut(600);
    const levels = seen
      .filter((s) => s.path.endsWith('/volume'))
      .map((s) => s.query.volume_percent);
    expect(levels).toEqual(['50', '40', '30', '20', '10', '0', '60']);
  });

  it('setVolume clamps to 0..100 percent', async () => {
    const seen = api();
    const { provider } = setup();
    await provider.setVolume(2);
    await provider.setVolume(-1);
    expect(seen.map((s) => s.query.volume_percent)).toEqual(['100', '0']);
  });

  it('puts the volume back even when a fade step fails, and reports the failure', async () => {
    let volumeCalls = 0;
    const seen = api((s) => {
      if (!s.path.endsWith('/volume')) return undefined;
      volumeCalls++;
      return volumeCalls === 3 ? error(429, '') : undefined;
    });
    const { provider } = setup();
    await expect(provider.fadeOut(600)).rejects.toMatchObject({ code: 'rateLimited' });
    expect(seen.at(-1)?.query.volume_percent).toBe('100');
    expect(seen.some((s) => s.path.endsWith('/pause'))).toBe(false);
  });
});

describe('pause / resume', () => {
  it('pauses and resumes on the device (resume sends no body)', async () => {
    const seen = api();
    const { provider } = setup();
    await provider.pause();
    await provider.resume();
    expect(seen.map((s) => [s.method, s.path, s.query.device_id, s.body])).toEqual([
      ['PUT', '/v1/me/player/pause', 'DEV1', undefined],
      ['PUT', '/v1/me/player/play', 'DEV1', undefined],
    ]);
  });
  it('treats "already paused" (403 restriction) as success but not a Premium error', async () => {
    api(() => error(403, 'UNKNOWN', 'Restriction violated'));
    await expect(setup().provider.pause()).resolves.toBeUndefined();
    api(() => error(403, 'PREMIUM_REQUIRED'));
    await expect(setup().provider.pause()).rejects.toMatchObject({ code: 'premiumRequired' });
  });
});

describe('search and devices', () => {
  it('searches tracks with limit 10 and maps them to track references', async () => {
    const seen = api(() =>
      HttpResponse.json({
        tracks: {
          items: [
            {
              id: 'abc',
              name: 'Song',
              duration_ms: 215_400,
              artists: [{ name: 'A' }, { name: 'B' }],
            },
            { id: 'def', name: 'Solo', duration_ms: 1000, artists: [] },
          ],
        },
      }),
    );
    const out = await setup().provider.search('  daft punk  ');
    expect(seen[0]).toMatchObject({
      method: 'GET',
      path: '/v1/search',
      query: { q: 'daft punk', type: 'track', limit: '10' },
    });
    expect(out).toEqual([
      {
        provider: 'spotify',
        id: 'abc',
        title: 'Song',
        artist: 'A, B',
        durationSec: 215,
        startAtSec: 0,
      },
      { provider: 'spotify', id: 'def', title: 'Solo', durationSec: 1, startAtSec: 0 },
    ]);
  });
  it('returns nothing for a blank query without a request', async () => {
    const seen = api();
    expect(await setup().provider.search('   ')).toEqual([]);
    expect(seen).toHaveLength(0);
  });
  it('fails cleanly on an unexpected response shape', async () => {
    api(() => HttpResponse.json({ nope: true }));
    await expect(setup().provider.search('x')).rejects.toMatchObject({ code: 'http' });
    await expect(setup().provider.listDevices()).rejects.toMatchObject({ code: 'http' });
  });
  it('lists devices with ids only', async () => {
    api(() =>
      HttpResponse.json({
        devices: [
          { id: 'A', name: 'Phone', type: 'Smartphone', is_active: true },
          { id: null, name: 'X', type: 'Speaker', is_active: false },
        ],
      }),
    );
    expect(await setup().provider.listDevices()).toEqual([
      { id: 'A', name: 'Phone', type: 'Smartphone', isActive: true },
    ]);
  });
});
