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
    searchSongs: () => Promise.resolve([]),
    lookupBpm: vi.fn(() =>
      Promise.resolve(bpm ? { title: 't', bpm, url: 'https://www.deezer.com/track/1' } : undefined),
    ),
  });
  const gs = (bpm?: number) => ({
    searchSongs: () => Promise.resolve([]),
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
      searchSongs: () => Promise.resolve([]),
      lookupBpm: () => Promise.reject(new GetSongBpmError('unauthorized')),
    };
    expect((await createBpmLookup(failing, dz(99)).lookup({ title: 't' }))?.source).toBe('deezer');
  });

  it('reports the key error when both fail to find anything', async () => {
    const failing = {
      ...gs(),
      searchSongs: () => Promise.resolve([]),
      lookupBpm: () => Promise.reject(new GetSongBpmError('unauthorized')),
    };
    await expect(createBpmLookup(failing, dz()).lookup({ title: 't' })).rejects.toMatchObject({
      kind: 'unauthorized',
    });
    expect(await createBpmLookup(gs(), dz()).lookup({ title: 't' })).toBeUndefined();
  });
});

describe('Deezer searchSongs (M19d)', () => {
  const two = {
    '/search': search(
      { id: 1, title: 'Song A', artist: 'Band' },
      { id: 2, title: 'Song B', artist: 'Band' },
      { id: 3, title: 'No Tempo', artist: 'Band' },
    ),
    '/track/1': track(1, 128),
    '/track/2': track(2, 64.4),
    '/track/3': track(3, 0),
  };

  it('lists songs with a tempo, skipping those Deezer has no tempo for', async () => {
    const { client, urls } = setup(two);
    const hits = await client.searchSongs({ artist: 'Band', title: 'Song' });
    expect(hits.map((h) => [h.title, h.bpm])).toEqual([
      ['Song A', 128],
      ['Song B', 64],
    ]);
    expect(urls[0]?.searchParams.get('q')).toBe('Band Song');
  });

  it('serves a repeated search from the local cache, in storage', async () => {
    const { client, urls, storage } = setup(two);
    await client.searchSongs({ artist: 'Band', title: 'Song' });
    const asked = urls.length;
    expect((await client.searchSongs({ artist: 'Band', title: 'Song' })).length).toBe(2);
    expect(urls.length).toBe(asked);
    expect([...storage.data.values()].join()).not.toMatch(/audio|preview/i);
  });

  it('does not mix a cached search with a single lookup of the same words', async () => {
    const { client } = setup({
      ...two,
      '/search': search({ id: 1, title: 'Song A', artist: 'Band' }),
    });
    await client.searchSongs({ title: 'Song A', artist: 'Band' });
    expect((await client.lookupBpm({ title: 'Song A', artist: 'Band' }))?.bpm).toBe(128);
  });

  it('returns nothing for an empty query without asking Deezer', async () => {
    const { client, urls } = setup(two);
    expect(await client.searchSongs({ title: ' ' })).toEqual([]);
    expect(urls).toHaveLength(0);
  });

  it('ignores a corrupt cached list', async () => {
    const { client, storage } = setup(two);
    storage.data.set(
      'hypercycling.deezer.cache',
      JSON.stringify({ 'q:band song|5': { at: Date.now(), ttl: 1e12, v: [{ title: 1 }] } }),
    );
    expect((await client.searchSongs({ artist: 'Band', title: 'Song' })).length).toBe(2);
  });
});

describe('createBpmLookup.search (M19d)', () => {
  const dzHit = { title: 'Same', artist: 'X', bpm: 120, url: 'https://www.deezer.com/track/1' };
  const gsHit = { title: 'Same', artist: 'X', bpm: 120, url: 'https://getsongbpm.com/song/s/1' };
  const dz = (impl: () => Promise<(typeof dzHit)[]>) => ({
    lookupBpm: vi.fn(),
    searchSongs: vi.fn(impl),
  });
  const gs = (impl: () => Promise<(typeof gsHit)[]>) => ({
    lookupBpm: vi.fn(),
    findByBpm: vi.fn(),
    searchSongs: vi.fn(impl),
  });

  it('uses Deezer alone without a key', async () => {
    const lookup = createBpmLookup(
      undefined,
      dz(() => Promise.resolve([dzHit])),
    );
    const res = await lookup.search({ title: 'Same' });
    expect(res.hits).toEqual([{ ...dzHit, source: 'deezer' }]);
  });

  it('merges providers and lists the same song and tempo once, GetSongBPM first', async () => {
    const lookup = createBpmLookup(
      gs(() => Promise.resolve([gsHit])),
      dz(() => Promise.resolve([dzHit, { ...dzHit, title: 'Other', bpm: 90 }])),
    );
    const res = await lookup.search({ title: 'Same' });
    expect(res.hits.map((h) => [h.title, h.source])).toEqual([
      ['Same', 'getsongbpm'],
      ['Other', 'deezer'],
    ]);
  });

  it('falls back to the other provider when one fails, and reports it', async () => {
    const lookup = createBpmLookup(
      gs(() => Promise.reject(new GetSongBpmError('unauthorized'))),
      dz(() => Promise.resolve([dzHit])),
    );
    const res = await lookup.search({ title: 'Same' });
    expect(res.hits).toHaveLength(1);
    expect(res.errors.map((e) => e.kind)).toEqual(['unauthorized']);
  });

  it('can be limited to one provider', async () => {
    const d = dz(() => Promise.resolve([dzHit]));
    const g = gs(() => Promise.resolve([gsHit]));
    const res = await createBpmLookup(g, d).search({ title: 'Same' }, 'getsongbpm');
    expect(res.hits.map((h) => h.source)).toEqual(['getsongbpm']);
    expect(d.searchSongs).not.toHaveBeenCalled();
    await expect(
      createBpmLookup(undefined, d).search({ title: 'x' }, 'getsongbpm'),
    ).rejects.toMatchObject({ kind: 'no-key' });
  });

  it('throws when every asked provider failed', async () => {
    const lookup = createBpmLookup(
      undefined,
      dz(() => Promise.reject(new GetSongBpmError('network', 'deezer'))),
    );
    await expect(lookup.search({ title: 'x' })).rejects.toMatchObject({ kind: 'network' });
  });
});
