import { describe, expect, it, vi } from 'vitest';
import {
  createGetSongBpmClient,
  GetSongBpmError,
  normalizeForMatch,
  type KeyValueStorage,
} from './client';
import { cleanTitle, trackQuery } from './query';

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const SONG = {
  id: 'o2r0L',
  title: 'Master of Puppets',
  uri: 'https://getsongbpm.com/song/master-of-puppets/o2r0L',
  tempo: '220',
  artist: { id: 'nZR', name: 'Metallica' },
};

function setup(
  respond: (url: URL) => Response | Promise<Response>,
  extra: { now?: () => number; maxPerHour?: number } = {},
) {
  const storage = memoryStorage();
  const fetchMock = vi.fn((input: RequestInfo | URL) =>
    Promise.resolve(respond(new URL(String(input)))),
  );
  const client = createGetSongBpmClient({
    apiKey: 'SECRET-KEY',
    fetch: fetchMock as unknown as typeof fetch,
    storage,
    ...extra,
  });
  return { client, fetchMock, storage };
}

describe('lookupBpm', () => {
  it('asks /search/ with type=both and returns the tempo as a number', async () => {
    const { client, fetchMock } = setup(() => json({ search: [SONG] }));
    const hit = await client.lookupBpm({ title: 'Master of Puppets', artist: 'Metallica' });
    expect(hit).toEqual({
      title: 'Master of Puppets',
      artist: 'Metallica',
      bpm: 220,
      url: SONG.uri,
    });
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.origin + url.pathname).toBe('https://api.getsong.co/search/');
    expect(url.searchParams.get('type')).toBe('both');
    expect(url.searchParams.get('lookup')).toBe('song:Master of Puppets artist:Metallica');
    expect(url.searchParams.get('api_key')).toBe('SECRET-KEY');
  });

  it('prefers the result with the same title and artist over the first one', async () => {
    const other = { ...SONG, id: 'x', title: 'Master of Puppets (Live)', tempo: '200' };
    const { client } = setup(() => json({ search: [other, SONG] }));
    expect((await client.lookupBpm({ title: 'master of puppets', artist: 'METALLICA' }))?.bpm).toBe(
      220,
    );
  });

  it('answers undefined for a same-title song by another artist (cover)', async () => {
    const cover = { ...SONG, artist: { id: 'c', name: 'Some Cover Band' } };
    const { client } = setup(() => json({ search: [cover] }));
    expect(
      await client.lookupBpm({ title: 'Master of Puppets', artist: 'Metallica' }),
    ).toBeUndefined();
  });

  it('still takes the first same-title result when no artist is known', async () => {
    const { client } = setup(() => json({ search: [SONG] }));
    expect((await client.lookupBpm({ title: 'Master of Puppets' }))?.bpm).toBe(220);
  });

  it('answers undefined when the database has no result (object instead of array)', async () => {
    const { client } = setup(() => json({ search: { error: 'no result' } }));
    expect(await client.lookupBpm({ title: 'Nothing' })).toBeUndefined();
  });

  it('ignores results with an implausible tempo or a foreign link', async () => {
    const { client } = setup(() =>
      json({
        search: [
          { ...SONG, tempo: '0' },
          { ...SONG, uri: 'https://evil.example/x' },
        ],
      }),
    );
    expect(await client.lookupBpm({ title: 'Master of Puppets' })).toBeUndefined();
  });

  it('does not ask for an empty title', async () => {
    const { client, fetchMock } = setup(() => json({ search: [] }));
    expect(await client.lookupBpm({ title: '  ' })).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('cache', () => {
  it('serves a repeated lookup (case and accents ignored) from the cache', async () => {
    const { client, fetchMock } = setup(() => json({ search: [SONG] }));
    await client.lookupBpm({ title: 'Master of Puppets', artist: 'Metallica' });
    const again = await client.lookupBpm({ title: 'MASTER OF PUPPETS', artist: 'metallica' });
    expect(again?.bpm).toBe(220);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('remembers "not found" for a day, then asks again', async () => {
    let t = 1_000_000;
    const { client, fetchMock } = setup(() => json({ search: { error: 'no result' } }), {
      now: () => t,
    });
    await client.lookupBpm({ title: 'Ghost' });
    await client.lookupBpm({ title: 'Ghost' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    t += 25 * 3_600_000;
    await client.lookupBpm({ title: 'Ghost' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps a found tempo for 30 days', async () => {
    let t = 1_000_000;
    const { client, fetchMock } = setup(() => json({ search: [SONG] }), { now: () => t });
    await client.lookupBpm({ title: 'Master of Puppets' });
    t += 29 * 24 * 3_600_000;
    await client.lookupBpm({ title: 'Master of Puppets' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    t += 2 * 24 * 3_600_000;
    await client.lookupBpm({ title: 'Master of Puppets' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('survives unreadable or missing storage', async () => {
    const broken: KeyValueStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    };
    const client = createGetSongBpmClient({
      apiKey: 'k',
      storage: broken,
      fetch: (() => Promise.resolve(json({ search: [SONG] }))) as unknown as typeof fetch,
    });
    expect((await client.lookupBpm({ title: 'Master of Puppets' }))?.bpm).toBe(220);
    const none = createGetSongBpmClient({
      apiKey: 'k',
      storage: undefined,
      fetch: (() => Promise.resolve(json({ search: [SONG] }))) as unknown as typeof fetch,
    });
    expect((await none.lookupBpm({ title: 'Master of Puppets' }))?.bpm).toBe(220);
  });

  it('keeps at most 300 entries', async () => {
    const { client, storage } = setup(() => json({ search: [SONG] }));
    for (let i = 0; i < 305; i++) await client.lookupBpm({ title: `Song ${i}` });
    const file = JSON.parse(storage.data.get('hypercycling.getsongbpm.cache') as string) as {
      entries: Record<string, unknown>;
    };
    expect(Object.keys(file.entries)).toHaveLength(300);
  });
});

describe('findByBpm', () => {
  const tempoBody = {
    tempo: [
      {
        song_id: 'a',
        song_title: 'Song A',
        song_uri: 'https://getsongbpm.com/song/song-a/a',
        tempo: '180',
        artist: { id: '1', name: 'Band A' },
      },
      { song_id: 'b', song_title: 'No link', song_uri: 'javascript:alert(1)', tempo: '180' },
    ],
  };

  it('lists songs at a tempo (only usable rows) and caches the list', async () => {
    const { client, fetchMock } = setup(() => json(tempoBody));
    const list = await client.findByBpm(180, 12);
    expect(list).toEqual([
      { title: 'Song A', artist: 'Band A', bpm: 180, url: 'https://getsongbpm.com/song/song-a/a' },
    ]);
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe('/tempo/');
    expect(url.searchParams.get('bpm')).toBe('180');
    expect(url.searchParams.get('limit')).toBe('12');
    await client.findByBpm(180, 12);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not ask outside 40-220', async () => {
    const { client, fetchMock } = setup(() => json(tempoBody));
    expect(await client.findByBpm(360)).toEqual([]);
    expect(await client.findByBpm(20)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('errors and limits', () => {
  const kindOf = async (p: Promise<unknown>): Promise<string> =>
    p.then(
      () => 'ok',
      (e: unknown) => (e instanceof GetSongBpmError ? e.kind : 'other'),
    );

  it('needs a key', async () => {
    const client = createGetSongBpmClient({ apiKey: '  ', storage: undefined });
    expect(await kindOf(client.lookupBpm({ title: 'x' }))).toBe('no-key');
  });

  it('maps 401 to unauthorized', async () => {
    const { client } = setup(() => new Response('<html>', { status: 401 }));
    expect(await kindOf(client.lookupBpm({ title: 'x' }))).toBe('unauthorized');
  });

  it('stops asking for an hour after 429, then tries again', async () => {
    let t = 5_000_000;
    let status = 429;
    const { client, fetchMock } = setup(
      () => (status === 429 ? new Response('', { status }) : json({ search: [SONG] })),
      { now: () => t },
    );
    expect(await kindOf(client.lookupBpm({ title: 'a' }))).toBe('rate-limited');
    expect(await kindOf(client.lookupBpm({ title: 'b' }))).toBe('blocked');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    t += 3_600_001;
    status = 200;
    expect(await kindOf(client.lookupBpm({ title: 'c' }))).toBe('ok');
  });

  it('treats 403 as refused, then pauses', async () => {
    const { client, fetchMock } = setup(() => new Response('', { status: 403 }));
    expect(await kindOf(client.lookupBpm({ title: 'a' }))).toBe('forbidden');
    expect(await kindOf(client.lookupBpm({ title: 'b' }))).toBe('blocked');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps itself under its own hourly ceiling', async () => {
    let t = 1_000_000;
    const { client, fetchMock } = setup(() => json({ search: { error: 'x' } }), {
      now: () => t,
      maxPerHour: 3,
    });
    for (const n of ['a', 'b', 'c']) await client.lookupBpm({ title: n });
    expect(await kindOf(client.lookupBpm({ title: 'd' }))).toBe('rate-limited');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    t += 3_600_001;
    expect(await kindOf(client.lookupBpm({ title: 'd' }))).toBe('ok');
  });

  it('maps network failures and odd bodies, without the key in the error', async () => {
    const down = createGetSongBpmClient({
      apiKey: 'SECRET-KEY',
      storage: undefined,
      fetch: (() =>
        Promise.reject(
          new TypeError('Failed to fetch https://x?api_key=SECRET-KEY'),
        )) as unknown as typeof fetch,
    });
    const err = await down.lookupBpm({ title: 'x' }).catch((e: unknown) => e as GetSongBpmError);
    expect(err).toBeInstanceOf(GetSongBpmError);
    expect((err as GetSongBpmError).kind).toBe('network');
    expect(String((err as Error).message)).not.toContain('SECRET');
    const bad = setup(() => new Response('not json', { status: 200 }));
    expect(await kindOf(bad.client.lookupBpm({ title: 'x' }))).toBe('bad-response');
    const five = setup(() => new Response('', { status: 500 }));
    expect(await kindOf(five.client.lookupBpm({ title: 'x' }))).toBe('bad-response');
  });

  it('never stores the key in the cache', async () => {
    const { client, storage } = setup(() => json({ search: [SONG] }));
    await client.lookupBpm({ title: 'Master of Puppets' });
    expect([...storage.data.values()].join('')).not.toContain('SECRET-KEY');
  });
});

describe('normalizeForMatch', () => {
  it('lowercases, drops accents and punctuation', () => {
    expect(normalizeForMatch('  Żółć — Rock&Roll! ')).toBe('zolc rock roll');
  });
});

describe('trackQuery', () => {
  it('uses Spotify title and first artist', () => {
    expect(trackQuery({ provider: 'spotify', title: 'Song', artist: 'A, B' })).toEqual({
      title: 'Song',
      artist: 'A',
    });
  });
  it('splits a YouTube "Artist - Song (Official Video)" title', () => {
    expect(
      trackQuery({ provider: 'youtube', title: 'Metallica - Master of Puppets (Official Video)' }),
    ).toEqual({ title: 'Master of Puppets', artist: 'Metallica' });
  });
  it('searches a dashless YouTube title as a song title only', () => {
    expect(trackQuery({ provider: 'youtube', title: 'Zombie [HD]' })).toEqual({ title: 'Zombie' });
  });
  it('gives nothing for an untitled track', () => {
    expect(trackQuery({ provider: 'youtube', title: '' })).toBeUndefined();
  });
});

describe('review fixes', () => {
  const CACHE = 'hypercycling.getsongbpm.cache';
  const kindOf = async (p: Promise<unknown>): Promise<string> =>
    p.then(
      () => 'ok',
      (e: unknown) => (e instanceof GetSongBpmError ? e.kind : 'other'),
    );

  it('B1: a pause belongs to the refused key; another key is not blocked', async () => {
    const storage = memoryStorage();
    let status = 403;
    const respond = () =>
      Promise.resolve(status === 403 ? new Response('', { status }) : json({ search: [SONG] }));
    const make = (apiKey: string) =>
      createGetSongBpmClient({ apiKey, storage, fetch: respond as unknown as typeof fetch });
    const bad = make('BAD-KEY');
    expect(await kindOf(bad.lookupBpm({ title: 'Master of Puppets' }))).toBe('forbidden');
    expect(await kindOf(bad.lookupBpm({ title: 'Master of Puppets' }))).toBe('blocked');
    // the same key in a new client (reload) stays paused
    expect(await kindOf(make('BAD-KEY').lookupBpm({ title: 'x' }))).toBe('blocked');
    // a corrected key tries at once
    status = 200;
    expect(await kindOf(make('GOOD-KEY').lookupBpm({ title: 'Master of Puppets' }))).toBe('ok');
    // the stored pause does not contain the key
    expect(storage.data.get(CACHE)).not.toContain('BAD-KEY');
  });

  it('B1: 401 does not start a pause', async () => {
    const { client, fetchMock } = setup(() => new Response('', { status: 401 }));
    expect(await kindOf(client.lookupBpm({ title: 'a' }))).toBe('unauthorized');
    expect(await kindOf(client.lookupBpm({ title: 'b' }))).toBe('unauthorized');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('B2: titles in other scripts and special letters do not share a cache entry', async () => {
    const hits = (title: string, tempo: string) => ({
      search: [{ ...SONG, title, tempo }],
    });
    const { client, fetchMock } = setup((url) => {
      const lookup = url.searchParams.get('lookup') ?? '';
      if (lookup.includes('Группа')) return json(hits('Группа крови', '120'));
      if (lookup.includes('Кино')) return json(hits('Кино', '150'));
      if (lookup.includes('Straße')) return json(hits('Straße', '100'));
      return json({ search: { error: 'no result' } });
    });
    expect((await client.lookupBpm({ title: 'Группа крови' }))?.bpm).toBe(120);
    expect((await client.lookupBpm({ title: 'Кино' }))?.bpm).toBe(150);
    expect((await client.lookupBpm({ title: 'Straße' }))?.bpm).toBe(100);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(normalizeForMatch('Группа крови')).not.toBe(normalizeForMatch('Кино'));
    expect(normalizeForMatch('Ørnen ß Đorđe Æon')).toBe('ornen ss dorde aeon');
    expect(normalizeForMatch('東京事変')).toBe('東京事変');
    expect(normalizeForMatch('Ελληνικά')).toBe('ελληνικα');
  });

  it('B3: no result with the same title means "not found", not another song', async () => {
    const other = { ...SONG, title: 'Master of Puppets (Orchestral Cover)', tempo: '90' };
    const { client } = setup(() => json({ search: [other] }));
    expect(await client.lookupBpm({ title: 'Master of Puppets' })).toBeUndefined();
  });

  it('W5: damaged cache entries are ignored and asked again', async () => {
    const storage = memoryStorage();
    storage.setItem(
      CACHE,
      JSON.stringify({
        entries: {
          's:master of puppets|': {
            at: Date.now(),
            ttl: 1e12,
            v: { title: 'x', bpm: 120, url: 'javascript:alert(1)' },
          },
          't:180:10': { at: Date.now(), ttl: 1e12, v: 'not a list' },
          's:junk|': 42,
        },
      }),
    );
    const fetchMock = vi.fn(() => Promise.resolve(json({ search: [SONG], tempo: [] })));
    const client = createGetSongBpmClient({
      apiKey: 'k',
      storage,
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect((await client.lookupBpm({ title: 'Master of Puppets' }))?.url).toBe(SONG.uri);
    expect(await client.findByBpm(180, 10)).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('W5: unparseable cache text is treated as empty', async () => {
    const storage = memoryStorage();
    storage.setItem(CACHE, '{not json');
    const { client } = setup(() => json({ search: [SONG] }));
    expect((await client.lookupBpm({ title: 'Master of Puppets' }))?.bpm).toBe(220);
    const own = createGetSongBpmClient({
      apiKey: 'k',
      storage,
      fetch: (() => Promise.resolve(json({ search: [SONG] }))) as unknown as typeof fetch,
    });
    expect((await own.lookupBpm({ title: 'Master of Puppets' }))?.bpm).toBe(220);
  });
});

describe('cleanTitle / trackQuery (W1)', () => {
  it('keeps words that are part of the title', () => {
    expect(cleanTitle('Video Killed the Radio Star')).toBe('Video Killed the Radio Star');
    expect(cleanTitle('HD Version of Me')).toBe('HD Version of Me');
    expect(cleanTitle('Live and Let Die')).toBe('Live and Let Die');
    expect(cleanTitle('Official Secrets')).toBe('Official Secrets');
  });
  it('drops release notes only where they are notes', () => {
    expect(cleanTitle('Zombie (Official Video HD)')).toBe('Zombie');
    expect(cleanTitle('Song [4K Remastered]')).toBe('Song');
    expect(cleanTitle('Song - Remastered 2011')).toBe('Song');
    expect(cleanTitle('Song - 2011 Remaster')).toBe('Song');
    expect(cleanTitle('Song (feat. Someone)')).toBe('Song');
    expect(cleanTitle('Song feat. Someone Else')).toBe('Song');
    expect(cleanTitle('Song (Live at Wembley)')).toBe('Song (Live at Wembley)');
    expect(cleanTitle('Song - Radio Edit')).toBe('Song');
  });
  it('cleans Spotify titles too and keeps the first artist', () => {
    expect(
      trackQuery({
        provider: 'spotify',
        title: 'Video Killed the Radio Star - Remastered 2011',
        artist: 'The Buggles, Other',
      }),
    ).toEqual({ title: 'Video Killed the Radio Star', artist: 'The Buggles' });
  });
});

describe('searchSongs (M19d)', () => {
  it('searches by artist and title, parses tempos and caches the list', async () => {
    const { client, fetchMock } = setup(() => json({ search: [SONG, { ...SONG, tempo: 'x' }] }));
    const hits = await client.searchSongs({ artist: 'Metallica', title: 'Master' });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ title: 'Master of Puppets', artist: 'Metallica', bpm: 220 });
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.get('type')).toBe('both');
    expect(url.searchParams.get('lookup')).toBe('song:Master artist:Metallica');
    await client.searchSongs({ artist: 'Metallica', title: 'Master' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats "no result" (an object, not a list) as empty and skips empty queries', async () => {
    const { client, fetchMock } = setup(() => json({ search: { error: 'no result' } }));
    expect(await client.searchSongs({ title: 'zzz' })).toEqual([]);
    expect(await client.searchSongs({ title: ' ' })).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('searches by artist alone', async () => {
    const { client, fetchMock } = setup(() => json({ search: [SONG] }));
    await client.searchSongs({ title: '', artist: 'Metallica' });
    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams.get('type')).toBe('artist');
  });
});
