import { describe, expect, it } from 'vitest';
import { cueRuns, musicAt, nextTrackChange } from './music-schedule';
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

describe('slot queue (cue.queue)', () => {
  // b spans 100-300 (200 s); queue of 120 s + 100 s + 90 s
  const queued: MusicCue = {
    blockId: 'b',
    rep: 1,
    track: tr('Q1', 120),
    queue: [tr('Q2', 100), tr('Q3', 90)],
  };

  it('plays the next track right when the previous one ends', () => {
    const at = (t: number) => musicAt({ segments, cues: [queued], fallback: [], tSec: t });
    expect(at(100)?.track.id).toBe('Q1');
    expect(at(219)?.track.id).toBe('Q1');
    expect(at(220)).toMatchObject({ offsetSec: 0, key: 'cue:b:1:1' });
    expect(at(220)?.track.id).toBe('Q2');
    expect(nextTrackChange({ segments, cues: [queued], fallback: [], tSec: 150 })).toMatchObject({
      atSec: 220,
    });
  });

  it('cuts a track that runs past the slot end and starts nothing after it', () => {
    const cues = [queued, cue('c', tr('C', 1000))];
    // Q3 would start at 320 but block c (300) takes over, so Q2 (220-320) is cut at 300.
    expect(musicAt({ segments, cues, fallback: [], tSec: 299 })?.track.id).toBe('Q2');
    expect(musicAt({ segments, cues, fallback: [], tSec: 300 })?.track.id).toBe('C');
    expect(nextTrackChange({ segments, cues, fallback: [], tSec: 250 })).toMatchObject({
      atSec: 300,
    });
  });

  it('honours the start offset of each queued track', () => {
    const q: MusicCue = { blockId: 'a', rep: 1, track: tr('A', 60, 10), queue: [tr('B', 100, 30)] };
    // A plays 50 s of audio (0-50), B starts at 50 from its 30 s mark.
    expect(musicAt({ segments, cues: [q], fallback: [], tSec: 0 })?.offsetSec).toBe(10);
    expect(musicAt({ segments, cues: [q], fallback: [], tSec: 60 })).toMatchObject({
      offsetSec: 40,
    });
  });

  it('jumping to the block start (a skip) restarts the queue from its first track', () => {
    const seek = (t: number) => musicAt({ segments, cues: [queued], fallback: [], tSec: t });
    expect(seek(250)?.track.id).toBe('Q2');
    expect(seek(100)).toMatchObject({ offsetSec: 0, key: 'cue:b:1' });
  });

  it('falls back after a queue that ends before the slot', () => {
    const short: MusicCue = { blockId: 'b', rep: 1, track: tr('S1', 50), queue: [tr('S2', 50)] };
    expect(
      musicAt({ segments, cues: [short], fallback: [tr('F', 1000)], tSec: 210 })?.track.id,
    ).toBe('F');
  });
});

describe('trimmed tracks (endAtSec)', () => {
  const trim = (id: string, startAtSec: number, endAtSec: number, durationSec?: number): TrackRef => ({
    ...tr(id, durationSec, startAtSec),
    endAtSec,
  });

  it('stops a cue track at its trimmed end and hands over to the fallback', () => {
    const cues = [cue('a', trim('A', 10, 40, 300))];
    const fallback = [tr('F1', 1000)];
    expect(musicAt({ segments, cues, fallback, tSec: 29 })).toMatchObject({ offsetSec: 39 });
    const after = musicAt({ segments, cues, fallback, tSec: 30 });
    expect(after).toMatchObject({ source: 'fallback', offsetSec: 0 });
    expect(after?.track.id).toBe('F1');
    expect(nextTrackChange({ segments, cues, fallback: [], tSec: 0 })).toEqual({
      atSec: 30,
      track: null,
    });
  });

  it('plays the queue right after a trimmed track', () => {
    const cues: MusicCue[] = [{ ...cue('b', trim('B', 0, 60, 200)), queue: [tr('Q', 100)] }];
    const r = musicAt({ segments, cues, fallback: [], tSec: 170 });
    expect(r?.track.id).toBe('Q');
    expect(r?.offsetSec).toBe(10);
  });

  it('gives a track of unknown length a known one once its end is set', () => {
    const cues = [cue('a', trim('A', 0, 50))];
    expect(musicAt({ segments, cues, fallback: [], tSec: 49 })?.track.id).toBe('A');
    expect(musicAt({ segments, cues, fallback: [], tSec: 50 })).toBeNull();
  });

  it('ignores an end at or before the start and an end past the recording (older or odd data)', () => {
    const bad = [cue('a', trim('A', 30, 30, 80))];
    // plays to the recording's end: 80 - 30 = 50 s
    expect(musicAt({ segments, cues: bad, fallback: [], tSec: 49 })?.track.id).toBe('A');
    expect(musicAt({ segments, cues: bad, fallback: [], tSec: 50 })).toBeNull();
    const past = [cue('a', trim('A', 0, 500, 80))];
    expect(musicAt({ segments, cues: past, fallback: [], tSec: 80 })).toBeNull();
  });

  it('keeps hints without an end playing exactly as before', () => {
    const cues = [cue('b', tr('B', 500, 20))];
    expect(musicAt({ segments, cues, fallback: [], tSec: 150 })).toMatchObject({ offsetSec: 70 });
  });
});

describe('cueRuns', () => {
  it('places each track at its real length and leaves a gap before the next cue', () => {
    const runs = cueRuns(segments, [cue('a', tr('A', 60)), cue('b', tr('B', 90, 30))]);
    expect(runs.map((r) => [r.startSec, r.limitSec, r.endSec])).toEqual([
      [0, 100, 60],
      [100, 600, 160],
    ]);
    expect(runs[1]?.items[0]).toMatchObject({ startSec: 100, endSec: 160, clipped: false });
  });

  it('clips a track longer than its slot at the next cue and at the end of the workout', () => {
    const runs = cueRuns(segments, [cue('a', tr('A', 400)), cue('c', tr('C', 900))]);
    expect(runs[0]?.items[0]).toMatchObject({ endSec: 300, fullEndSec: 400, clipped: true });
    expect(runs[1]?.items[0]).toMatchObject({ endSec: 600, fullEndSec: 1200, clipped: true });
  });

  it('chains the queue and stops at the limit', () => {
    const runs = cueRuns(segments, [
      { ...cue('b', tr('B', 80)), queue: [tr('Q1', 70), tr('Q2', 400)] },
    ]);
    const items = runs[0]?.items ?? [];
    expect(items.map((i) => [i.index, i.startSec, i.endSec, i.clipped])).toEqual([
      [0, 100, 180, false],
      [1, 180, 250, false],
      [2, 250, 600, true],
    ]);
  });

  it('marks an unknown length as open: playback holds the slot, the editor shows an estimate', () => {
    const cues = [cue('a', tr('A')), cue('b', tr('B'))];
    const play = cueRuns(segments, cues);
    expect(play[0]?.items[0]).toMatchObject({ open: true, endSec: 100, fullEndSec: Infinity });
    expect(play[0]?.endSec).toBe(100);
    const shown = cueRuns(segments, cues, { estimateSec: 210 });
    expect(shown[1]?.items[0]).toMatchObject({ open: true, fullEndSec: 310, clipped: false });
    expect(shown[0]?.items[0]).toMatchObject({ fullEndSec: 210, clipped: true });
  });

  it('uses the trimmed end for the run length', () => {
    const runs = cueRuns(segments, [cue('b', { ...tr('B', 300, 20), endAtSec: 80 })]);
    expect(runs[0]?.endSec).toBe(160);
  });
});
