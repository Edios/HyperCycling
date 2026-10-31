import { buildServer } from './app';

/**
 * Builds and closes one throwaway server so the one-off cold-start cost (Fastify's plugin
 * loading, Ajv, the SQLite binding, migrations) is paid while the test file is being collected
 * and not inside the first test's timer. That cost is ~1.5 s on an idle machine and grows several
 * times over when the whole suite runs in parallel, which made the first server test of a file
 * (app health, hardening 5xx) occasionally exceed the 5 s default timeout.
 *
 * Test files `await warmUpServer()` at module top level.
 */
export async function warmUpServer(): Promise<void> {
  const app = await buildServer({ dbPath: ':memory:' });
  await app.inject({ method: 'GET', url: '/api/health' });
  await app.close();
}
