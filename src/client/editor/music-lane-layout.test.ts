import { describe, expect, it } from 'vitest';
import { DEFAULT_EFFORT_TABLE } from '../../domain/effort';
import type { MusicCue, TrackRef, Workout } from '../../domain/workout';
import { axisBox, ESTIMATE_SEC, laneAxis, musicLaneLayout, secPerPx } from './music-lane-layout';

const steady = (id: string, durationSec: number) =>
  ({ kind: 'steady', id, durationSec, intensity: { effort: 4 } }) as const;

const tr = (id: string, durationSec?: number, extra: Partial<TrackRef> = {}): TrackRef => ({
  provider: 'spotify',
  id,
  title: id,
  startAtSec: 0,
  ...(durationSec !== undefined ? { durationSec } : {}),
  ...extra,
});

// a 0-300, b 300-900, c 900-1200 (cool-down: the last block)
function workout(musicCues: MusicCue[], extra: Partial<Workout> = {}): Workout {
  return {
    id: 'w',
    name: 'W',
    description: '',
    category: 'freestyle',
    tags: [],
    source: { kind: 'user' },
    blocks: [steady('a', 300), steady('b', 600), steady('c', 300)],
    musicCues,
    fallbackPlaylist: [],
    schemaVersion: 1,
    updatedAt: '2026-11-19T10:00:00.000Z',
    ...extra,
  };
}

const layout = (w: Workout, selectedId?: string, readOnly = false) =>
  musicLaneLayout(w, DEFAULT_EFFORT_TABLE, selectedId, readOnly);

describe('musicLaneLayout', () => {
  it('shows a track at its real length, not stretched over the block, and offers the free time', () => {
    const l = layout(workout([{ blockId: 'b', rep: 1, track: tr('B', 200) }]));
    expect(l.pills).toHaveLength(1);
    expect(l.pills[0]).toMatchObject({ startSec: 300, endSec: 500, clipped: false, estimated: false });
    expect(l.ghosts).toEqual([
      { key: 'next:b', kind: 'next', blockId: 'b', startSec: 500, endSec: 1200 },
    ]);
  });

  it('counts the length from "start at" to the trimmed end', () => {
    const track = tr('B', 300, { startAtSec: 60, endAtSec: 180 });
    const l = layout(workout([{ blockId: 'b', rep: 1, track }]));
    expect(l.pills[0]).toMatchObject({ startSec: 300, endSec: 420 });
  });

  it('cuts a track longer than its slot where the next track starts', () => {
    const l = layout(
      workout([
        { blockId: 'a', rep: 1, track: tr('A', 400) },
        { blockId: 'b', rep: 1, track: tr('B', 100) },
      ]),
    );
    expect(l.pills.map((p) => [p.startSec, p.endSec, p.clipped])).toEqual([
      [0, 300, true],
      [300, 400, false],
    ]);
    // a cut track leaves no free time after it
    expect(l.ghosts.map((g) => g.key)).toEqual(['next:b']);
  });

  it('cuts at the end of the workout and at the cool-down track', () => {
    const long = layout(workout([{ blockId: 'b', rep: 1, track: tr('B', 2000) }]));
    expect(long.pills[0]).toMatchObject({ endSec: 1200, clipped: true });
    const cool = layout(
      workout([{ blockId: 'b', rep: 1, track: tr('B', 2000) }], { cooldownTrack: tr('C', 300) }),
    );
    // the cool-down track has a lane of its own; here it only cuts the run
    expect(cool.pills).toHaveLength(1);
    expect(cool.pills[0]).toMatchObject({ endSec: 900, clipped: true });
  });

  it('lays the queue out back to back', () => {
    const l = layout(
      workout([{ blockId: 'a', rep: 1, track: tr('A', 120), queue: [tr('Q', 100)] }]),
    );
    expect(l.pills.map((p) => [p.index, p.startSec, p.endSec])).toEqual([
      [0, 0, 120],
      [1, 120, 220],
    ]);
    expect(l.ghosts[0]).toMatchObject({ kind: 'next', blockId: 'a', startSec: 220, endSec: 1200 });
  });

  it('shows an unknown length as an estimate with a hatched tail and no "next" button', () => {
    const l = layout(workout([{ blockId: 'a', rep: 1, track: tr('A') }]));
    expect(l.pills[0]).toMatchObject({ estimated: true, endSec: ESTIMATE_SEC });
    expect(l.tails).toEqual([{ key: 'tail:a:1', startSec: ESTIMATE_SEC, endSec: 1200 }]);
    expect(l.ghosts).toEqual([]);
  });

  it('places the pin placeholder only where nothing plays, splitting the free time', () => {
    const w = workout([{ blockId: 'a', rep: 1, track: tr('A', 100) }]);
    const l = layout(w, 'b');
    expect(l.ghosts).toEqual([
      { key: 'next:a', kind: 'next', blockId: 'a', startSec: 100, endSec: 300 },
      { key: 'pin:b', kind: 'pin', blockId: 'b', startSec: 300, endSec: 1200 },
    ]);
    // no ghost overlaps a pill or another ghost
    const spans = [...l.pills, ...l.ghosts].map((x) => [x.startSec, x.endSec] as const);
    spans.sort((x, y) => x[0] - y[0]);
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i]?.[0]).toBeGreaterThanOrEqual(spans[i - 1]?.[1] ?? 0);
    }
  });

  it('offers no pin where a longer track still plays (no overlap)', () => {
    const l = layout(workout([{ blockId: 'a', rep: 1, track: tr('A', 500) }]), 'b');
    expect(l.ghosts.find((g) => g.kind === 'pin')).toBeUndefined();
    expect(l.pills[0]).toMatchObject({ endSec: 500 });
  });

  it('marks the selected block cue (for trim handles) and offers nothing when read-only', () => {
    const w = workout([{ blockId: 'a', rep: 1, track: tr('A', 100) }]);
    expect(layout(w, 'a').selectedCue).toEqual({ blockId: 'a', rep: 1 });
    expect(layout(w, 'b', true).ghosts).toEqual([]);
  });

  it('applies a drag preview without changing the workout', () => {
    const w = workout([{ blockId: 'b', rep: 1, track: tr('B', 300) }]);
    const l = musicLaneLayout(w, DEFAULT_EFFORT_TABLE, 'b', false, {
      blockId: 'b',
      rep: 1,
      index: 0,
      track: tr('B', 300, { endAtSec: 120 }),
    });
    expect(l.pills[0]).toMatchObject({ endSec: 420 });
    expect(w.musicCues[0]?.track.endAtSec).toBeUndefined();
  });
});

describe('lane axis', () => {
  it('maps time on the timeline scale: fixed gaps between top-level bars', () => {
    const axis = laneAxis(workout([]));
    expect(axis).toEqual({ totalSec: 1200, edges: [0, 300, 900, 1200] });
    // 3 bars -> 2 gaps of 2px; the second block starts after one gap
    expect(axisBox(axis, 300, 900, 0)).toEqual({
      left: 'calc(2px + (100% - 4px) * 0.25)',
      width: 'max(0px, calc(0px + (100% - 4px) * 0.5 - 0px))',
    });
    // the end of the whole workout lands on the right edge
    expect(axisBox(axis, 0, 1200, 0).width).toBe('max(0px, calc(4px + (100% - 4px) * 1 - 0px))');
    expect(secPerPx(axis, 604)).toBe(2);
  });
});
