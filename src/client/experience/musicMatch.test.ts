import { describe, expect, it, vi } from 'vitest';
import { builtinExperiences, getWorkout } from '../data/builtin';
import type { MusicHint } from '../../domain/experience';
import type { TrackRef } from '../../domain/workout';
import { SpotifyError } from '../music/spotify';
import type { SpotifyTrackHit } from '../music/spotify';
import {
  annotate,
  choiceCues,
  rankHits,
  resolveAll,
  resolveSlot,
  searchQuery,
  withUserMusic,
  type SearchFn,
} from './musicMatch';

function hit(
  id: string,
  title: string,
  artist: string,
  extra: Partial<SpotifyTrackHit> & { durationSec?: number } = {},
): SpotifyTrackHit {
  const { durationSec = 259, ...rest } = extra;
  return {
    ref: { provider: 'spotify', id, title, artist, durationSec, startAtSec: 0 },
    explicit: false,
    playable: true,
    ...rest,
  };
}

const NIGHTCALL: MusicHint = {
  slot: 0,
  artist: 'Kavinsky',
  title: 'Nightcall',
  bpm: 91,
  durationSec: 259,
  alternatives: [{ artist: 'Tycho', title: 'Awake', bpm: 88 }],
};

/** A search that answers by artist name found in the query. */
function fake(table: Record<string, SpotifyTrackHit[]>): SearchFn {
  return vi.fn(async (q: string) => {
    for (const [artist, hits] of Object.entries(table))
      if (q.includes(`artist:${artist}`)) return hits;
    return [];
  });
}

describe('rankHits', () => {
  it('prefers the studio version over live and remaster', () => {
    const ranked = rankHits(NIGHTCALL, [
      hit('live0000000', 'Nightcall - Live', 'Kavinsky'),
      hit('rema0000000', 'Nightcall - Remastered 2019', 'Kavinsky'),
      hit('main0000000', 'Nightcall', 'Kavinsky'),
    ]);
    expect(ranked[0]?.hit.ref.id).toBe('main0000000');
    expect(ranked.map((r) => r.hit.ref.id)).toEqual(['main0000000', 'rema0000000', 'live0000000']);
  });

  it('prefers the clean version unless explicit is welcome', () => {
    const hits = [
      hit('expl0000000', 'Nightcall', 'Kavinsky', { explicit: true }),
      hit('clea0000000', 'Nightcall', 'Kavinsky'),
    ];
    expect(rankHits(NIGHTCALL, hits)[0]?.hit.ref.id).toBe('clea0000000');
    expect(rankHits({ ...NIGHTCALL }, hits, { explicit: true })[0]?.hit.ref.id).toBe('expl0000000');
  });

  it('drops other songs and other artists', () => {
    const ranked = rankHits(NIGHTCALL, [
      hit('a0000000000', 'Nightcall', 'Some Cover Band'),
      hit('b0000000000', 'Something Else', 'Kavinsky'),
    ]);
    expect(ranked).toEqual([]);
  });

  it('keeps a remix when the suggestion asks for one', () => {
    const want = { artist: 'Chase & Status', title: 'Blind Faith (Loadstar Remix)' };
    const ranked = rankHits(want, [
      hit('orig0000000', 'Blind Faith', 'Chase & Status'),
      hit('remx0000000', 'Blind Faith - Loadstar Remix', 'Chase & Status'),
    ]);
    expect(ranked[0]?.hit.ref.id).toBe('remx0000000');
  });
});

describe('resolveSlot', () => {
  it('chooses the best hit and keeps the alternative as an option', async () => {
    const search = fake({
      Kavinsky: [hit('nc000000000', 'Nightcall', 'Kavinsky')],
      Tycho: [hit('aw000000000', 'Awake', 'Tycho', { durationSec: 283 })],
    });
    const m = await resolveSlot(NIGHTCALL, search);
    expect(m.status).toBe('ok');
    expect(m.chosen).toBe(0);
    expect(m.options.map((o) => o.ref.id)).toEqual(['nc000000000', 'aw000000000']);
    expect(search).toHaveBeenCalledWith('track:Nightcall artist:Kavinsky', 8);
  });

  it('reports none when Spotify has nothing', async () => {
    const m = await resolveSlot(NIGHTCALL, fake({}));
    expect(m).toEqual({ slot: 0, status: 'none', options: [] });
  });

  it('falls back to an alternative when the main song is missing', async () => {
    const m = await resolveSlot(NIGHTCALL, fake({ Tycho: [hit('aw000000000', 'Awake', 'Tycho')] }));
    expect(m.status).toBe('ok');
    expect(m.options[m.chosen!]?.source).toBe('alt');
  });

  it('skips a song that is not playable in the region and takes the next one', async () => {
    const m = await resolveSlot(
      NIGHTCALL,
      fake({
        Kavinsky: [hit('nc000000000', 'Nightcall', 'Kavinsky', { playable: false })],
        Tycho: [hit('aw000000000', 'Awake', 'Tycho')],
      }),
    );
    expect(m.status).toBe('ok');
    expect(m.options[0]?.playable).toBe(false);
    expect(m.chosen).toBe(1);
  });

  it('reports unavailable when every match is blocked in the region', async () => {
    const m = await resolveSlot(
      { ...NIGHTCALL, alternatives: [] },
      fake({ Kavinsky: [hit('nc000000000', 'Nightcall', 'Kavinsky', { playable: false })] }),
    );
    expect(m.status).toBe('unavailable');
    expect(m.chosen).toBeUndefined();
  });

  it('treats a missing is_playable as playable', async () => {
    const m = await resolveSlot(
      NIGHTCALL,
      fake({ Kavinsky: [hit('nc000000000', 'Nightcall', 'Kavinsky', { playable: undefined })] }),
    );
    expect(m.status).toBe('ok');
  });
});

