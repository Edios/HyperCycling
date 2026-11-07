import { describe, expect, it, vi } from 'vitest';
import type { KeyValueStorage } from '../getsongbpm/client';
import { GetSongBpmError } from '../getsongbpm/client';
import { createBpmLookup } from '../bpmLookup';
import { createDeezerClient, type JsonpLoader } from './client';

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

const search = (...items: { id: number; title: string; artist: string }[]) => ({
  data: items.map((i) => ({ id: i.id, title: i.title, artist: { name: i.artist } })),
});
const track = (id: number, bpm: number) => ({
  id,
  bpm,
  link: `https://www.deezer.com/track/${id}`,
});

/** A fake JSONP endpoint: routes by path, records the URLs asked for. */
function setup(
  routes: Record<string, unknown>,
  extra: Parameters<typeof createDeezerClient>[0] = {},
) {
  const urls: URL[] = [];
  const jsonp: JsonpLoader = (build) => {
    const u = new URL(build('cb_test'));
    urls.push(u);
    const body = routes[u.pathname];
    if (body instanceof Error) return Promise.reject(body);
    return Promise.resolve(body);
  };
  const storage = memoryStorage();
  const client = createDeezerClient({ jsonp, storage, ...extra });
  return { client, urls, storage };
}

describe('Deezer client', () => {
  it('searches by artist and title, then reads the tempo from /track/{id}', async () => {
    const { client, urls } = setup({
      '/search': search({ id: 7, title: 'Lose Yourself', artist: 'Eminem' }),
      '/track/7': track(7, 171.6),
    });
    const hit = await client.lookupBpm({ title: 'Lose Yourself', artist: 'Eminem' });
    expect(hit).toEqual({
      title: 'Lose Yourself',
      artist: 'Eminem',
      bpm: 172,
      url: 'https://www.deezer.com/track/7',
    });
    expect(urls[0]?.searchParams.get('q')).toBe('Eminem Lose Yourself');
    expect(urls[0]?.searchParams.get('output')).toBe('jsonp');
    expect(urls[0]?.searchParams.get('callback')).toBe('cb_test');
    expect(urls[1]?.pathname).toBe('/track/7');
  });

  it('treats bpm 0 as no data and tries the next song with the same title', async () => {
    const { client } = setup({
      '/search': search(
        { id: 1, title: 'Song', artist: 'A' },
        { id: 2, title: 'Song', artist: 'B' },
      ),
      '/track/1': track(1, 0),
      '/track/2': track(2, 120),
    });
    expect((await client.lookupBpm({ title: 'Song' }))?.bpm).toBe(120);
  });

  it('returns undefined when every candidate has bpm 0', async () => {
    const { client } = setup({
      '/search': search({ id: 1, title: 'Song', artist: 'A' }),
      '/track/1': track(1, 0),
    });
    expect(await client.lookupBpm({ title: 'Song', artist: 'A' })).toBeUndefined();
  });

  it('ignores songs with a different title and prefers the matching artist', async () => {
    const { client, urls } = setup({
      '/search': search(
        { id: 1, title: 'Song (Cover Medley)', artist: 'X' },
        { id: 2, title: 'song', artist: 'Other' },
        { id: 3, title: 'Song', artist: 'Right' },
      ),
      '/track/3': track(3, 100),
      '/track/2': track(2, 90),
    });
    const hit = await client.lookupBpm({ title: 'Song', artist: 'Right' });
    expect(hit?.bpm).toBe(100);
    expect(urls.map((u) => u.pathname)).not.toContain('/track/1');
  });

  it('rejects out-of-range tempos and links outside deezer.com', async () => {
    const { client } = setup({
      '/search': search(
        { id: 1, title: 'Song', artist: 'A' },
        { id: 2, title: 'Song', artist: 'B' },
      ),
      '/track/1': track(1, 500),
      '/track/2': { id: 2, bpm: 100, link: 'https://evil.example/x' },
    });
    expect(await client.lookupBpm({ title: 'Song' })).toBeUndefined();
  });

  it('caches hits and misses locally', async () => {
    const found = setup({
      '/search': search({ id: 1, title: 'Song', artist: 'A' }),
      '/track/1': track(1, 128),
    });
    await found.client.lookupBpm({ title: 'Song', artist: 'A' });
    const calls = found.urls.length;
    expect((await found.client.lookupBpm({ title: ' SONG ', artist: 'a' }))?.bpm).toBe(128);
    expect(found.urls).toHaveLength(calls);
    // A fresh client reads the same storage.
    const again = createDeezerClient({
      jsonp: () => Promise.reject(new Error('must not be called')),
      storage: found.storage,
    });
    expect((await again.lookupBpm({ title: 'Song', artist: 'A' }))?.bpm).toBe(128);

    const miss = setup({ '/search': { data: [] } });
    expect(await miss.client.lookupBpm({ title: 'Nothing' })).toBeUndefined();
    await miss.client.lookupBpm({ title: 'Nothing' });
    expect(miss.urls).toHaveLength(1);
  });

  it('expires cache entries', async () => {
    let t = 0;
    const { client, urls } = setup({ '/search': { data: [] } }, { now: () => t });
    await client.lookupBpm({ title: 'Nothing' });
    t = 8 * 24 * 3_600_000;
    await client.lookupBpm({ title: 'Nothing' });
    expect(urls).toHaveLength(2);
  });

  it('ignores a corrupted cache', async () => {
    const storage = memoryStorage();
    storage.setItem('hypercycling.deezer.cache', '{"s:song|":{"at":1,"ttl":9e12,"v":{"bpm":"x"}}}');
    const jsonp = vi.fn<JsonpLoader>(() => Promise.resolve({ data: [] }));
    const client = createDeezerClient({ jsonp, storage, now: () => 5 });
    expect(await client.lookupBpm({ title: 'Song' })).toBeUndefined();
    expect(jsonp).toHaveBeenCalled();
  });

  it('maps load failures and API errors to GetSongBpmError for deezer', async () => {
    const net = setup({ '/search': new Error('load') });
    await expect(net.client.lookupBpm({ title: 'x' })).rejects.toMatchObject({
      kind: 'network',
      provider: 'deezer',
    });
    const quota = setup({ '/search': { error: { type: 'Exception', code: 4 } } });
    await expect(quota.client.lookupBpm({ title: 'x' })).rejects.toMatchObject({
      kind: 'rate-limited',
    });
    const odd = setup({ '/search': 'not an object' });
    await expect(odd.client.lookupBpm({ title: 'x' })).rejects.toBeInstanceOf(GetSongBpmError);
  });

  it('keeps its own request ceiling', async () => {
    const { client } = setup({ '/search': { data: [] } }, { maxPerHour: 1 });
    await client.lookupBpm({ title: 'a' });
    await expect(client.lookupBpm({ title: 'b' })).rejects.toMatchObject({ kind: 'rate-limited' });
  });
});

