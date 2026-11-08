import { describe, expect, it, vi } from 'vitest';
import { GetSongBpmError } from '../getsongbpm/client';
import {
  createLibraryStore,
  MAX_LIBRARY,
  mergeTracks,
  MISS_TTL_MS,
  needsTag,
  suggestFor,
  TAG_TTL_MS,
  toTrackRef,
  withManualBpm,
  type LibraryTrack,
} from './library';
import { runTagQueue, type TagQueueOptions } from './tag-queue';

const NOW = 1_800_000_000_000;

function setup(initial: LibraryTrack[], lookup: TagQueueOptions['lookup']) {
  let tracks = initial;
  const ctl = new AbortController();
  const opts: TagQueueOptions = {
    getTracks: () => tracks,
    patch: (id, change) => {
      tracks = tracks.map((t) => (t.id === id ? change(t) : t));
    },
    lookup,
    signal: ctl.signal,
    now: () => NOW,
    sleep: () => Promise.resolve(),
  };
  return { opts, ctl, get: () => tracks };
}

const song = (id: string, extra: Partial<LibraryTrack> = {}): LibraryTrack => ({
  id,
  title: `Song ${id}`,
  artist: 'Band',
  ...extra,
});

describe('needsTag', () => {
  it('asks again after 30 days, never for a typed tempo, not for a recent miss', () => {
    expect(needsTag(song('a'), NOW)).toBe(true);
    expect(
      needsTag(song('a', { bpm: 120, bpmSource: 'deezer', taggedAt: NOW - TAG_TTL_MS + 1 }), NOW),
    ).toBe(false);
    expect(
      needsTag(song('a', { bpm: 120, bpmSource: 'deezer', taggedAt: NOW - TAG_TTL_MS }), NOW),
    ).toBe(true);
    expect(needsTag(song('a', { bpm: 120, bpmSource: 'manual', taggedAt: 1 }), NOW)).toBe(false);
    expect(needsTag(song('a', { missAt: NOW - MISS_TTL_MS + 1 }), NOW)).toBe(false);
    expect(needsTag(song('a', { missAt: NOW - MISS_TTL_MS }), NOW)).toBe(true);
  });
});

describe('runTagQueue', () => {
  it('tags songs with their source and counts misses', async () => {
    const lookup = vi
      .fn()
      .mockResolvedValueOnce({ bpm: 128, source: 'deezer' })
      .mockResolvedValueOnce(undefined);
    const s = setup([song('a'), song('b')], lookup);
    const out = await runTagQueue(s.opts);
    expect(out.status).toBe('finished');
    expect(out.progress).toMatchObject({ total: 2, done: 2, tagged: 1, missed: 1 });
    expect(s.get()[0]).toMatchObject({ bpm: 128, bpmSource: 'deezer', taggedAt: NOW });
    expect(s.get()[1]).toMatchObject({ missAt: NOW });
    expect(lookup).toHaveBeenCalledWith({ title: 'Song a', artist: 'Band' });
  });

  it('skips songs that already have a fresh answer or a typed tempo', async () => {
    const lookup = vi.fn().mockResolvedValue({ bpm: 100, source: 'getsongbpm' });
    const s = setup(
      [
        song('a', { bpm: 150, bpmSource: 'manual', taggedAt: NOW }),
        song('b', { bpm: 130, bpmSource: 'deezer', taggedAt: NOW - 1000 }),
        song('c'),
      ],
      lookup,
    );
    const out = await runTagQueue(s.opts);
    expect(out.progress.total).toBe(1);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(s.get()[0]?.bpm).toBe(150);
  });

  it.each(['rate-limited', 'forbidden', 'blocked', 'unauthorized'] as const)(
    'stops on %s without retrying and keeps the song untagged for a resume',
    async (kind) => {
      const lookup = vi
        .fn()
        .mockResolvedValueOnce({ bpm: 128, source: 'deezer' })
        .mockRejectedValueOnce(new GetSongBpmError(kind, 'deezer'))
        .mockResolvedValue({ bpm: 90, source: 'deezer' });
      const s = setup([song('a'), song('b'), song('c')], lookup);
      const out = await runTagQueue(s.opts);
      expect(out).toMatchObject({ status: 'stopped', reason: { kind, provider: 'deezer' } });
      expect(lookup).toHaveBeenCalledTimes(2);
      expect(s.get()[1]?.missAt).toBeUndefined();
      // Resume: a second run only handles the two songs that are left.
      const again = await runTagQueue(s.opts);
      expect(again.status).toBe('finished');
      expect(again.progress.total).toBe(2);
      expect(s.get().map((t) => t.bpm)).toEqual([128, 90, 90]);
    },
  );

  it('gives up after five failures in a row, but one failure does not stop the queue', async () => {
    const fail = new GetSongBpmError('network', 'getsongbpm');
    const ok = { bpm: 100, source: 'getsongbpm' as const };
    const s1 = setup(
      [song('a'), song('b'), song('c')],
      vi.fn().mockRejectedValueOnce(fail).mockResolvedValue(ok),
    );
    const out1 = await runTagQueue(s1.opts);
    expect(out1).toMatchObject({ status: 'finished', progress: { failed: 1, tagged: 2 } });
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const lookup = vi.fn().mockRejectedValue(fail);
    const s2 = setup(
      ids.map((i) => song(i)),
      lookup,
    );
    const out2 = await runTagQueue(s2.opts);
    expect(out2.status).toBe('stopped');
    expect(lookup).toHaveBeenCalledTimes(5);
  });

  it('aborts between songs and resumes where it left off', async () => {
    const s = setup([song('a'), song('b'), song('c')], vi.fn());
    const lookup = vi.fn().mockImplementation(() => {
      if (lookup.mock.calls.length === 1) s.ctl.abort();
      return Promise.resolve({ bpm: 120, source: 'deezer' });
    });
    const s2 = { ...s, opts: { ...s.opts, lookup } };
    const out = await runTagQueue(s2.opts);
    expect(out.status).toBe('aborted');
    expect(s.get().filter((t) => t.bpm !== undefined)).toHaveLength(1);
    const next = setup(s.get(), lookup);
    const done = await runTagQueue(next.opts);
    expect(done.progress.total).toBe(2);
    expect(next.get().every((t) => t.bpm === 120)).toBe(true);
  });

  it('paces between songs but not after the last one', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const s = setup([song('a'), song('b'), song('c')], vi.fn().mockResolvedValue(undefined));
    await runTagQueue({ ...s.opts, sleep, paceMs: 1234 });
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls[0]?.[0]).toBe(1234);
  });

  it('does not overwrite a tempo the rider typed while the lookup was running', async () => {
    const s = setup([song('a')], vi.fn());
    const lookup = vi.fn().mockImplementation(() => {
      s.opts.patch('a', (t) => withManualBpm(t, 140, NOW));
      return Promise.resolve({ bpm: 70, source: 'deezer' });
    });
    await runTagQueue({ ...s.opts, lookup });
    expect(s.get()[0]).toMatchObject({ bpm: 140, bpmSource: 'manual' });
  });

  it('counts a song with an unusable title as missed without asking', async () => {
    const lookup = vi.fn();
    const s = setup([song('a', { title: '(Official Video)' })], lookup);
    const out = await runTagQueue(s.opts);
    expect(lookup).not.toHaveBeenCalled();
    expect(out.progress.missed).toBe(1);
  });
});

