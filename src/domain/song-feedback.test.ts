import { describe, expect, it } from 'vitest';
import {
  feedbackContext,
  songFeedbackRecord,
  songFeedbackSchema,
  withRating,
  type SongFeedbackRecord,
} from './song-feedback';
import type { Segment } from './segments';
import type { TrackRef } from './workout';

const segment: Segment = {
  index: 2,
  startSec: 300,
  durationSec: 120,
  kind: 'steady',
  label: 'Tempo',
  ftpPctStart: 90,
  ftpPctEnd: 90,
  effortStart: 7,
  effortEnd: 7,
  rpm: 90,
  blockId: 'b',
  rep: 1,
  reps: 1,
};
const track: TrackRef = {
  provider: 'youtube',
  id: 'abcdefghijk',
  title: 'Song',
  artist: 'Band',
  bpm: 176,
  bpmSource: 'catalog',
  startAtSec: 0,
};
const NOW = new Date('2026-11-26T18:00:00.000Z');
const RIDE = '2026-11-26T17:40:00.000Z';

function rec(over: Partial<SongFeedbackRecord> = {}): SongFeedbackRecord {
  return {
    ...songFeedbackRecord({ rideStartedAt: RIDE, workoutId: 'w1', track, segment }, NOW),
    ...over,
  };
}

describe('feedbackContext', () => {
  it('keeps what the planner weighed: part, effort, cadence, tempo and 1:1 or 2x', () => {
    // 176 BPM at 90 rpm: two beats per pedal stroke ('exact' in bpm-match, shown as 2x).
    expect(feedbackContext(track, segment)).toEqual({
      segmentKind: 'steady',
      label: 'Tempo',
      effort: 7,
      ftpPct: 90,
      targetRpm: 90,
      bpm: 176,
      relation: 'exact',
    });
    expect(feedbackContext({ ...track, bpm: 92 }, segment).relation).toBe('half');
  });

  it('leaves out what is not known (no cadence, no tempo)', () => {
    const { rpm: _r, label: _l, ...bare } = segment;
    void _r;
    void _l;
    expect(feedbackContext({ ...track, bpm: undefined }, bare)).toEqual({
      segmentKind: 'steady',
      effort: 7,
      ftpPct: 90,
    });
    // A tempo that fits no relation keeps the tempo, without a relation.
    expect(feedbackContext({ ...track, bpm: 130 }, segment)).not.toHaveProperty('relation');
  });
});

describe('songFeedbackRecord', () => {
  it('is one record per song per ride, without a rating yet', () => {
    const r = rec();
    expect(r.id).toBe(`${RIDE}|youtube:abcdefghijk`);
    expect(r).toMatchObject({
      schemaVersion: 1,
      updatedAt: NOW.toISOString(),
      workoutId: 'w1',
      track: { provider: 'youtube', id: 'abcdefghijk', title: 'Song', artist: 'Band' },
    });
    expect(r).not.toHaveProperty('rating');
  });

  it('a second tap on the same thumb clears it; the heart is its own toggle', () => {
    const up = withRating(rec(), 'up', NOW);
    expect(up.rating).toBe('up');
    expect(withRating(up, 'down', NOW).rating).toBe('down');
    expect(withRating(up, 'up', NOW)).not.toHaveProperty('rating');
    const loved = withRating(up, 'love', NOW);
    expect(loved).toMatchObject({ rating: 'up', love: true });
    expect(withRating(loved, 'love', NOW)).not.toHaveProperty('love');
  });
});

describe('songFeedbackSchema', () => {
  it('accepts a rated record and refuses broken ones', () => {
    const ok = withRating(rec(), 'down', NOW);
    expect(songFeedbackSchema.safeParse(ok).success).toBe(true);
    for (const bad of [
      { ...ok, rating: 'meh' },
      { ...ok, schemaVersion: 2 },
      { ...ok, context: { ...ok.context, effort: 99 } },
      { ...ok, extra: 1 },
    ]) {
      expect(songFeedbackSchema.safeParse(bad).success).toBe(false);
    }
  });
});
