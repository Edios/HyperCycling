import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../domain/settings';
import { SERVER_CSP } from '../shared/csp';
import { bundle } from '../storage/contract';
import { buildServer } from './app';

const PORT = 5175;
const HOST = `127.0.0.1:${PORT}`;
const ORIGIN = `http://${HOST}`;
const EVIL = 'https://evil.example';

let app: FastifyInstance;
beforeEach(async () => {
  app = await buildServer({ dbPath: ':memory:', port: PORT });
});
afterEach(async () => {
  await app.close();
});

const player = { id: 'p1', name: 'Ola', ftp: 200 };
const listPlayers = async (): Promise<unknown[]> =>
  (await app.inject({ method: 'GET', url: '/api/players', headers: { host: HOST } })).json<
    unknown[]
  >();

describe('Host allowlist (DNS rebinding)', () => {
  it('serves the exact loopback hosts on the server port', async () => {
    const hosts = [`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`, `LOCALHOST:${PORT}`];
    for (const host of hosts) {
      const res = await app.inject({ method: 'GET', url: '/api/health', headers: { host } });
      expect(res.statusCode, host).toBe(200);
    }
  });

  it('answers 421 for any other Host, on every route', async () => {
    const hosts = [
      `attacker.example:${PORT}`,
      'attacker.example',
      '127.0.0.1',
      `127.0.0.1:${PORT + 1}`,
      `127.0.0.1.attacker.example:${PORT}`,
      `localhost.attacker.example:${PORT}`,
    ];
    for (const host of hosts) {
      for (const url of ['/api/health', '/api/settings', '/api/export', '/']) {
        const res = await app.inject({ method: 'GET', url, headers: { host } });
        expect(res.statusCode, `${host} ${url}`).toBe(421);
      }
    }
  });

  it('allows an explicitly configured extra host', async () => {
    const custom = await buildServer({
      dbPath: ':memory:',
      port: PORT,
      extraAllowedHosts: ['dev.test:9000'],
    });
    const ok = await custom.inject({
      method: 'GET',
      url: '/api/health',
      headers: { host: 'dev.test:9000' },
    });
    expect(ok.statusCode).toBe(200);
    const no = await custom.inject({
      method: 'GET',
      url: '/api/health',
      headers: { host: 'dev.test:9001' },
    });
    expect(no.statusCode).toBe(421);
    await custom.close();
  });
});

describe('CSRF on state-changing requests', () => {
  it('rejects a text/plain POST /api/import (415) and changes nothing', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/players/p1',
      headers: { host: HOST },
      payload: player,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/import',
      headers: { host: HOST, 'content-type': 'text/plain', origin: EVIL },
      payload: JSON.stringify(bundle()),
    });
    // either guard may answer first; both stop the attack
    expect([403, 415]).toContain(res.statusCode);
    expect(await listPlayers()).toEqual([player]);
  });

  it('rejects text/plain with 415 even without an Origin header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/import',
      headers: { host: HOST, 'content-type': 'text/plain' },
      payload: JSON.stringify(bundle()),
    });
    expect(res.statusCode).toBe(415);
    expect(await listPlayers()).toEqual([]);
  });

  it('rejects form encodings and text/plain on PUT with 415', async () => {
    for (const type of ['application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/import',
        headers: { host: HOST, 'content-type': type },
        payload: 'a=b',
      });
      expect(res.statusCode, type).toBe(415);
    }
    const put = await app.inject({
      method: 'PUT',
      url: '/api/players/p1',
      headers: { host: HOST, 'content-type': 'text/plain' },
      payload: JSON.stringify(player),
    });
    expect(put.statusCode).toBe(415);
  });

  it('the server import route refuses a JSON string body (no server-side JSON.parse)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/import',
      headers: { host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify(JSON.stringify(bundle())),
    });
    expect(res.statusCode).toBe(400);
    expect(await listPlayers()).toEqual([]);
  });

  it('rejects a foreign Origin on PUT, POST and DELETE with 403', async () => {
    const cases = [
      ['PUT', '/api/players/p1', player],
      ['POST', '/api/import', bundle()],
      ['DELETE', '/api/players/p1', undefined],
      ['DELETE', '/api/settings', undefined],
    ] as const;
    for (const [method, url, payload] of cases) {
      const res = await app.inject({
        method,
        url,
        headers: { host: HOST, origin: EVIL },
        ...(payload ? { payload } : {}),
      });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
    expect(await listPlayers()).toEqual([]);
  });

  it('rejects Origin "null" and cross-site Sec-Fetch-Site', async () => {
    const nul = await app.inject({
      method: 'PUT',
      url: '/api/players/p1',
      headers: { host: HOST, origin: 'null' },
      payload: player,
    });
    expect(nul.statusCode).toBe(403);
    for (const site of ['cross-site', 'same-site']) {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/players/p1',
        headers: { host: HOST, 'sec-fetch-site': site },
        payload: player,
      });
      expect(res.statusCode, site).toBe(403);
    }
    expect(await listPlayers()).toEqual([]);
  });

  it('still accepts same-origin browser requests, Origin-less clients and the Vite dev client', async () => {
    const same = await app.inject({
      method: 'PUT',
      url: '/api/players/p1',
      headers: { host: HOST, origin: ORIGIN, 'sec-fetch-site': 'same-origin' },
      payload: player,
    });
    expect(same.statusCode).toBe(204);
    const noOrigin = await app.inject({
      method: 'DELETE',
      url: '/api/players/p1',
      headers: { host: HOST },
    });
    expect(noOrigin.statusCode).toBe(204);
    const dev = await app.inject({
      method: 'PUT',
      url: '/api/players/p1',
      headers: { host: HOST, origin: 'http://127.0.0.1:5173' },
      payload: player,
    });
    expect(dev.statusCode).toBe(204);
    const imp = await app.inject({
      method: 'POST',
      url: '/api/import',
      headers: { host: HOST, origin: ORIGIN },
      payload: bundle(),
    });
    expect(imp.statusCode).toBe(204);
  });
});

