import { describe, expect, it } from 'vitest';
import {
  GENRES,
  genresForRpm,
  matchBpm,
  parseBpmFromName,
  parseBpmInput,
  rankTracks,
  tapTempoBpm,
  targetBpms,
} from './bpm-match';

describe('targetBpms', () => {
  it('90 RPM wants ~180 BPM (2 BPM = 1 RPM), with half time; double time is out of range', () => {
    const t = targetBpms(90);
    expect(t.find((x) => x.kind === 'exact')?.bpm).toBe(180);
    expect(t.find((x) => x.kind === 'half')?.bpm).toBe(90);
    expect(t.find((x) => x.kind === 'double')).toBeUndefined();
  });
  it('slow climb 60 RPM: 120 exact, 60 half, 240 double is out of range', () => {
    expect(targetBpms(60).map((x) => x.bpm)).toEqual([120, 60]);
  });
  it('keeps double time when it is a plausible tempo (45 RPM -> 180)', () => {
    expect(targetBpms(45).map((x) => [x.kind, x.bpm])).toEqual([
      ['exact', 90],
      ['half', 45],
      ['double', 180],
    ]);
  });
  it('returns nothing for invalid cadence', () => {
    expect(targetBpms(0)).toEqual([]);
    expect(targetBpms(Number.NaN)).toEqual([]);
  });
});

describe('matchBpm', () => {
  it('exact match scores 1', () => {
    expect(matchBpm(180, 90)).toMatchObject({ kind: 'exact', fit: 'on-beat', score: 1 });
  });
  it('within 3% is on the beat, within 6% is close, beyond is no match', () => {
    expect(matchBpm(184, 90)?.fit).toBe('on-beat');
    expect(matchBpm(188, 90)?.fit).toBe('close');
    expect(matchBpm(200, 90)).toBeUndefined();
  });
  it('recognises half time (90 BPM at 90 RPM) with a lower score than exact', () => {
    const m = matchBpm(90, 90);
    expect(m?.kind).toBe('half');
    expect(m!.score).toBeLessThan(1);
    expect(m!.score).toBeGreaterThan(0);
  });
  it('recognises double time (180 BPM at 45 RPM)', () => {
    expect(matchBpm(180, 45)?.kind).toBe('double');
  });
  it('rejects invalid input', () => {
    expect(matchBpm(0, 90)).toBeUndefined();
    expect(matchBpm(120, 0)).toBeUndefined();
    expect(matchBpm(Number.NaN, 90)).toBeUndefined();
  });
});

describe('tapTempoBpm', () => {
  it('needs at least 4 taps', () => {
    expect(tapTempoBpm([0, 500, 1000])).toBeUndefined();
  });
  it('computes BPM from the median interval', () => {
    expect(tapTempoBpm([0, 500, 1000, 1500, 2000])).toBe(120);
  });
  it('ignores one outlier tap', () => {
    expect(tapTempoBpm([0, 500, 1000, 1900, 2400, 2900])).toBe(120);
  });
  it('uses only the last 12 taps', () => {
    const slow = [0, 1000, 2000, 3000];
    const fast = Array.from({ length: 12 }, (_, i) => 3000 + (i + 1) * 500);
    expect(tapTempoBpm([...slow, ...fast])).toBe(120);
  });
});

describe('parseBpmFromName', () => {
  it('finds a BPM in a playlist/track name', () => {
    expect(parseBpmFromName('Climb 128 BPM mix')).toBe(128);
    expect(parseBpmFromName('Spin 140bpm')).toBe(140);
    expect(parseBpmFromName('bpm: 172')).toBe(172);
  });
  it('ignores names without a plausible BPM', () => {
    expect(parseBpmFromName('Best of 2020')).toBeUndefined();
    expect(parseBpmFromName('999 BPM')).toBeUndefined();
  });
});

describe('genres', () => {
  it('has unique ids with sane ranges', () => {
    expect(new Set(GENRES.map((g) => g.id)).size).toBe(GENRES.length);
    for (const g of GENRES) expect(g.bpmMin).toBeLessThan(g.bpmMax);
  });
  it('lists genres whose tempo range contains a target for the RPM', () => {
    expect(genresForRpm(90).map((g) => g.id)).toContain('drumAndBass');
    expect(genresForRpm(62).map((g) => g.id)).toContain('house');
    expect(genresForRpm(0)).toEqual([]);
  });
});

describe('rankTracks', () => {
  const tracks = [
    { id: 'a', bpm: 128 },
    { id: 'b', bpm: 180 },
    { id: 'c', bpm: 90 },
    { id: 'd' },
    { id: 'e', bpm: 100 },
  ];
  it('ranks exact first, then half/double, drops non-matching and unknown BPM', () => {
    expect(rankTracks(tracks, 90).map((x) => x.track.id)).toEqual(['b', 'c']);
  });
  it('is stable for equal scores', () => {
    const r = rankTracks(
      [
        { id: 'x', bpm: 180 },
        { id: 'y', bpm: 180 },
      ],
      90,
    );
    expect(r.map((x) => x.track.id)).toEqual(['x', 'y']);
  });
});

describe('parseBpmInput', () => {
  it('accepts plain numbers and rounds decimals', () => {
    expect(parseBpmInput('128')).toBe(128);
    expect(parseBpmInput(' 128.4 ')).toBe(128);
    expect(parseBpmInput('127,6')).toBe(128);
  });
  it('rejects hex, exponent, signs, text and out-of-range values', () => {
    for (const bad of ['0x50', '1e2', '-90', '+90', '12abc', '', '39', '221', '1000', 'NaN'])
      expect(parseBpmInput(bad), bad).toBeUndefined();
  });
});