describe('resolveAll', () => {
  it('stops with the Spotify error when there is no token', async () => {
    const search: SearchFn = () => Promise.reject(new SpotifyError('notAuthorized'));
    await expect(resolveAll([NIGHTCALL], search)).rejects.toMatchObject({ code: 'notAuthorized' });
  });

  it('reports progress per slot', async () => {
    const progress = vi.fn();
    await resolveAll([NIGHTCALL, { ...NIGHTCALL, slot: 1 }], fake({}), progress);
    expect(progress.mock.calls).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });
});

describe('annotate', () => {
  const option = (durationSec: number, bpm = 91) => ({
    source: 'main' as const,
    wanted: { artist: 'Kavinsky', title: 'Nightcall', bpm },
    ref: {
      provider: 'spotify',
      id: 'nc000000000',
      title: 'Nightcall',
      durationSec,
      startAtSec: 0,
    } as TrackRef,
    explicit: false,
    playable: true as boolean | undefined,
    score: 90,
  });

  it('warns when the song is shorter than the slot', () => {
    const a = annotate(option(259), NIGHTCALL, 300, [86, 92], new Map());
    expect(a.shortBySec).toBe(41);
  });

  it('does not warn when the song is long enough', () => {
    expect(annotate(option(300), NIGHTCALL, 300, [86, 92], new Map()).shortBySec).toBeUndefined();
  });

  it('uses the library tempo over the author tempo and marks a bad fit', () => {
    const a = annotate(option(300), NIGHTCALL, 300, [86, 92], new Map([['nc000000000', 120]]));
    expect(a).toMatchObject({ bpm: 120, bpmFrom: 'library', bpmFit: 'off' });
  });

  it('accepts a tempo that matches 2 BPM = 1 RPM', () => {
    const a = annotate(option(300, 90), NIGHTCALL, 300, [86, 92], new Map());
    expect(a).toMatchObject({ bpm: 90, bpmFrom: 'hint' });
    expect(a.bpmFit).not.toBe('off');
  });

  it('skips the tempo check for a beatless slot', () => {
    expect(
      annotate(option(300), { ...NIGHTCALL, noBeat: true }, 300, [64, 70], new Map()).bpm,
    ).toBeUndefined();
  });
});

describe('searchQuery', () => {
  it('drops quotes so they cannot break the field filters', () => {
    expect(searchQuery({ artist: 'A "B"', title: 'C' })).toBe('track:C artist:A B');
  });
});

describe('applying the choices', () => {
  const exp = builtinExperiences.find((e) => e.id === 'neon-grid-45')!;
  const w = getWorkout('class-neon-grid-45')!;
  const ref: TrackRef = {
    provider: 'spotify',
    id: 'nc000000000',
    title: 'Nightcall',
    startAtSec: 0,
  };

  it('puts the track on the first block of the slot', () => {
    const cues = choiceCues(w, { [w.songs![0]!.id]: ref });
    expect(cues).toHaveLength(1);
    expect(cues[0]).toMatchObject({ blockId: w.songs![0]!.firstBlockId, rep: 1, track: ref });
  });

  it('adds nothing without choices', () => {
    expect(withUserMusic(w, exp, {}).musicCues).toEqual([]);
  });

  it("gives the ride the rider's track and no embedded id exists", () => {
    const ride = withUserMusic(w, exp, { [w.songs![2]!.id]: ref });
    expect(ride.musicCues).toHaveLength(1);
    expect(exp.musicPins).toEqual([]);
  });
});
