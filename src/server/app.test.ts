import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { buildTestServer as buildServer } from './test-support';
import { warmUpServer } from './test-warmup';

await warmUpServer();

it('GET /api/health returns ok', async () => {
  const app = await buildServer({ dbPath: ':memory:' });
  const res = await app.inject({ method: 'GET', url: '/api/health' });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ ok: true });
  expect(typeof res.json<{ version: unknown }>().version).toBe('string');
  expect(res.json()).not.toHaveProperty('dbPath');
  await app.close();
});

it('serves index.html from staticDir at /', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'st-static-'));
  writeFileSync(path.join(dir, 'index.html'), '<h1>hello static</h1>');
  const app = await buildServer({ dbPath: ':memory:', staticDir: dir });
  const res = await app.inject({ method: 'GET', url: '/' });
  expect(res.statusCode).toBe(200);
  expect(res.body).toContain('hello static');
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

it('a workout without a saved music plan answers 204, not a 404 the browser logs as an error', async () => {
  const app = await buildServer({ dbPath: ':memory:' });
  const none = await app.inject({ method: 'GET', url: '/api/soundtrack-plans/no-plan-yet' });
  expect(none.statusCode).toBe(204);
  expect(none.body).toBe('');
  // Other collections keep their 404 for a missing item.
  const missing = await app.inject({ method: 'GET', url: '/api/workouts/nope' });
  expect(missing.statusCode).toBe(404);
  await app.close();
});

it('stores a music plan, returns it by workout id and removes it again', async () => {
  const { planRecord } = await import('../storage/contract');
  const app = await buildServer({ dbPath: ':memory:' });
  const rec = planRecord('w1');
  const put = await app.inject({ method: 'PUT', url: '/api/soundtrack-plans/w1', payload: rec });
  expect(put.statusCode).toBe(204);
  const got = await app.inject({ method: 'GET', url: '/api/soundtrack-plans/w1' });
  expect(got.statusCode).toBe(200);
  expect(got.json()).toEqual(rec);
  const list = await app.inject({ method: 'GET', url: '/api/soundtrack-plans' });
  expect(list.json()).toEqual([rec]);
  const wrongId = await app.inject({
    method: 'PUT',
    url: '/api/soundtrack-plans/w2',
    payload: rec,
  });
  expect(wrongId.statusCode).toBe(400);
  const invalid = await app.inject({
    method: 'PUT',
    url: '/api/soundtrack-plans/w1',
    payload: { ...rec, schemaVersion: 9 },
  });
  expect(invalid.statusCode).toBe(400);
  const del = await app.inject({ method: 'DELETE', url: '/api/soundtrack-plans/w1' });
  expect(del.statusCode).toBe(204);
  expect((await app.inject({ method: 'GET', url: '/api/soundtrack-plans/w1' })).statusCode).toBe(
    204,
  );
  await app.close();
});
