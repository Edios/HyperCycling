import { describe, expect, it } from 'vitest';
import { DEFAULT_EFFORT_TABLE, type EffortLevel } from './effort';
import {
  bestCategories,
  CATEGORY_TEMPO,
  coverage,
  COVERAGE_SHARE,
  DEFAULT_RPM,
  energyOf,
  INTERVAL_MIN_WORK_SHARE,
  isMusicCategory,
  MAX_SECTION_SEC,
  MAX_SECTIONS,
  MIN_SECTION_SEC,
  MUSIC_CATEGORIES,
  roleOfEffort,
  sectionsOf,
  SPLIT_SEC,
  type CoverageTrack,
  type MusicSection,
} from './soundtrack';
import { BPM_MAX, BPM_MIN } from './bpm-match';
import {
  totalDurationSec,
  type Block,
  type RampBlock,
  type SteadyBlock,
  type TrackRef,
  type Workout,
} from './workout';

// --- builders -------------------------------------------------------------------------------

const steady = (id: string, sec: number, effort: number, rpm?: number): SteadyBlock => ({
  kind: 'steady',
  id,
  durationSec: sec,
  intensity: { effort: effort as EffortLevel },
  ...(rpm !== undefined ? { rpm } : {}),
});
const ramp = (id: string, sec: number, from: number, to: number, rpm?: number): RampBlock => ({
  kind: 'ramp',
  id,
  durationSec: sec,
  from: { effort: from as EffortLevel },
  to: { effort: to as EffortLevel },
  ...(rpm !== undefined ? { rpm } : {}),
});
const repeat = (id: string, times: number, blocks: (SteadyBlock | RampBlock)[]): Block => ({
  kind: 'repeat',
  id,
  times,
  blocks,
});
const workout = (blocks: Block[], extra: Partial<Workout> = {}): Workout => ({
  id: 'w',
  name: 'W',
  description: '',
  category: 'freestyle',
  tags: [],
  source: { kind: 'user' },
  blocks,
  musicCues: [],
  fallbackPlaylist: [],
  schemaVersion: 1,
  updatedAt: '2026-11-21T00:00:00.000Z',
  ...extra,
});
const track: TrackRef = { provider: 'youtube', id: 'abcdefghijk', title: 'T', startAtSec: 0 };

/** Invariants every result must hold. */
function expectWellFormed(w: Workout, sections: MusicSection[]): void {
  expect(sections.length).toBeGreaterThan(0);
  expect(sections.length).toBeLessThanOrEqual(MAX_SECTIONS);
  let t = 0;
  sections.forEach((s, i) => {
    expect(s.id).toBe(`s${i + 1}`);
    expect(s.startSec).toBe(t);
    expect(s.durationSec).toBeGreaterThan(0);
    expect(s.blockRefs[0]).toEqual(s.anchor);
    expect(s.effort.min).toBeLessThanOrEqual(s.effort.mean);
    expect(s.effort.mean).toBeLessThanOrEqual(s.effort.max);
    expect(s.targetBpm).toBeCloseTo(2 * s.rpmMean, 9);
    t += s.durationSec;
  });
  expect(t).toBe(totalDurationSec(w));
}

const durations = (s: MusicSection[]) => s.map((x) => x.durationSec);
const anchors = (s: MusicSection[]) => s.map((x) => `${x.anchor.blockId}#${x.anchor.rep}`);

// --- tests ----------------------------------------------------------------------------------