describe('createBpmLookup', () => {
  const dz = (bpm?: number) => ({
    lookupBpm: vi.fn(() =>
      Promise.resolve(bpm ? { title: 't', bpm, url: 'https://www.deezer.com/track/1' } : undefined),
    ),
  });
  const gs = (bpm?: number) => ({
    lookupBpm: vi.fn(() =>
      Promise.resolve(
        bpm ? { title: 't', bpm, url: 'https://getsongbpm.com/song/t/x' } : undefined,
      ),
    ),
    findByBpm: vi.fn(() => Promise.resolve([])),
  });

  it('uses Deezer without a key', async () => {
    const lookup = createBpmLookup(undefined, dz(110));
    expect(lookup.suggestions).toBeUndefined();
    expect(await lookup.lookup({ title: 't' })).toEqual({ bpm: 110, source: 'deezer' });
  });

  it('prefers GetSongBPM and does not ask Deezer when it answers', async () => {
    const d = dz(110);
    expect(await createBpmLookup(gs(180), d).lookup({ title: 't' })).toEqual({
      bpm: 180,
      source: 'getsongbpm',
    });
    expect(d.lookupBpm).not.toHaveBeenCalled();
  });

  it('falls back to Deezer when GetSongBPM does not know the song or fails', async () => {
    expect((await createBpmLookup(gs(), dz(99)).lookup({ title: 't' }))?.source).toBe('deezer');
    const failing = {
      ...gs(),
      lookupBpm: () => Promise.reject(new GetSongBpmError('unauthorized')),
    };
    expect((await createBpmLookup(failing, dz(99)).lookup({ title: 't' }))?.source).toBe('deezer');
  });

  it('reports the key error when both fail to find anything', async () => {
    const failing = {
      ...gs(),
      lookupBpm: () => Promise.reject(new GetSongBpmError('unauthorized')),
    };
    await expect(createBpmLookup(failing, dz()).lookup({ title: 't' })).rejects.toMatchObject({
      kind: 'unauthorized',
    });
    expect(await createBpmLookup(gs(), dz()).lookup({ title: 't' })).toBeUndefined();
  });
});
