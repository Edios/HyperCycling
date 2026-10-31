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