describe('sectionsOf: units and merging', () => {
  it('returns nothing for a workout without blocks', () => {
    expect(sectionsOf(workout([]))).toEqual([]);
  });

  it('keeps a short HIIT repeat (30/30) whole: one section, never split inside', () => {
    const w = workout([
      ramp('wu', 240, 2, 4, 90),
      repeat('hiit', 4, [steady('on', 30, 6, 90), steady('off', 30, 5, 85)]),
      ramp('cd', 300, 4, 1, 85),
    ]);
    const s = sectionsOf(w);
    expectWellFormed(w, s);
    expect(anchors(s)).toEqual(['wu#1', 'on#1', 'cd#1']);
    expect(s[1]!.blockRefs).toHaveLength(8);
    expect(s[1]!.durationSec).toBe(240);
  });

  it('makes one section per repetition when a repetition lasts at least MIN_SECTION_SEC', () => {
    // music-climbs shape: 150 + 30 + 150 = 330 s per repetition.
    const w = workout([
      ramp('wu', 300, 2, 4, 90),
      repeat('mc', 5, [steady('a', 150, 5, 70), steady('b', 30, 6, 65), steady('c', 150, 2, 90)]),
      ramp('cd', 240, 4, 1, 80),
    ]);
    const s = sectionsOf(w);
    expectWellFormed(w, s);
    expect(anchors(s)).toEqual(['wu#1', 'a#1', 'a#2', 'a#3', 'a#4', 'a#5', 'cd#1']);
    expect(durations(s).slice(1, 6)).toEqual([330, 330, 330, 330, 330]);
  });

  it('merges similar neighbours but never past MAX_SECTION_SEC', () => {
    const w = workout([
      steady('a', 240, 5, 90),
      steady('b', 240, 5, 90),
      steady('c', 240, 5, 90),
      steady('d', 240, 6, 92),
    ]);
    const s = sectionsOf(w);
    expectWellFormed(w, s);
    expect(durations(s)).toEqual([480, 480]);
    for (const x of s) expect(x.durationSec).toBeLessThanOrEqual(MAX_SECTION_SEC);
  });

  it('does not merge across an effort jump above D_EFFORT', () => {
    const w = workout([steady('a', 200, 4, 90), steady('b', 200, 6, 90)]);
    expect(durations(sectionsOf(w))).toEqual([200, 200]);
  });

  it('does not merge across a cadence jump above D_RPM', () => {
    const w = workout([steady('a', 200, 5, 90), steady('b', 200, 5, 70)]);
    expect(durations(sectionsOf(w))).toEqual([200, 200]);
  });

  it('merges blocks without cadence on effort alone and marks the tempo as a guess', () => {
    const w = workout([steady('a', 200, 5), steady('b', 200, 5)]);
    const [s] = sectionsOf(w);
    expect(sectionsOf(w)).toHaveLength(1);
    expect(s!.rpmKnown).toBe(false);
    expect(s!.rpmMean).toBe(DEFAULT_RPM);
  });

  it('weights cadence and effort by time and counts a ramp as its mid-point', () => {
    const w = workout([steady('a', 300, 5, 80), ramp('b', 100, 4, 8, 100)]);
    const [s] = sectionsOf(w);
    expect(sectionsOf(w)).toHaveLength(1);
    expect(s!.rpmMean).toBeCloseTo((300 * 80 + 100 * 100) / 400, 9);
    expect(s!.effort.mean).toBeCloseTo((300 * 5 + 100 * 6) / 400, 9);
    expect(s!.effort.min).toBe(4);
    expect(s!.effort.max).toBe(8);
    expect(s!.targetBpm).toBeCloseTo(170, 9);
  });

  it('maps blocks set in %FTP to effort through the given table', () => {
    const w = workout([
      { kind: 'steady', id: 'a', durationSec: 300, intensity: { ftpPct: 100 }, rpm: 90 },
    ]);
    expect(sectionsOf(w)[0]!.effort.mean).toBe(8);
    const softer = DEFAULT_EFFORT_TABLE.map((r) => ({ ...r, ftpPct: r.ftpPct + 10 }));
    expect(sectionsOf(w, { table: softer })[0]!.effort.mean).toBe(7);
  });
});

