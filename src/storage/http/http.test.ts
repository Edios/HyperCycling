import type { FastifyInstance } from 'fastify';
import { afterEach, expect, it } from 'vitest';
import { buildServer } from '../../server/app';
import { runRepositoryContract } from '../contract';
import { createHttpRepositories } from './index';
import { warmUpServer } from '../../server/test-warmup';

await warmUpServer();

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

/** fetch implementation that routes requests into an in-process Fastify app. */
function injectFetch(app: FastifyInstance): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const res = await app.inject({
      method: req.method as 'GET',
      url: url.pathname + url.search,
      headers: Object.fromEntries(req.headers.entries()),
      payload: req.method === 'GET' ? undefined : await req.text(),
    });
    const headers = new Headers();
    for (const [k, v] of Object.entries(res.headers)) {
      if (typeof v === 'string') headers.set(k, v);
    }
    const noBody = res.statusCode === 204 || res.statusCode === 304;
    return new Response(noBody ? null : new Uint8Array(res.rawPayload), {
      status: res.statusCode,
      headers,
    });
  }) as typeof fetch;
}

async function makeRepos() {
  const app = await buildServer({ dbPath: ':memory:' });
  apps.push(app);
  return createHttpRepositories('http://127.0.0.1:5175', injectFetch(app));
}

runRepositoryContract('http', makeRepos);

it('surfaces the server error message for an invalid player', async () => {
  const repos = await makeRepos();
  await expect(repos.players.put({ id: 'x', name: 'Ola', ftp: 9999 })).rejects.toThrow(/players/);
});