describe('library', () => {
  it('merges new songs by id, keeps tempos and respects the cap', () => {
    const cur = [song('a', { bpm: 120, bpmSource: 'manual' })];
    const m = mergeTracks(cur, [song('a'), song('b')]);
    expect(m.added).toBe(1);
    expect(m.tracks[0]?.bpm).toBe(120);
    const big = Array.from({ length: MAX_LIBRARY }, (_, i) => song(`x${i}`));
    const full = mergeTracks(big, [song('new')]);
    expect(full).toMatchObject({ added: 0, truncated: true });
  });

  it('ranks by the block cadence: 2 BPM = 1 RPM, half and double time, with the source', () => {
    const tracks = [
      song('slow', { bpm: 95, bpmSource: 'deezer' }),
      song('exact', { bpm: 180, bpmSource: 'getsongbpm' }),
      song('none'),
      song('off', { bpm: 150, bpmSource: 'manual' }),
      song('near', { bpm: 186, bpmSource: 'manual' }),
    ];
    const ranked = suggestFor(tracks, 90);
    expect(ranked.map((r) => r.track.id)).toEqual(['exact', 'near', 'slow']);
    expect(ranked[0]?.match).toMatchObject({ kind: 'exact', fit: 'on-beat' });
    expect(ranked[2]?.match.kind).toBe('half');
    expect(suggestFor(tracks, undefined)).toEqual([]);
  });

  it('builds a pin: provider source kept, a typed tempo carries none', () => {
    expect(toTrackRef(song('a', { bpm: 128, bpmSource: 'deezer' }), 5)).toEqual({
      provider: 'spotify',
      id: 'a',
      title: 'Song a',
      artist: 'Band',
      bpm: 128,
      bpmSource: 'deezer',
      startAtSec: 5,
    });
    expect(toTrackRef(song('a', { bpm: 128, bpmSource: 'manual' }), 0).bpmSource).toBeUndefined();
  });

  it('a manual correction replaces a provider value and an empty one clears the tempo', () => {
    const t = song('a', { bpm: 128, bpmSource: 'deezer', taggedAt: 1 });
    expect(withManualBpm(t, 126, NOW)).toMatchObject({ bpm: 126, bpmSource: 'manual' });
    const cleared = withManualBpm(t, undefined, NOW);
    expect(cleared.bpm).toBeUndefined();
    expect(cleared.taggedAt).toBeUndefined();
    expect(withManualBpm(t, 900, NOW).bpm).toBeUndefined();
  });

  it('persists locally and drops damaged entries when reading', () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    };
    const a = createLibraryStore(storage);
    a.set([song('a', { bpm: 120, bpmSource: 'deezer', taggedAt: NOW })]);
    mem.set(
      'hypercycling.library.songs',
      JSON.stringify([
        { id: 'a', title: 'ok', bpm: 120 },
        { id: '../x', title: 'bad id' },
        { id: 'b', title: 'bad bpm', bpm: 5000 },
      ]),
    );
    const b = createLibraryStore(storage);
    expect(b.get().map((t) => t.id)).toEqual(['a']);
    const seen = vi.fn();
    b.subscribe(seen);
    b.update((cur) => [...cur, song('c')]);
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