describe('sectionsOf: short sections', () => {
  it('absorbs a short section into the neighbour of closer effort', () => {
    const w = workout([
      steady('a', 300, 3, 90),
      steady('x', 60, 7, 90), // short, closer to c
      steady('c', 300, 8, 90),
    ]);
    const s = sectionsOf(w);
    expectWellFormed(w, s);
    expect(anchors(s)).toEqual(['a#1', 'x#1']);
    expect(durations(s)).toEqual([300, 360]);
  });

  it('on an effort tie the harder neighbour absorbs the short section', () => {
    const w = workout([
      steady('a', 300, 3, 90),
      steady('x', 60, 5, 90), // 2 from each side
      steady('c', 300, 7, 90),
    ]);
    expect(anchors(sectionsOf(w))).toEqual(['a#1', 'x#1']);
  });

  it('absorbs a short first or last section into its only neighbour', () => {
    const w = workout([steady('x', 60, 9, 110), steady('a', 400, 3, 80), steady('z', 60, 9, 110)]);
    const s = sectionsOf(w);
    expect(s).toHaveLength(1);
    expect(s[0]!.durationSec).toBe(520);
  });

  it('lets absorbing grow a section past MAX_SECTION_SEC, but prefers staying within SPLIT_SEC', () => {
    // a and x cannot merge greedily (640 s > 600 s); absorbing may, since a is closer in effort.
    const fits = workout([
      steady('a', 580, 5, 90),
      steady('x', 60, 5, 90),
      steady('c', 300, 7, 90),
    ]);
    expect(durations(sectionsOf(fits))).toEqual([640, 300]);
    // Past SPLIT_SEC the other neighbour wins, even with a farther effort.
    const big = workout([
      ramp('a', 880, 4, 6, 90),
      steady('x', 60, 5, 90),
      steady('c', 300, 7, 90),
    ]);
    expect(durations(sectionsOf(big))).toEqual([880, 360]);
  });

  it('keeps the cool-down clean of a short piece of work next to longer work', () => {
    // class-endurance-45 tail: two 60 s pieces at other cadences between work and the cool-down.
    const w = workout(
      [
        ramp('rl', 360, 5, 7, 88),
        steady('a', 120, 5, 92),
        steady('b', 120, 6, 90),
        steady('c', 60, 5, 70),
        steady('d', 60, 6, 90),
        ramp('cd', 300, 4, 1, 85),
      ],
      { scaling: { warmupBlockId: 'rl', cooldownBlockId: 'cd' } },
    );
    const s = sectionsOf(w);
    expect(anchors(s)).toEqual(['rl#1', 'cd#1']);
    expect(s.map((x) => x.role)).toEqual(['tempo', 'cooldown']); // work too hard for a warm-up
  });

  it('keeps a workout shorter than MIN_SECTION_SEC as one section', () => {
    const w = workout([steady('a', 60, 3, 90), steady('b', 60, 9, 110)]);
    const s = sectionsOf(w);
    expectWellFormed(w, s);
    expect(s).toHaveLength(1);
  });
});

describe('sectionsOf: splitting', () => {
  it('splits a unit longer than SPLIT_SEC at the biggest jump, between repetitions', () => {
    // 10 x 100 s = 1000 s > SPLIT_SEC; repetitions are short, so the repeat is one unit.
    const w = workout([repeat('r', 10, [steady('on', 50, 7, 95), steady('off', 50, 4, 85)])]);
    const s = sectionsOf(w);
    expectWellFormed(w, s);
    expect(s.length).toBe(2);
    // Every rep boundary jumps the same (off -> on), so the most balanced cut wins.
    expect(anchors(s)).toEqual(['on#1', 'on#6']);
    for (const x of s) expect(x.durationSec).toBeGreaterThanOrEqual(MIN_SECTION_SEC);
  });

  it('cuts where the jump is biggest when the repetitions differ', () => {
    // One rep of 4 blocks = 280 s (>= MIN), 4 reps = 1120 s, but each rep is its own unit anyway;
    // use a single long repetition instead: a repeat of 1 is not allowed, so build a long rep.
    const w = workout([
      repeat('r', 2, [
        steady('a', 300, 5, 90),
        steady('b', 300, 5, 90),
        steady('c', 360, 9, 110), // big jump b -> c
      ]),
    ]);
    // Each repetition (960 s) is a unit longer than SPLIT_SEC and is cut before c.
    const s = sectionsOf(w);
    expectWellFormed(w, s);
    expect(anchors(s)).toEqual(['a#1', 'c#1', 'a#2', 'c#2']);
  });

  it('never cuts inside a single long block', () => {
    const w = workout([ramp('long', 1500, 3, 8, 90)]);
    const s = sectionsOf(w);
    expect(s).toHaveLength(1);
    expect(s[0]!.durationSec).toBeGreaterThan(SPLIT_SEC);
  });
});

