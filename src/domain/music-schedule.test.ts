import { describe, expect, it } from 'vitest';
import { musicAt, nextTrackChange } from './music-schedule';
import type { Segment } from './segments';
import type { MusicCue, TrackRef } from './workout';

const seg = (
  index: number,
  startSec: number,
  durationSec: number,
  blockId: string,
  rep = 1,
): Segment => ({
  index,
  startSec,
  durationSec,
  kind: 'steady',
  ftpPctStart: 70,
  ftpPctEnd: 70,
  effortStart: 4,
  effortEnd: 4,
  blockId,
  rep,
  reps: 1,
});

const tr = (id: string, durationSec?: number, startAtSec = 0): TrackRef => ({
  provider: 'spotify',
  id,
  title: id,
  startAtSec,
  ...(durationSec !== undefined ? { durationSec } : {}),
});

// total 600s: a 0-100, b 100-300, c 300-600
const segments: Segment[] = [seg(0, 0, 100, 'a'), seg(1, 100, 200, 'b'), seg(2, 300, 300, 'c')];
const cue = (blockId: string, track: TrackRef, rep = 1): MusicCue => ({ blockId, rep, track });

describe('musicAt', () => {
  it('plays a cue track with offset from its start and startAtSec', () => {
    const cues = [cue('b', tr('B', 500, 20))];
    const r = musicAt({ segments, cues, fallback: [], tSec: 150 });
    expect(r).toMatchObject({ source: 'cue', offsetSec: 70, key: 'cue:b:1' });
    expect(r?.track.id).toBe('B');
  });

  it('is cut by the next cue', () => {
    const cues = [cue('a', tr('A', 1000)), cue('b', tr('B', 1000))];
    expect(musicAt({ segments, cues, fallback: [], tSec: 99 })?.track.id).toBe('A');
    const r = musicAt({ segments, cues, fallback: [], tSec: 100 });
    expect(r?.track.id).toBe('B');
    expect(r?.offsetSec).toBe(0);
  });

  it('overflows into fallback #1 then #2 then null', () => {
    const cues = [cue('a', tr('A', 50))];
    const fallback = [tr('F1', 100), tr('F2', 100)];
    expect(musicAt({ segments, cues, fallback, tSec: 49 })?.track.id).toBe('A');
    const f1 = musicAt({ segments, cues, fallback, tSec: 60 });
    expect(f1).toMatchObject({ source: 'fallback', offsetSec: 10, key: 'fb:0:50' });
    expect(f1?.track.id).toBe('F1');
    const f2 = musicAt({ segments, cues, fallback, tSec: 160 });
    expect(f2).toMatchObject({ offsetSec: 10, key: 'fb:1:50' });
    expect(musicAt({ segments, cues, fallback, tSec: 250 })).toBeNull();
  });

  it('a later cue cuts fallback', () => {
    const cues = [cue('a', tr('A', 10)), cue('c', tr('C'))];
    const fallback = [tr('F1')];
    expect(musicAt({ segments, cues, fallback, tSec: 200 })?.track.id).toBe('F1');
    expect(musicAt({ segments, cues, fallback, tSec: 300 })?.track.id).toBe('C');
  });

  it('plays fallback from t=0 before the first cue', () => {
    const cues = [cue('b', tr('B'))];
    const fallback = [tr('F1', 40), tr('F2')];
    expect(musicAt({ segments, cues, fallback, tSec: 10 })).toMatchObject({
      key: 'fb:0:0',
      offsetSec: 10,
    });
    expect(musicAt({ segments, cues, fallback, tSec: 50 })).toMatchObject({
      key: 'fb:1:0',
      offsetSec: 10,
    });
    expect(musicAt({ segments, cues, fallback, tSec: 99 })?.track.id).toBe('F2');
  });

  it('returns null with nothing to play', () => {
    expect(musicAt({ segments, cues: [], fallback: [], tSec: 10 })).toBeNull();
  });

  it('seeking backwards gives the earlier track', () => {
    const cues = [cue('a', tr('A')), cue('b', tr('B'))];
    expect(musicAt({ segments, cues, fallback: [], tSec: 200 })?.track.id).toBe('B');
    expect(musicAt({ segments, cues, fallback: [], tSec: 5 })?.track.id).toBe('A');
  });

  it('unknown duration never overflows', () => {
    const cues = [cue('a', tr('A'))];
    const r = musicAt({ segments, cues, fallback: [tr('F1')], tSec: 599 });
    expect(r?.track.id).toBe('A');
    expect(r?.offsetSec).toBe(599);
  });

  it('overflows immediately when startAtSec >= duration', () => {
    const cues = [cue('a', tr('A', 30, 30))];
    expect(musicAt({ segments, cues, fallback: [tr('F1')], tSec: 0 })?.track.id).toBe('F1');
  });

  it('ignores unmatched cues; later duplicate start wins; uses rep', () => {
    const segs = [...segments, seg(3, 600, 100, 'a', 2)];
    const cues = [
      cue('zzz', tr('X')),
      cue('b', tr('B1')),
      cue('b', tr('B2')),
      cue('a', tr('A2'), 2),
      cue('a', tr('A9'), 9),
    ];
    expect(musicAt({ segments: segs, cues, fallback: [], tSec: 150 })?.track.id).toBe('B2');
    expect(musicAt({ segments: segs, cues, fallback: [], tSec: 650 })?.track.id).toBe('A2');
    expect(musicAt({ segments: segs, cues, fallback: [], tSec: 5 })).toBeNull();
  });

  it('clamps negative t and stops at the end', () => {
    const cues = [cue('a', tr('A'))];
    expect(musicAt({ segments, cues, fallback: [], tSec: -5 })?.offsetSec).toBe(0);
    expect(musicAt({ segments, cues, fallback: [], tSec: 600 })).toBeNull();
    expect(musicAt({ segments: [], cues, fallback: [], tSec: 0 })).toBeNull();
  });
});

describe('nextTrackChange', () => {
  it('returns the next cue start', () => {
    const cues = [cue('a', tr('A')), cue('b', tr('B'))];
    const r = nextTrackChange({ segments, cues, fallback: [], tSec: 10 });
    expect(r?.atSec).toBe(100);
    expect(r?.track?.track.id).toBe('B');
  });

  it('returns overflow into fallback, next fallback, then exhaustion', () => {
    const cues = [cue('a', tr('A', 50))];
    const fallback = [tr('F1', 100)];
    const base = { segments, cues, fallback };
    expect(nextTrackChange({ ...base, tSec: 0 })).toMatchObject({
      atSec: 50,
      track: { key: 'fb:0:50' },
    });
    expect(nextTrackChange({ ...base, tSec: 50 })).toEqual({ atSec: 150, track: null });
  });

  it('moves between fallback tracks before the first cue', () => {
    const r = nextTrackChange({
      segments,
      cues: [cue('b', tr('B'))],
      fallback: [tr('F1', 40), tr('F2')],
      tSec: 0,
    });
    expect(r).toMatchObject({ atSec: 40, track: { key: 'fb:1:0' } });
  });

  it('reports the end of the workout, and null afterwards', () => {
    const cues = [cue('a', tr('A'))];
    expect(nextTrackChange({ segments, cues, fallback: [], tSec: 200 })).toEqual({
      atSec: 600,
      track: null,
    });
    expect(nextTrackChange({ segments, cues, fallback: [], tSec: 600 })).toBeNull();
  });

  it('returns the first cue when nothing plays yet', () => {
    const r = nextTrackChange({ segments, cues: [cue('b', tr('B'))], fallback: [], tSec: -3 });
    expect(r?.atSec).toBe(100);
  });
});
