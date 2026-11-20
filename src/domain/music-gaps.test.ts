import { describe, expect, it } from 'vitest';
import {
  fillSlotGap,
  MAX_CUT_SEC,
  MIN_RESERVE_SEC,
  tempoFits,
  type GapFillOptions,
} from './music-gaps';
import { songKey } from './slot-plan';
import type { TrackRef } from './workout';

const rec = (
  id: string,
  durationSec: number | undefined,
  extra: Partial<TrackRef> = {},
): TrackRef => ({
  provider: 'youtube',
  id,
  title: extra.title ?? id,
  artist: 'Artist',
  startAtSec: 0,
  ...(durationSec !== undefined ? { durationSec } : {}),
  ...extra,
});
const song = (title: string, main: number, backups: number[] = [], bpm?: number): TrackRef => ({
  ...rec(`${title}-0`, main, { title, ...(bpm !== undefined ? { bpm } : {}) }),
  ...(backups.length > 0
    ? { alternates: backups.map((d, i) => rec(`${title}-${i + 1}`, d, { title })) }
    : {}),
});
const fill = (
  queue: TrackRef[],
  slotSec: number,
  reserve: TrackRef[] = [],
  options: GapFillOptions = {},
) => fillSlotGap(queue, slotSec, reserve, options);
const key = (title: string) => songKey({ title, artist: 'Artist' });

describe('fillSlotGap', () => {
  it('leaves a queue that covers the slot alone', () => {
    const q = [song('A', 310)];
    const r = fill(q, 300, [song('R', 200)]);
    expect(r).toMatchObject({ gapBeforeSec: 0, gapSec: 0, rules: [], silenceSec: 0 });
    expect(r.queue).toEqual(q);
  });

  it('R1: a longer upload of the same song becomes the main recording, the others stay as backups', () => {
    const r = fill([song('A', 236, [253, 290])], 300);
    expect(r.rules).toEqual(['longer']);
    expect(r.queue[0]?.id).toBe('A-2');
    expect(r.queue[0]?.alternates?.map((t) => t.id)).toEqual(['A-0', 'A-1']);
    expect(r.gapSec).toBe(10);
  });

  it(`R1 skips an upload that is only a little longer, or one cut by more than ${MAX_CUT_SEC} s`, () => {
    // 253 is only 17 s longer for a 64 s gap; 402 overshoots by 102 s (another cut or a mix).
    const r = fill([song('A', 236, [253, 402])], 300);
    expect(r.rules).not.toContain('longer');
    expect(r.gapSec).toBe(64);
    expect(r.silenceSec).toBe(64);
  });

  it('R1 skips an upload that is not embeddable or of unknown length', () => {
    const entry: TrackRef = {
      ...song('A', 236),
      alternates: [rec('X', 290, { title: 'A', notEmbeddable: true }), rec('Y', undefined)],
    };
    expect(fill([entry], 300).rules).toEqual([]);
  });

  it('R1 can lengthen an earlier song of the queue', () => {
    const r = fill([song('A', 100, [160]), song('B', 150)], 300);
    expect(r.rules).toEqual(['longer']);
    expect(r.queue.map((t) => t.id)).toEqual(['A-1', 'B-0']);
  });

  it('R2: adds the first reserve song in the tempo that is not played elsewhere', () => {
    const reserve = [
      song('Used', 300, [], 90),
      song('Slow', 300, [], 60),
      song('Good', 300, [], 88),
    ];
    const r = fill([song('A', 257, [], 91)], 300, reserve, {
      bpm: 91,
      used: new Set([key('Used')]),
    });
    expect(r.rules).toEqual(['reserve']);
    expect(r.queue.map((t) => t.title)).toEqual(['A', 'Good']);
    expect(r.added).toEqual([key('Good')]);
    expect(r.gapSec).toBe(0);
  });

  it('R2 accepts half or double time, and needs a song long enough to close the gap', () => {
    expect(tempoFits(87, 174)).toBe(true);
    expect(tempoFits(174, 87)).toBe(true);
    expect(tempoFits(120, 174)).toBe(false);
    expect(tempoFits(undefined, 174)).toBe(true);
    const short = fill([song('A', 236)], 300, [song('Tiny', 30, [], 174)], { bpm: 174 });
    expect(short.rules).toEqual([]);
  });

  it(`R2 is not used for a gap under ${MIN_RESERVE_SEC} s (a snippet of a song is worse than a calm bed)`, () => {
    const r = fill([song('A', 232)], 240, [song('R', 300)], { fallbackSec: 1000 });
    expect(r.rules).toEqual(['fallback']);
    expect(r.queue).toHaveLength(1);
  });

  it('R2 never queues the same song twice', () => {
    expect(fill([song('A', 200)], 300, [song('A', 300)]).rules).toEqual([]);
  });

  it('R3: repeats the ending of a loopable last song for a short gap', () => {
    const last = song('Calm', 270, [272]);
    const r = fill([last], 300, [], { loopable: new Set([songKey(last)]) });
    expect(r.rules).toEqual(['loop']);
    expect(r.queue[1]).toMatchObject({ id: 'Calm-0', startAtSec: 240 });
    expect(r.queue[1]?.alternates).toBeUndefined();
    expect(r.gapSec).toBe(0);
  });

  it('R3 is not used for a song with vocals or a gap over the loop limit', () => {
    expect(fill([song('Vocal', 270)], 300).rules).toEqual([]);
    const calm = song('Calm', 200);
    expect(fill([calm], 300, [], { loopable: new Set([songKey(calm)]) }).rules).toEqual([]);
  });

  it('R4: reports the fallback for what is left, R5: the silence when there is none', () => {
    expect(fill([song('A', 257)], 300, [], { fallbackSec: 1042 })).toMatchObject({
      rules: ['fallback'],
      gapSec: 43,
      silenceSec: 0,
    });
    expect(fill([song('A', 257)], 300, [], { fallbackSec: 20 })).toMatchObject({
      rules: [],
      silenceSec: 43,
    });
  });

  it('a track of unknown length holds the slot: nothing to fill', () => {
    const r = fill([rec('Open', undefined)], 300, [song('R', 300)]);
    expect(r).toMatchObject({ gapSec: 0, rules: [], silenceSec: 0 });
  });

  it('an empty queue is left to the fallback', () => {
    expect(fill([], 300, [song('R', 300)], { fallbackSec: 400 })).toMatchObject({
      rules: ['fallback'],
      queue: [],
    });
  });

  it('a seam of a second is not a gap', () => {
    expect(fill([song('A', 299.5)], 300).rules).toEqual([]);
  });

  it('does not change its input', () => {
    const q = [song('A', 236, [290])];
    const copy = structuredClone(q);
    fill(q, 300, [song('R', 300)]);
    expect(q).toEqual(copy);
  });
});
