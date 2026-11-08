import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpotifySettings } from '../../../domain/settings';
import type { TrackRef } from '../../../domain/workout';
import { SPOTIFY_TOKEN_URL } from './auth';
import type { SpotifyStore } from './client';
import { SpotifyError } from './errors';
import { createSpotifyProvider } from './provider';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** Fake clock: sleeping advances it, and every Web API request can take `latency` ms. */
const clock = { t: 0, latency: 0 };

const API = 'https://api.spotify.com';
const NOW = 1_700_000_000_000;
beforeEach(() => {
  clock.t = NOW;
  clock.latency = 0;
});
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
    now: () => clock.t,
    sleep: (ms) => {
      sleeps.push(ms);
      clock.t += ms;
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
      clock.t += clock.latency;
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
    ['403 other -> forbidden', error(403, 'UNKNOWN', 'Something else'), 'forbidden'],
    [
      '403 restriction -> restrictionViolated',
      error(403, 'UNKNOWN', 'Player command failed: Restriction violated'),
      'restrictionViolated',
    ],
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

  it('also drops credentials on invalid_client', async () => {
    tokenEndpoint(() => HttpResponse.json({ error: 'invalid_client' }, { status: 401 }));
    const { provider, state } = setup({ ...FRESH, expiresAt: NOW });
    await expect(provider.connect()).rejects.toMatchObject({ code: 'notAuthorized' });
    expect(state.cfg).toEqual({ clientId: 'cid', deviceId: 'DEV1' });
  });

  it('keeps credentials on a 429 from the token endpoint and reports rateLimited', async () => {
    tokenEndpoint(() => new HttpResponse(null, { status: 429, headers: { 'Retry-After': '3' } }));
    const { provider, state } = setup({ ...FRESH, expiresAt: NOW });
    await expect(provider.connect()).rejects.toMatchObject({
      code: 'rateLimited',
      retryAfterSec: 3,
    });
    expect(state.cfg).toEqual({ ...FRESH, expiresAt: NOW });
    expect(state.writes).toHaveLength(0);
  });

  it.each([
    ['500', () => new HttpResponse(null, { status: 500 })],
    ['503', () => new HttpResponse(null, { status: 503 })],
    ['proxy 403', () => new HttpResponse('<html>blocked</html>', { status: 403 })],
    ['400 invalid_request', () => HttpResponse.json({ error: 'invalid_request' }, { status: 400 })],
    ['400 without body', () => new HttpResponse(null, { status: 400 })],
  ])('keeps credentials on a token endpoint %s (transient http error)', async (_n, response) => {
    tokenEndpoint(response);
    const { provider, state } = setup({ ...FRESH, expiresAt: NOW });
    await expect(provider.connect()).rejects.toMatchObject({ code: 'http' });
    expect(state.writes).toHaveLength(0);
    expect(state.cfg?.refreshToken).toBe('RT-live');
  });

  it('does not wipe tokens another client already rotated (compare-and-clear)', async () => {
    const { provider, state } = setup({ ...FRESH, expiresAt: NOW });
    tokenEndpoint(() => {
      // while our refresh is in flight, another instance saved a rotated refresh token
      state.cfg = { ...FRESH, refreshToken: 'RT-rotated-elsewhere' };
      return HttpResponse.json({ error: 'invalid_grant' }, { status: 400 });
    });
    await expect(provider.connect()).rejects.toMatchObject({ code: 'notAuthorized' });
    expect(state.cfg?.refreshToken).toBe('RT-rotated-elsewhere');
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

/** Answers GET /v1/me/player with a device at `volume`; every other request gets 204. */
const playerAt =
  (volume: number | null, id = 'DEV1') =>
  (s: Seen): Response | undefined =>
    s.method === 'GET' && s.path === '/v1/me/player'
      ? HttpResponse.json({ device: { id, volume_percent: volume } })
      : undefined;

const volumeCalls = (seen: Seen[]) =>
  seen.filter((s) => s.path.endsWith('/volume')).map((s) => s.query.volume_percent);

describe('volume and fade', () => {
  it('reads the device volume, fades from it to 0 in 6 steps, pauses and restores that volume', async () => {
    const seen = api(playerAt(40));
    const { provider, sleeps } = setup();
    await provider.fadeOut(1500);
    expect(sleeps).toEqual([250, 250, 250, 250, 250, 250]);
    expect(seen.map((s) => `${s.method} ${s.path} ${s.query.volume_percent ?? ''}`.trim())).toEqual(
      [
        'GET /v1/me/player',
        'PUT /v1/me/player/volume 33',
        'PUT /v1/me/player/volume 27',
        'PUT /v1/me/player/volume 20',
        'PUT /v1/me/player/volume 13',
        'PUT /v1/me/player/volume 7',
        'PUT /v1/me/player/volume 0',
        'PUT /v1/me/player/pause',
        'PUT /v1/me/player/volume 40',
      ],
    );
    expect(seen.slice(1).every((s) => s.query.device_id === 'DEV1')).toBe(true);
  });

  it('never goes above the starting level and restores it (not 100)', async () => {
    const seen = api(playerAt(35));
    await setup().provider.fadeOut(600);
    const levels = volumeCalls(seen).map(Number);
    expect(Math.max(...levels.slice(0, 6))).toBeLessThanOrEqual(35);
    expect(levels.at(-1)).toBe(35);
  });

  it('fades a full-volume device from 100', async () => {
    const seen = api(playerAt(100));
    await setup().provider.fadeOut(600);
    expect(volumeCalls(seen)).toEqual(['83', '67', '50', '33', '17', '0', '100']);
  });

  it('only pauses, without touching the volume, when the device reports none', async () => {
    for (const reply of [playerAt(null), playerAt(50, 'OTHER-DEVICE'), () => undefined]) {
      const seen = api(reply);
      await setup().provider.fadeOut(600);
      expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual([
        'GET /v1/me/player',
        'PUT /v1/me/player/pause',
      ]);
      server.resetHandlers();
    }
  });

  it('schedules steps from the start so slow requests do not stretch the fade', async () => {
    clock.latency = 100;
    api(playerAt(60));
    const { provider, sleeps } = setup();
    const before = clock.t;
    await provider.fadeOut(1200);
    // start = after the GET (t=100); step i is due at start + 200 i, and each PUT takes 100 ms
    expect(sleeps).toEqual([200, 100, 100, 100, 100, 100]);
    // GET 100 + six steps ending at 1300 + the last PUT 100 + pause 100 + restore 100
    expect(clock.t - before).toBe(1600);
  });

  it('setVolume sets an absolute level and clamps to 0..100 percent', async () => {
    const seen = api();
    const { provider } = setup();
    await provider.setVolume(0.6);
    await provider.setVolume(2);
    await provider.setVolume(-1);
    expect(volumeCalls(seen)).toEqual(['60', '100', '0']);
  });

  it('mute remembers the device level and unmute restores it, not 100 %', async () => {
    const seen = api(playerAt(40));
    const { provider } = setup();
    await provider.setVolume(0);
    await provider.setVolume(0); // muting again must not remember 0
    await provider.setVolume(1);
    expect(volumeCalls(seen)).toEqual(['0', '0', '40']);
    await provider.setVolume(1); // forgotten after the restore: a plain full level
    expect(volumeCalls(seen).at(-1)).toBe('100');
  });

  it('mute still works when the device level cannot be read', async () => {
    const seen = api((s) =>
      s.method === 'GET' && s.path === '/v1/me/player' ? error(500, '') : undefined,
    );
    const { provider } = setup();
    await provider.setVolume(0);
    await provider.setVolume(1);
    expect(volumeCalls(seen)).toEqual(['0', '100']);
  });

  it('puts the original volume back even when a fade step fails, and reports the failure', async () => {
    let puts = 0;
    const seen = api((s) => {
      const player = playerAt(40)(s);
      if (player) return player;
      if (!s.path.endsWith('/volume')) return undefined;
      puts++;
      return puts === 3 ? error(429, '') : undefined;
    });
    const { provider } = setup();
    await expect(provider.fadeOut(600)).rejects.toMatchObject({ code: 'rateLimited' });
    expect(seen.at(-1)?.query.volume_percent).toBe('40');
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
    api(() => error(403, 'UNKNOWN', 'Player command failed: Restriction violated'));
    await expect(setup().provider.pause()).resolves.toBeUndefined();
    api(() => error(403, 'UNKNOWN', 'Something else'));
    await expect(setup().provider.pause()).rejects.toMatchObject({ code: 'forbidden' });
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

describe('describeTrack', () => {
  it('reads the name and artists of a track', async () => {
    const seen = api(() =>
      HttpResponse.json({ id: 'abc', name: 'Song', artists: [{ name: 'A' }, { name: 'B' }] }),
    );
    const info = await setup().provider.describeTrack({ ...track, id: 'abc', title: '' });
    expect(info).toEqual({ title: 'Song', artist: 'A, B' });
    expect(seen[0]).toMatchObject({ method: 'GET', path: '/v1/tracks/abc' });
  });
  it('fails on an unexpected shape', async () => {
    api(() => HttpResponse.json({ nope: 1 }));
    await expect(setup().provider.describeTrack(track)).rejects.toMatchObject({ code: 'http' });
  });
});

describe('playlists (library import)', () => {
  it('lists the user playlists and reads the item count of either API shape', async () => {
    const seen = api(() =>
      HttpResponse.json({
        items: [
          { id: 'p1', name: 'Climb', items: { total: 12 } },
          null,
          { id: 'p2', name: 'Old', tracks: { total: 3 } },
        ],
        next: null,
      }),
    );
    const out = await setup().provider.listPlaylists();
    expect(seen[0]).toMatchObject({ path: '/v1/me/playlists', query: { limit: '50' } });
    expect(out).toEqual([
      { id: 'p1', name: 'Climb', total: 12 },
      { id: 'p2', name: 'Old', total: 3 },
    ]);
  });

  it('reads playlist items from /items, skipping episodes, local files and gaps', async () => {
    const seen = api(() =>
      HttpResponse.json({
        items: [
          {
            item: {
              id: 'aaa',
              name: 'One',
              type: 'track',
              artists: [{ name: 'X' }, { name: 'Y' }],
            },
          },
          { item: { id: 'bbb', name: 'Pod', type: 'episode' } },
          { track: { id: 'ccc', name: 'Old shape', artists: [] } },
          { item: { id: 'ddd', name: 'Local', is_local: true } },
          { item: null },
          null,
        ],
        next: null,
      }),
    );
    const out = await setup().provider.playlistTracks('PL/1');
    expect(seen[0]).toMatchObject({ path: '/v1/playlists/PL%2F1/items' });
    expect(out).toEqual([
      { id: 'aaa', title: 'One', artist: 'X, Y' },
      { id: 'ccc', title: 'Old shape' },
    ]);
  });

  it('pages through long playlists and stops at the limit', async () => {
    const page = (n: number) =>
      Array.from({ length: 50 }, (_, i) => ({
        item: { id: `t${n}x${i}`, name: `S${n}-${i}`, type: 'track', artists: [] },
      }));
    const seen = api((r) =>
      HttpResponse.json({ items: page(Number(r.query.offset) / 50), next: 'more' }),
    );
    const out = await setup().provider.playlistTracks('p', 120);
    expect(out).toHaveLength(120);
    expect(seen.map((s) => s.query.offset)).toEqual(['0', '50', '100']);
  });

  it('reports a missing playlist permission as forbidden', async () => {
    api(() => error(403, '', 'Insufficient client scope'));
    await expect(setup().provider.listPlaylists()).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('searchTracks (region check)', () => {
  const item = (extra: Record<string, unknown> = {}) => ({
    id: 'abc',
    name: 'Song',
    duration_ms: 200_000,
    artists: [{ name: 'A' }],
    explicit: false,
    ...extra,
  });

  it('asks for the rider market and keeps is_playable', async () => {
    const seen = api(() =>
      HttpResponse.json({
        tracks: { items: [item({ is_playable: false }), item({ id: 'def', is_playable: true })] },
      }),
    );
    const out = await setup().provider.searchTracks('track:Song artist:A');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.query).toMatchObject({ market: 'from_token', type: 'track' });
    expect(out.map((h) => h.playable)).toEqual([false, true]);
  });

  it('leaves playable undefined when Spotify sends no is_playable', async () => {
    api(() => HttpResponse.json({ tracks: { items: [item()] } }));
    const out = await setup().provider.searchTracks('q');
    expect(out[0]?.playable).toBeUndefined();
  });

  it('retries without market after a 4xx and reports the region as unverified', async () => {
    const seen = api((s) =>
      s.query.market
        ? error(403, '', 'Insufficient client scope')
        : HttpResponse.json({ tracks: { items: [item({ is_playable: true })] } }),
    );
    const out = await setup().provider.searchTracks('q');
    expect(seen).toHaveLength(2);
    expect(seen[0]?.query.market).toBe('from_token');
    expect(seen[1]?.query.market).toBeUndefined();
    // even if the answer carried a flag it was not computed for the rider's market
    expect(out[0]?.playable).toBeUndefined();
  });

  it('does not retry on 401, 429 or server errors', async () => {
    for (const status of [401, 429, 500]) {
      const seen = api(() => error(status, ''));
      await expect(setup().provider.searchTracks('q')).rejects.toBeDefined();
      expect(seen).toHaveLength(1);
    }
  });
});
