import type { FastifyInstance } from 'fastify';
import { afterEach, expect, it } from 'vitest';
import { createSqliteRepositories } from '../storage/sqlite';
import { buildServer } from './app';
import { parsePort } from './config';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

it('5xx errors return a generic message, never internals', async () => {
  const repositories = createSqliteRepositories(':memory:');
  repositories.workouts.list = () => Promise.reject(new Error('secret /etc/path SELECT * FROM x'));
  app = await buildServer({ dbPath: ':memory:', repositories });
  const res = await app.inject({ method: 'GET', url: '/api/workouts' });
  expect(res.statusCode).toBe(500);
  expect(res.json()).toEqual({ error: 'Internal server error' });
  expect(res.body).not.toContain('secret');
});

it('API responses carry no CORS allow-origin header', async () => {
  app = await buildServer({ dbPath: ':memory:' });
  for (const url of ['/api/health', '/api/players', '/api/export']) {
    const headers = { origin: 'https://evil.example' };
    const res = await app.inject({ method: 'GET', url, headers });
    expect(res.headers['access-control-allow-origin'], url).toBeUndefined();
  }
});

it('rejects :id longer than 200 characters with 400', async () => {
  app = await buildServer({ dbPath: ':memory:' });
  const long = 'a'.repeat(201);
  for (const method of ['GET', 'PUT', 'DELETE'] as const) {
    const payload = method === 'PUT' ? {} : undefined;
    const res = await app.inject({ method, url: `/api/players/${long}`, payload });
    expect(res.statusCode, method).toBe(400);
  }
  const ok = await app.inject({ method: 'GET', url: `/api/players/${'a'.repeat(200)}` });
  expect(ok.statusCode).toBe(404);
});

it('parsePort falls back to 5175 for invalid values', () => {
  expect(parsePort(undefined)).toBe(5175);
  expect(parsePort('')).toBe(5175);
  expect(parsePort('abc')).toBe(5175);
  expect(parsePort('0')).toBe(5175);
  expect(parsePort('70000')).toBe(5175);
  expect(parsePort('12.5')).toBe(5175);
  expect(parsePort('8080')).toBe(8080);
});
