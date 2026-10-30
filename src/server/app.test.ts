import { expect, it } from 'vitest';
import { buildServer } from './app';

it('GET /api/health returns ok', async () => {
  const app = await buildServer({ dbPath: ':memory:' });
  const res = await app.inject({ method: 'GET', url: '/api/health' });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ ok: true });
  await app.close();
});
