import { describe, expect, it } from 'vitest';
import {
  cadenceFit,
  cadenceHints,
  cadenceOfBpmRange,
  slotCadence,
  sortByCadence,
  BPM_CLOSE,
  bpmCurve,
  BPM_RELAXED,
  fitToRange,
  BPM_MAX,
  BPM_MIN,
  CADENCE_HINT_MAX,
  CADENCE_HINT_MIN,
  GENRES,
  genresForRpm,
  KIND_TOLERANCE,
  kindTolerance,
  matchBpm,
  nearestKind,
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

describe('matchBpm with a tolerance', () => {
  it('without options keeps the 6% window', () => {
    expect(BPM_CLOSE).toBe(0.06);
    expect(matchBpm(170, 90)).toEqual(matchBpm(170, 90, {}));
    expect(matchBpm(168, 90)).toBeUndefined(); // 6.7% below 180
  });
  it('widens the window to 10% for the relaxed planner step', () => {
    const m = matchBpm(168, 90, { tolerance: BPM_RELAXED });
    expect(m).toMatchObject({ kind: 'exact', fit: 'close' });
    // Past the 6% window the score keeps falling gently (0.6 at 6%, 0.3 at 10%).
    expect(m!.score).toBeCloseTo(bpmCurve(12 / 180), 9);
    expect(m!.score).toBeLessThan(0.6);
    expect(m!.score).toBeGreaterThan(0.3);
    expect(m!.deviation).toBeCloseTo(12 / 180, 9);
    expect(matchBpm(160, 90, { tolerance: BPM_RELAXED })).toBeUndefined(); // 11% below
  });
  it('narrows the window, and on the beat never exceeds it', () => {
    expect(matchBpm(176, 90, { tolerance: 0.02 })).toBeUndefined(); // 2.2% below
    expect(matchBpm(178, 90, { tolerance: 0.02 })).toMatchObject({ fit: 'on-beat' });
    expect(matchBpm(180, 90, { tolerance: 0 })).toMatchObject({ fit: 'on-beat', score: 1 });
  });
  it('ignores an invalid tolerance', () => {
    for (const tolerance of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(matchBpm(168, 90, { tolerance })).toBeUndefined();
      expect(matchBpm(170, 90, { tolerance })).toEqual(matchBpm(170, 90));
    }
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

describe('fitToRange', () => {
  it('tells inside, half and double time', () => {
    expect(fitToRange(128, [120, 130])).toBe('exact');
    expect(fitToRange(64, [120, 130])).toBe('half');
    expect(fitToRange(250, [120, 130])).toBe('double');
    expect(fitToRange(100, [120, 130])).toBeUndefined();
    expect(fitToRange(0, [120, 130])).toBeUndefined();
  });
});

describe('cadenceHints (a song tempo as rpm)', () => {
  it('reads 2 BPM as 1 RPM, with a window of +-6%', () => {
    expect(cadenceHints(180)).toEqual([{ kind: 'exact', lo: 85, hi: 95 }]);
  });

  it('adds half time (BPM = RPM) when that cadence is rideable, in its own window (6.5%)', () => {
    expect(cadenceHints(120)).toEqual([
      { kind: 'exact', lo: 57, hi: 63 },
      { kind: 'half', lo: 113, hi: 128 },
    ]);
  });

  it('leaves out cadences nobody rides at and invalid tempos', () => {
    expect(cadenceHints(90).map((h) => h.kind)).toEqual(['half']);
    expect(cadenceHints(0)).toEqual([]);
    expect(cadenceHints(Number.NaN)).toEqual([]);
  });

  it('agrees with matchBpm: a cadence in a window matches the tempo', () => {
    for (const bpm of [100, 120, 140, 172]) {
      for (const h of cadenceHints(bpm)) {
        expect(matchBpm(bpm, (h.lo + h.hi) / 2)?.kind).toBe(h.kind);
      }
    }
  });
});

describe('cadenceFit', () => {
  it('is fit on the beat, alt in half or double time, miss otherwise', () => {
    expect(cadenceFit(180, 90)).toEqual({ verdict: 'fit', kind: 'exact' });
    expect(cadenceFit(90, 90)).toEqual({ verdict: 'fit', kind: 'half' }); // the planner's 1:1 at an easy 90 rpm
    expect(cadenceFit(75, 75)).toEqual({ verdict: 'alt', kind: 'half' }); // a climb wants 2x (150)
    expect(cadenceFit(200, 50)).toEqual({ verdict: 'alt', kind: 'double' });
    expect(cadenceFit(150, 90)).toEqual({ verdict: 'miss' });
  });

  it('marks a close fit', () => {
    expect(cadenceFit(188, 90)).toEqual({ verdict: 'fit', kind: 'exact', close: true });
  });

  it('is undefined without a tempo or a cadence', () => {
    expect(cadenceFit(undefined, 90)).toBeUndefined();
    expect(cadenceFit(180, undefined)).toBeUndefined();
    expect(cadenceFit(0, 90)).toBeUndefined();
  });
});

describe('sortByCadence', () => {
  it('puts fits first, then half/double time, then misses, then unknown, keeping order inside', () => {
    const items = [
      { id: 'miss1', bpm: 100 },
      { id: 'alt1', bpm: 75 },
      { id: 'unknown', bpm: undefined },
      { id: 'fit1', bpm: 150 },
      { id: 'miss2', bpm: 110 },
      { id: 'fit2', bpm: 145 },
    ];
    const sorted = sortByCadence(items, (i) => cadenceFit(i.bpm, 75));
    expect(sorted.map((i) => i.id)).toEqual(['fit1', 'fit2', 'alt1', 'miss1', 'miss2', 'unknown']);
  });
});

describe('sortByCadence inside a verdict', () => {
  it('puts tempos on the beat before close ones', () => {
    const items = [
      { id: 'close', bpm: 188 },
      { id: 'exact', bpm: 180 },
    ];
    expect(sortByCadence(items, (i) => cadenceFit(i.bpm, 90)).map((i) => i.id)).toEqual([
      'exact',
      'close',
    ]);
  });
});

describe('cadenceHints is the exact inverse of matchBpm (review B1)', () => {
  it('every whole cadence inside a hint window matches that tempo', () => {
    for (let bpm = BPM_MIN; bpm <= BPM_MAX; bpm++) {
      for (const h of cadenceHints(bpm)) {
        for (let rpm = h.lo; rpm <= h.hi; rpm++) {
          expect(matchBpm(bpm, rpm), `${bpm} BPM, ${rpm} rpm (${h.kind})`).toBeDefined();
        }
      }
    }
  });

  it('every rideable whole cadence that matches a tempo lies inside one of its windows', () => {
    for (let bpm = BPM_MIN; bpm <= BPM_MAX; bpm++) {
      const hints = cadenceHints(bpm);
      for (let rpm = CADENCE_HINT_MIN; rpm <= CADENCE_HINT_MAX; rpm++) {
        if (!matchBpm(bpm, rpm)) continue;
        expect(
          hints.some((h) => rpm >= h.lo && rpm <= h.hi),
          `${bpm} BPM matches ${rpm} rpm but no window holds it`,
        ).toBe(true);
      }
    }
  });

  it('gives the reviewed examples: 120 BPM is 57-63 rpm, 128 BPM starts at 61 rpm', () => {
    expect(cadenceHints(120)[0]).toEqual({ kind: 'exact', lo: 57, hi: 63 });
    expect(cadenceHints(128)[0]).toEqual({ kind: 'exact', lo: 61, hi: 68 });
    expect(cadenceFit(128, 60)?.verdict).toBe('miss');
    expect(cadenceFit(128, 61)?.verdict).toBe('fit');
    expect(cadenceFit(120, 56)?.verdict).toBe('miss');
  });
});

describe('a window of its own for 1:1, 2x and 4x (spec §9 A, R1e-3)', () => {
  it('gives 2x the full window, 1:1 a little more, 4x less', () => {
    expect(kindTolerance('exact')).toBeCloseTo(BPM_CLOSE, 10);
    expect(kindTolerance('half')).toBeCloseTo(0.065, 10);
    expect(kindTolerance('double')).toBeCloseTo(0.04, 10);
    expect(kindTolerance('half', BPM_RELAXED)).toBeGreaterThan(BPM_RELAXED);
    expect(KIND_TOLERANCE.exact).toBe(1);
  });

  it('matches a 1:1 song 6.3% off, but not a 2x song as far off', () => {
    expect(matchBpm(84.33, 90)?.kind).toBe('half'); // 90 rpm wants 90 BPM in 1:1: 6.3% off
    expect(matchBpm(168.66, 90)).toBeUndefined(); // and 180 BPM in 2x: 6.3% off
  });

  it('matches a 4x song only within 4%', () => {
    expect(matchBpm(207, 50)?.kind).toBe('double'); // 200 BPM wanted: 3.5% off
    expect(matchBpm(210, 50)).toBeUndefined(); // 5% off
  });

  it('keeps the editor hints the exact inverse of the planner in the relaxed window too', () => {
    for (let bpm = BPM_MIN; bpm <= BPM_MAX; bpm++) {
      const hints = cadenceHints(bpm, BPM_RELAXED);
      for (let rpm = CADENCE_HINT_MIN; rpm <= CADENCE_HINT_MAX; rpm++) {
        const m = matchBpm(bpm, rpm, { tolerance: BPM_RELAXED });
        const inside = hints.filter((h) => rpm >= h.lo && rpm <= h.hi).map((h) => h.kind);
        expect(inside.length > 0, `${bpm} BPM at ${rpm} rpm`).toBe(m !== undefined);
      }
    }
  });
});

describe('slot cadence (review B3)', () => {
  it('turns a BPM range into rpm only when that is a cadence nobody rejects', () => {
    expect(cadenceOfBpmRange([140, 160])).toEqual([70, 80]);
    expect(cadenceOfBpmRange([86, 86])).toBeUndefined();
    expect(cadenceOfBpmRange([170, 176])).toEqual([85, 88]);
  });

  it('uses the range when it says a rideable cadence, else the block cadence', () => {
    expect(slotCadence([170, 176], 70)).toBe(86.5);
    expect(slotCadence([86, 86], 90)).toBe(90);
    expect(slotCadence(undefined, 90)).toBe(90);
    expect(slotCadence(undefined, undefined)).toBeUndefined();
  });
});

describe('nearestKind: one rule for the planner and the editor', () => {
  it('picks the relation nearest the band, 2x on a tie', () => {
    expect(nearestKind(90, [120, 140])).toBe('half');
    expect(nearestKind(90, [120, 160])).toBe('exact');
    expect(nearestKind(65, [120, 150])).toBe('exact');
    expect(nearestKind(110, [120, 140])).toBe('half');
  });
});