describe('sectionsOf: limit, roles, energy, locks', () => {
  it('merges the most similar neighbours down to MAX_SECTIONS', () => {
    const blocks: Block[] = [];
    for (let i = 0; i < 20; i++) blocks.push(steady(`b${i}`, 200, i % 2 === 0 ? 3 : 8, 90));
    const w = workout(blocks);
    const s = sectionsOf(w);
    expectWellFormed(w, s);
    expect(s).toHaveLength(MAX_SECTIONS);
  });

  it('labels warm-up, cool-down and the middle by effort', () => {
    const w = workout([
      ramp('wu', 300, 2, 4, 90),
      steady('s', 300, 5, 90),
      steady('t', 300, 6, 105), // cadence far from s, so they stay apart
      steady('h', 300, 8, 100),
      steady('p', 300, 10, 110),
      ramp('cd', 300, 3, 1, 80),
    ]);
    const s = sectionsOf(w);
    expect(s.map((x) => x.role)).toEqual(['warmup', 'steady', 'tempo', 'hard', 'peak', 'cooldown']);
    expect(s.map((x) => x.energy)).toEqual([1, 3, 3, 4, 5, 1]);
  });

  it('does not call a hard opening a warm-up', () => {
    const w = workout([steady('a', 300, 7, 90), steady('b', 300, 3, 80)]);
    expect(sectionsOf(w).map((x) => x.role)).toEqual(['hard', 'cooldown']);
  });

  it('uses scaling.warmupBlockId for a warm-up with short bursts in it', () => {
    const blocks = [ramp('wu', 300, 2, 5, 90), steady('sp', 30, 9, 110), steady('r', 120, 2, 85)];
    const w = workout([...blocks, steady('x', 300, 6, 80)]);
    expect(sectionsOf(w)[0]!.role).toBe('steady');
    const scaled = { ...w, scaling: { warmupBlockId: 'wu', cooldownBlockId: 'x' } };
    expect(sectionsOf(scaled)[0]!.role).toBe('warmup');
  });

  it('uses scaling.cooldownBlockId for the cool-down role', () => {
    const w = workout([steady('a', 300, 7, 90), ramp('cd', 300, 6, 4, 85)], {
      scaling: { warmupBlockId: 'a', cooldownBlockId: 'cd' },
    });
    expect(sectionsOf(w).map((x) => x.role)).toEqual(['hard', 'cooldown']);
  });

  it('locks the cooldown block when the workout has a cooldown track', () => {
    const w = workout([steady('a', 300, 5, 90), steady('cd', 100, 5, 90)], {
      cooldownTrack: track,
    });
    const s = sectionsOf(w);
    expect(s.map((x) => x.locked)).toEqual([undefined, 'cooldownTrack']);
    // A locked section is not absorbed, even when shorter than MIN_SECTION_SEC.
    expect(durations(s)).toEqual([300, 100]);
  });

  it('locks the unit where a cue is already placed and never merges it', () => {
    const w = workout([steady('a', 200, 5, 90), steady('b', 200, 5, 90), steady('c', 200, 5, 90)], {
      musicCues: [{ blockId: 'b', rep: 1, track }],
    });
    const s = sectionsOf(w);
    expect(anchors(s)).toEqual(['a#1', 'b#1', 'c#1']);
    expect(s.map((x) => x.locked)).toEqual([undefined, 'userCue', undefined]);
  });

  it('locks a song slot with a pinned track in a songs-format workout', () => {
    const w = workout([steady('a', 300, 5, 90), steady('b', 300, 5, 90)], {
      format: 'songs',
      songs: [{ id: 'x', firstBlockId: 'b', lastBlockId: 'b', tracks: [track] }],
    });
    expect(sectionsOf(w).map((x) => x.locked)).toEqual([undefined, 'userCue']);
  });

  it('is deterministic and does not mutate the workout', () => {
    const w = workout([
      ramp('wu', 300, 2, 4, 90),
      repeat('r', 6, [steady('on', 40, 8, 100), steady('off', 20, 3, 80)]),
      ramp('cd', 200, 4, 1, 80),
    ]);
    const before = JSON.stringify(w);
    const a = sectionsOf(w);
    const b = sectionsOf(w);
    expect(a).toEqual(b);
    expect(JSON.stringify(w)).toBe(before);
  });
});

