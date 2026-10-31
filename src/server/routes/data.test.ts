import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../app';
import { serverConfig } from '../config';
import { warmUpServer } from '../test-warmup';

await warmUpServer();

let app: FastifyInstance;
beforeEach(async () => {
  app = await buildServer({ dbPath: ':memory:' });
});
afterEach(async () => {
  await app.close();
});

const player = { id: 'p1', name: 'Ola', ftp: 200 };

describe('data routes', () => {
  it('400 on invalid player without a stack trace', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/players/p1',
      payload: { ...player, ftp: 9999 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBeTruthy();
    expect(res.body).not.toMatch(/\bat .*\(/);
    expect((await app.inject({ method: 'GET', url: '/api/players/p1' })).statusCode).toBe(404);
  });

  it('400 when body id differs from URL id', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/players/other', payload: player });
    expect(res.statusCode).toBe(400);
  });

  it('404 on unknown collection', async () => {
    for (const [method, url] of [
      ['GET', '/api/nope'],
      ['GET', '/api/nope/1'],
      ['PUT', '/api/nope/1'],
      ['DELETE', '/api/nope/1'],
      ['GET', '/api/constructor'],
    ] as const) {
      const res = await app.inject({ method, url, payload: method === 'PUT' ? {} : undefined });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
  });

  it('PUT, GET, list and DELETE a player', async () => {
    expect(
      (await app.inject({ method: 'PUT', url: '/api/players/p1', payload: player })).statusCode,
    ).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/players/p1' })).json()).toEqual(player);
    expect((await app.inject({ method: 'GET', url: '/api/players' })).json()).toEqual([player]);
    expect((await app.inject({ method: 'DELETE', url: '/api/players/p1' })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/players/p1' })).statusCode).toBe(404);
  });

  it('settings and active-session return 204 when unset', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/settings' })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/active-session' })).statusCode).toBe(204);
    expect(
      (await app.inject({ method: 'PUT', url: '/api/settings', payload: { bad: true } }))
        .statusCode,
    ).toBe(400);
  });

  it('import rejects bad bundles with 400 and a reason', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/import', payload: { app: 'other' } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'wrongApp' });
    const bad = await app.inject({
      method: 'POST',
      url: '/api/import',
      payload: { app: 'spinning-tutor', schemaVersion: 2 },
    });
    expect(bad.json()).toMatchObject({ error: 'unsupportedVersion' });
  });

  it('malformed JSON gives a 400 JSON error', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/players/p1',
      headers: { 'content-type': 'application/json' },
      payload: '{nope',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBeTruthy();
  });
});

it('server is configured to listen on 127.0.0.1 only', () => {
  expect(serverConfig.host).toBe('127.0.0.1');
});
