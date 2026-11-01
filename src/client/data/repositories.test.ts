import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRepositories, resetRepositoriesForTests } from './repositories';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetRepositoriesForTests();
});

describe('getRepositories', () => {
  it('uses IndexedDB when VITE_STORAGE=indexeddb and is a singleton', async () => {
    vi.stubEnv('VITE_STORAGE', 'indexeddb');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const a = await getRepositories();
    const b = await getRepositories();
    expect(a).toBe(b);
    await a.players.put({ id: 'p1', name: 'Ola', ftp: 200 });
    expect((await a.players.list()).map((p) => p.id)).toEqual(['p1']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('uses the HTTP API otherwise', async () => {
    vi.stubEnv('VITE_STORAGE', 'http');
    const fetchSpy = vi.fn(async () => new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const repos = await getRepositories();
    await repos.players.list();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url] = fetchSpy.mock.calls[0] as unknown as [string];
    expect(url).toMatch(/\/api\/players$/);
  });

  it('shares one in-flight creation between concurrent callers', async () => {
    vi.stubEnv('VITE_STORAGE', 'http');
    vi.stubGlobal('fetch', vi.fn());
    const [a, b] = await Promise.all([getRepositories(), getRepositories()]);
    expect(a).toBe(b);
  });
});