describe('sectionsOf: interval profile (music energy spec §2a)', () => {
  /** The owner's sprint: 8 x (15 s at effort 9-10, 105 rpm / 20 s at effort 2, 70 rpm). */
  const sprint = (
    work: SteadyBlock | RampBlock = ramp('on', 15, 9, 10, 105),
    rest: SteadyBlock | RampBlock = steady('off', 20, 2, 70),
  ) =>
    workout([
      ramp('wu', 300, 2, 4, 90),
      repeat('sprint', 8, [work, rest]),
      ramp('cd', 300, 4, 1, 85),
    ]);

  it('rates the sprint by its work phase: energy 5, peak, the work cadence (bug: energy 3, tempo, ~85 rpm)', () => {
    const w = sprint();
    const s = sectionsOf(w);
    expectWellFormed(w, s);
    const part = s.find((x) => x.anchor.blockId === 'on')!;
    expect(part.blockRefs).toHaveLength(16);
    expect({ energy: part.energy, role: part.role, rpm: part.rpmMean }).toEqual({
      energy: 5,
      role: 'peak',
      rpm: 105,
    });
    expect(part.targetBpm).toBe(210);
    expect(part.profile).toBe('intervals');
    expect(part.workEffort).toBeCloseTo(9.5, 9);
    // The honest mean stays what it is (the profile is how the music reads it).
    expect(part.effort.mean).toBeCloseTo((15 * 9.5 + 20 * 2) / 35, 9);
  });

  it('asks for one step less energy when the work is under 20% of the part (a few sprints in long rests)', () => {
    // 15 s at 9-10 in every 125 s: 12% work, the rest at effort 2.
    const s = sectionsOf(sprint(ramp('on', 15, 9, 10, 105), steady('off', 110, 2, 70)));
    const part = s.find((x) => x.anchor.blockId === 'on')!;
    expect(part.profile).toBe('intervals');
    expect(15 / 125).toBeLessThan(INTERVAL_MIN_WORK_SHARE);
    expect(part.role).toBe('peak');
    expect(part.rpmMean).toBe(105);
    expect(part.energy).toBe(4);
    // At 43% work (the owner's 15/20 sprint) the work phase's energy stays.
    const full = sectionsOf(sprint()).find((x) => x.anchor.blockId === 'on')!;
    expect(full.energy).toBe(5);
  });

  it('gives a work phase of 7-8.9 the hard role and energy 4', () => {
    const s = sectionsOf(sprint(steady('on', 20, 8, 100), steady('off', 20, 3, 75)));
    const part = s.find((x) => x.anchor.blockId === 'on')!;
    expect(part.profile).toBe('intervals');
    expect(part.workEffort).toBe(8);
    expect(part.role).toBe('hard');
    expect(part.energy).toBe(4);
    expect(part.rpmMean).toBe(100);
  });

  it('keeps the whole-section cadence when the work phase sets none', () => {
    const s = sectionsOf(sprint(steady('on', 15, 10), steady('off', 20, 2, 70)));
    const part = s.find((x) => x.anchor.blockId === 'on')!;
    expect(part.profile).toBe('intervals');
    expect(part.rpmMean).toBe(70);
    expect(part.rpmKnown).toBe(true);
  });

  it('is steady when the effort range is below 4 (the 30/30 HIIT at 6/5)', () => {
    const w = workout([
      ramp('wu', 240, 2, 4, 90),
      repeat('hiit', 4, [steady('on', 30, 6, 90), steady('off', 30, 5, 85)]),
      ramp('cd', 300, 4, 1, 85),
    ]);
    const part = sectionsOf(w)[1]!;
    expect(part.profile).toBe('steady');
    expect(part.workEffort).toBe(part.effort.mean);
    expect(part.energy).toBe(3);
    expect(part.rpmMean).toBeCloseTo(87.5, 9);
  });

  it('is steady when the work phases last 60 s or more on average', () => {
    const s = sectionsOf(sprint(steady('on', 60, 9, 100), steady('off', 60, 2, 80)));
    const part = s.find((x) => x.anchor.blockId === 'on')!;
    expect(part.profile).toBe('steady');
    expect(part.energy).toBe(energyOf(part.effort.mean));
    expect(part.role).toBe(roleOfEffort(part.effort.mean));
  });

  it('is steady with fewer than 3 crossings of the middle of the effort range', () => {
    const w = workout([steady('a', 120, 2, 80), steady('b', 50, 9, 100), steady('c', 120, 3, 80)]);
    const s = sectionsOf(w);
    expect(s).toHaveLength(1);
    expect(s[0]!.profile).toBe('steady');
  });

  it('leaves long intervals (a repetition of 150 s or more) as they were: one section each', () => {
    const w = workout([
      ramp('wu', 300, 2, 4, 90),
      repeat('long', 4, [steady('on', 90, 9, 100), steady('off', 90, 2, 80)]),
      ramp('cd', 300, 4, 1, 85),
    ]);
    const s = sectionsOf(w);
    expectWellFormed(w, s);
    for (const x of s.filter((y) => y.anchor.blockId === 'on')) {
      expect(x.profile).toBe('steady');
      expect(x.energy).toBe(energyOf(x.effort.mean));
      expect(x.rpmMean).toBeCloseTo((90 * 100 + 90 * 80) / 180, 9);
    }
  });

  it('leaves long repetitions merged into one section as they were (standing starts, 300 s each)', () => {
    const w = workout([
      ramp('wu', 300, 2, 4, 90),
      repeat('starts', 4, [
        steady('st', 10, 10, 72),
        steady('sit', 20, 9, 100),
        steady('off', 270, 2, 85),
      ]),
      ramp('cd', 300, 4, 1, 85),
    ]);
    const s = sectionsOf(w);
    expectWellFormed(w, s);
    const merged = s.filter((x) => x.anchor.blockId === 'st');
    expect(merged.some((x) => new Set(x.blockRefs.map((r) => r.rep)).size > 1)).toBe(true);
    for (const x of merged) {
      expect(x.profile).toBe('steady');
      expect(x.energy).toBe(energyOf(x.effort.mean));
    }
  });

  it('keeps the warm-up a warm-up even with short bursts in it', () => {
    const w = workout(
      [
        repeat('wu', 6, [steady('easy', 40, 3, 85), steady('burst', 10, 7, 110)]),
        steady('main', 600, 6, 90),
      ],
      { scaling: { warmupBlockId: 'wu', cooldownBlockId: 'x' } },
    );
    const first = sectionsOf(w)[0]!;
    expect(first.role).toBe('warmup');
    expect(first.energy).toBe(energyOf(first.effort.mean));
    expect(first.rpmMean).toBeCloseTo((40 * 85 + 10 * 110) / 50, 9);
  });
});

