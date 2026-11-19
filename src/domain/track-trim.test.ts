import { describe, expect, it } from 'vitest';
import { trackEndSec, trackPlaySec, workoutSchema } from './workout';

describe('trackEndSec / trackPlaySec', () => {
  it('uses the recording length when there is no trimmed end', () => {
    expect(trackEndSec({ startAtSec: 20, durationSec: 200 })).toBe(200);
    expect(trackPlaySec({ startAtSec: 20, durationSec: 200 })).toBe(180);
  });
  it('uses the trimmed end when it lies after the start', () => {
    expect(trackPlaySec({ startAtSec: 20, endAtSec: 100, durationSec: 200 })).toBe(80);
    expect(trackPlaySec({ startAtSec: 0, endAtSec: 90 })).toBe(90);
  });
  it('never runs past the recording', () => {
    expect(trackEndSec({ startAtSec: 0, endAtSec: 500, durationSec: 200 })).toBe(200);
  });
  it('ignores an end at or before the start', () => {
    expect(trackEndSec({ startAtSec: 60, endAtSec: 60, durationSec: 200 })).toBe(200);
    expect(trackPlaySec({ startAtSec: 60, endAtSec: 10 })).toBeUndefined();
  });
  it('is unknown without a length or an end', () => {
    expect(trackPlaySec({ startAtSec: 0 })).toBeUndefined();
  });
});

describe('workoutSchema and endAtSec', () => {
  const base = {
    id: 'w',
    name: 'W',
    description: '',
    category: 'freestyle',
    tags: [],
    source: { kind: 'user' },
    blocks: [{ kind: 'steady', id: 'a', durationSec: 300, intensity: { effort: 4 } }],
    fallbackPlaylist: [],
    schemaVersion: 1,
    updatedAt: '2026-11-19T10:00:00.000Z',
  };
  const track = { provider: 'spotify', id: 'x', title: 'X', startAtSec: 0 };

  it('reads saved workouts without an end unchanged (backward compatible)', () => {
    const w = workoutSchema.parse({ ...base, musicCues: [{ blockId: 'a', rep: 1, track }] });
    expect(w.musicCues[0]?.track).toEqual(track);
    expect(w.musicCues[0]?.track.endAtSec).toBeUndefined();
  });
  it('keeps a trimmed end on the track and on queued tracks', () => {
    const w = workoutSchema.parse({
      ...base,
      musicCues: [
        {
          blockId: 'a',
          rep: 1,
          track: { ...track, endAtSec: 95 },
          queue: [{ ...track, id: 'y', startAtSec: 5, endAtSec: 60 }],
        },
      ],
    });
    expect(w.musicCues[0]?.track.endAtSec).toBe(95);
    expect(w.musicCues[0]?.queue?.[0]?.endAtSec).toBe(60);
  });
  it('rejects a negative end', () => {
    const r = workoutSchema.safeParse({
      ...base,
      musicCues: [{ blockId: 'a', rep: 1, track: { ...track, endAtSec: -1 } }],
    });
    expect(r.success).toBe(false);
  });
});