describe('secrets never leave in an export', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    spotify: {
      clientId: 'cid',
      accessToken: 'AT-SECRET',
      refreshToken: 'RT-SECRET',
      expiresAt: 123,
    },
  };

  it('GET /api/export has no Spotify tokens; /api/settings keeps them for the client', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { host: HOST },
      payload: settings,
    });
    expect(put.statusCode).toBe(204);

    const exp = await app.inject({ method: 'GET', url: '/api/export', headers: { host: HOST } });
    expect(exp.statusCode).toBe(200);
    for (const secret of ['AT-SECRET', 'RT-SECRET', 'accessToken', 'refreshToken', 'expiresAt']) {
      expect(exp.body, secret).not.toContain(secret);
    }
    expect(
      exp.json<{ settings: { spotify: { clientId: string } } }>().settings.spotify.clientId,
    ).toBe('cid');

    const own = await app.inject({ method: 'GET', url: '/api/settings', headers: { host: HOST } });
    expect(own.body).toContain('RT-SECRET');
  });
});

describe('security headers', () => {
  it('sets CSP, nosniff, referrer policy and framing protection on every response', async () => {
    for (const url of ['/api/health', '/api/nope']) {
      const res = await app.inject({ method: 'GET', url, headers: { host: HOST } });
      expect(res.headers['content-security-policy'], url).toBe(SERVER_CSP);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
      expect(res.headers['x-frame-options']).toBe('DENY');
    }
  });

  it('the CSP forbids framing and plugins, and trusts only the known third parties', () => {
    expect(SERVER_CSP).toContain("frame-ancestors 'none'");
    expect(SERVER_CSP).toContain("object-src 'none'");
    expect(SERVER_CSP).toContain("default-src 'self'");
    expect(SERVER_CSP).not.toContain("'unsafe-eval'");
    expect(SERVER_CSP).not.toContain("'unsafe-inline'");
    expect(SERVER_CSP).toContain('https://www.youtube.com');
    expect(SERVER_CSP).toContain('https://api.spotify.com');
    expect(SERVER_CSP).toContain('https://accounts.spotify.com');
  });

  it('rejected requests (421, 403, 415) carry the headers too', async () => {
    const bad = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { host: 'x.example' },
    });
    expect(bad.statusCode).toBe(421);
    expect(bad.headers['x-content-type-options']).toBe('nosniff');
    expect(bad.headers['content-security-policy']).toBe(SERVER_CSP);
  });
});

describe('information disclosure', () => {
  it('/api/health does not reveal the database path', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health', headers: { host: HOST } });
    expect(res.json()).not.toHaveProperty('dbPath');
  });

  it('the data location has its own, equally guarded endpoint', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/location', headers: { host: HOST } });
    expect(res.json()).toEqual({ dbPath: ':memory:' });
    const rebinding = await app.inject({
      method: 'GET',
      url: '/api/location',
      headers: { host: 'x.example' },
    });
    expect(rebinding.statusCode).toBe(421);
  });
});