describe('energyOf and roleOfEffort', () => {
  it('maps effort to energy per the spec table', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(energyOf)).toEqual([1, 1, 1, 2, 3, 3, 4, 4, 5, 5]);
    expect(energyOf(4.4)).toBe(2);
    expect(energyOf(0)).toBe(1);
    expect(energyOf(12)).toBe(5);
  });

  it('maps mean effort to a role', () => {
    expect([5, 5.1, 6.5, 6.6, 8.5, 8.6].map(roleOfEffort)).toEqual([
      'steady',
      'tempo',
      'tempo',
      'hard',
      'hard',
      'peak',
    ]);
  });
});

describe('categories', () => {
  it('has the eight categories and a plausible tempo range for each', () => {
    expect(MUSIC_CATEGORIES).toHaveLength(8);
    for (const c of MUSIC_CATEGORIES) {
      expect(isMusicCategory(c)).toBe(true);
      for (const [lo, hi] of CATEGORY_TEMPO[c]) {
        expect(lo).toBeGreaterThanOrEqual(BPM_MIN);
        expect(hi).toBeLessThanOrEqual(BPM_MAX);
        expect(lo).toBeLessThan(hi);
      }
    }
    expect(isMusicCategory('synthwave')).toBe(false);
    expect(isMusicCategory(3)).toBe(false);
  });
});

describe('coverage', () => {
  // 600 s at 90 rpm (180 / 90 BPM), 300 s at 65 rpm (130 BPM), 300 s cool-down.
  const w = workout([
    steady('a', 300, 5, 90),
    steady('b', 300, 5, 90),
    steady('c', 300, 7, 65),
    ramp('cd', 300, 3, 1, 80),
  ]);
  const sections = sectionsOf(w);
  const t = (bpm: number, ...categories: CoverageTrack['categories']): CoverageTrack => ({
    bpm,
    categories,
  });

  it('counts songs that fit at least half of the time, per category', () => {
    expect(COVERAGE_SHARE).toBe(0.5);
    const tracks = [
      t(90, 'electronic'), // half time at 90 rpm: 600 + 300 cool-down = 75%
      t(180, 'rock', 'electronic'), // on the beat at 90 rpm: 75%
      t(130, 'house'), // fits 65 rpm only: 300 + 300 = 50%
      t(100, 'pop'), // nothing but the cool-down: 25%
    ];
    const cov = coverage(sections, tracks);
    const by = Object.fromEntries(cov.map((c) => [c.category, c.tracks]));
    expect(by).toMatchObject({ electronic: 2, rock: 1, house: 1, pop: 0, lofi: 0 });
    expect(cov.map((c) => c.category)).toEqual([...MUSIC_CATEGORIES]);
    expect(bestCategories(cov)).toEqual(['electronic', 'house']); // ties keep the category order
  });

  it('respects the category list, the half/double switch and the share', () => {
    const tracks = [t(90, 'electronic'), t(130, 'house'), t(100, 'pop')];
    expect(coverage(sections, tracks, ['pop', 'electronic'])).toEqual([
      { category: 'pop', tracks: 0 },
      { category: 'electronic', tracks: 1 },
    ]);
    expect(coverage(sections, tracks, ['electronic'], { halfDouble: false })[0]!.tracks).toBe(0);
    expect(coverage(sections, tracks, ['house'], { share: 0.6 })[0]!.tracks).toBe(0);
    expect(coverage(sections, tracks, ['pop'], { share: 0.25 })[0]!.tracks).toBe(1);
  });

  it('lets a song without a beat fit the cool-down only', () => {
    const beatless: CoverageTrack = { categories: ['lofi'] };
    expect(coverage(sections, [beatless], ['lofi'])[0]!.tracks).toBe(0); // 25%
    expect(coverage(sections, [beatless], ['lofi'], { share: 0.25 })[0]!.tracks).toBe(1);
  });

  it('counts a category listed twice on one song once', () => {
    expect(coverage(sections, [t(180, 'rock', 'rock')], ['rock'])[0]!.tracks).toBe(1);
  });

  it('widens the tempo window with a tolerance', () => {
    const tracks = [t(168, 'rock')]; // 6.7% below 180
    expect(coverage(sections, tracks, ['rock'])[0]!.tracks).toBe(0);
    expect(coverage(sections, tracks, ['rock'], { tolerance: 0.1 })[0]!.tracks).toBe(1);
  });

  it('leaves locked sections out and returns zeros when nothing is open', () => {
    const locked = sections.map((s) => ({ ...s, locked: 'userCue' as const }));
    expect(coverage(locked, [t(180, 'rock')], ['rock'])).toEqual([{ category: 'rock', tracks: 0 }]);
    expect(coverage([], [t(180, 'rock')], ['rock'])).toEqual([{ category: 'rock', tracks: 0 }]);
  });

  it('bestCategories drops empty ones and keeps the given order on ties', () => {
    expect(
      bestCategories(
        [
          { category: 'pop', tracks: 3 },
          { category: 'rock', tracks: 5 },
          { category: 'house', tracks: 3 },
          { category: 'lofi', tracks: 0 },
        ],
        3,
      ),
    ).toEqual(['rock', 'pop', 'house']);
    expect(bestCategories([{ category: 'pop', tracks: 1 }], 0)).toEqual([]);
  });
});
