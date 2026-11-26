import { describe, expect, it } from 'vitest';
import { BPM_RELAXED, cadenceFit, matchBpm } from './bpm-match';
import type { EffortLevel } from './effort';
import { songKey } from './slot-plan';
import { sectionsOf, type MusicCategoryId, type MusicSection } from './soundtrack';
import type { CatalogTrack, TrackRole } from './soundtrack-catalog';
import {
  buildQueue,
  DEFAULT_SOUNDTRACK_PREFS,
  fitWeights,
  MAX_PICKS,
  planSoundtrack,
  preferredKindAt,
  ROTATION_REF_SEC,
  ROTATION_REST_RIDES,
  scoreTrack,
  shuffleValue,
  soundtrackFingerprint,
  WEIGHTS,
  type Candidate,
  type PlanPick,
  type SoundtrackPlan,
  type SoundtrackPrefs,
} from './soundtrack-plan';
import type { Block, RampBlock, SteadyBlock, TrackRef, Workout } from './workout';

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
  updatedAt: '2026-11-22T00:00:00.000Z',
  ...extra,
});

let uploadSeq = 0;
/** An 11-character YouTube-like id, unique per call. */
const uploadId = (): string => `up${String(uploadSeq++).padStart(9, '0')}`;

interface SongSpec {
  bpm?: number;
  sec?: number;
  categories?: MusicCategoryId[];
  roles?: TrackRole[];
  energy?: CatalogTrack['energy'];
  artist?: string;
  over?: Partial<CatalogTrack>;
  /** Length of the second upload (default: the song's). */
  altSec?: number;
}

function song(id: string, spec: SongSpec = {}): CatalogTrack {
  const sec = spec.sec ?? 200;
  const t: CatalogTrack = {
    id,
    artist: spec.artist ?? `Artist ${id}`,
    title: `Title ${id}`,
    durationSec: sec,
    categories: spec.categories ?? ['electronic'],
    roles: spec.roles ?? ['steady'],
    energy: spec.energy ?? 3,
    beat: 'steady',
    clean: true,
    verified: '2026-11-22',
    youtube: [
      { id: uploadId(), durationSec: sec },
      { id: uploadId(), durationSec: spec.altSec ?? sec },
    ],
    ...spec.over,
  };
  if (spec.bpm !== undefined || t.beat === 'steady') t.bpm = spec.bpm ?? 180;
  return t;
}

const prefs = (over: Partial<SoundtrackPrefs> = {}): SoundtrackPrefs => ({
  ...DEFAULT_SOUNDTRACK_PREFS,
  ...over,
});

/** A section to score against (only the fields scoring reads matter). */
const section = (over: Partial<MusicSection> = {}): MusicSection => ({
  id: 's1',
  anchor: { blockId: 'a', rep: 1 },
  startSec: 0,
  durationSec: 300,
  blockRefs: [{ blockId: 'a', rep: 1 }],
  role: 'steady',
  effort: { min: 5, max: 5, mean: 5 },
  rpmMean: 90,
  rpmKnown: true,
  targetBpm: 180,
  energy: 3,
  profile: 'steady',
  workEffort: 5,
  ...over,
});

const cand = (track: CatalogTrack, score = 0.8, lenSec = track.durationSec): Candidate => ({
  track,
  key: songKey(track),
  score,
  fit: 'on-beat',
  rideRpm: track.bpm === undefined ? undefined : track.bpm / 2,
  lenSec,
});

const allPicks = (plan: SoundtrackPlan): PlanPick[] => plan.sections.flatMap((s) => s.picks);
const byId = (catalog: readonly CatalogTrack[]) => new Map(catalog.map((t) => [t.id, t]));

/** A varied fixture catalog: songs at several tempos, lengths, roles and categories. */
function fixture(): CatalogTrack[] {
  const out: CatalogTrack[] = [];
  const cats: MusicCategoryId[] = ['electronic', 'rock', 'pop', 'house'];
  const tempos = [130, 140, 160, 170, 176, 180, 184, 90, 88, 65, 70, 120];
  const lens = [150, 180, 200, 215, 230, 245, 260, 280, 300, 330];
  let n = 0;
  for (const bpm of tempos) {
    for (let k = 0; k < 4; k++) {
      const id = `s${n}`;
      out.push(
        song(id, {
          bpm,
          sec: lens[(n * 7) % lens.length] as number,
          categories: [cats[n % cats.length] as MusicCategoryId],
          roles: bpm <= 140 ? ['climb', 'steady'] : ['steady', 'intervals'],
          energy: (2 + (n % 4)) as CatalogTrack['energy'],
          artist: `Artist ${n % 17}`,
        }),
      );
      n++;
    }
  }
  out.push(
    song('cool1', { sec: 240, roles: ['cooldown'], energy: 1, over: { beat: 'none' } }),
    song('cool2', { sec: 200, roles: ['cooldown'], energy: 1, over: { beat: 'none' } }),
    song('pl1', { bpm: 178, sec: 230, categories: ['rock'], over: { pl: true } }),
  );
  return out;
}

// --- scoreTrack -----------------------------------------------------------------------------

describe('scoreTrack: groove and mood (R1e-2)', () => {
  const work = section({ role: 'hard', energy: 4, workEffort: 7 });
  const warm = section({ role: 'warmup', energy: 2, rpmMean: 85, targetBpm: 170, workEffort: 3 });
  const cool = section({ role: 'cooldown', energy: 1, rpmMean: 80, targetBpm: 160, workEffort: 2 });
  const tagged = (over: Partial<CatalogTrack>, spec: SongSpec = {}): CatalogTrack =>
    song('t', { energy: 4, ...spec, over });

  it('prefers a steady groove (3) in the work and on climbs', () => {
    const loose = scoreTrack(tagged({ groove: 1 }), work)!.score;
    const mid = scoreTrack(tagged({ groove: 2 }), work)!.score;
    const tight = scoreTrack(tagged({ groove: 3 }), work)!.score;
    expect(tight).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(loose);
    const climb = section({ role: 'tempo', energy: 4, rpmMean: 65, targetBpm: 130, workEffort: 6 });
    const c = (g: 1 | 3) => scoreTrack(tagged({ groove: g }, { bpm: 130 }), climb)!.score;
    expect(c(3)).toBeGreaterThan(c(1));
  });

  it('prefers a looser groove (1) in the warm-up and the cool-down', () => {
    for (const s of [warm, cool]) {
      const g = (n: 1 | 3) =>
        scoreTrack(
          song('w', { energy: s.energy, roles: ['cooldown', 'warmup'], over: { groove: n } }),
          s,
        )!.score;
      expect(g(1)).toBeGreaterThan(g(3));
    }
  });

  it('leans on the mood by section type, lightly', () => {
    const m = (mood: NonNullable<CatalogTrack['mood']>, s: MusicSection) =>
      scoreTrack(
        song('m', {
          energy: s.energy,
          roles: ['warmup', 'cooldown', 'intervals', 'steady'],
          over: { mood },
        }),
        s,
      )!.score;
    expect(m('aggressive', work)).toBeGreaterThan(m('mellow', work));
    expect(m('mellow', warm)).toBeGreaterThan(m('aggressive', warm));
    expect(m('mellow', cool)).toBeGreaterThan(m('dark', cool));
    // Light: a mood never outweighs one step of energy.
    const best = m('aggressive', work) - m('mellow', work);
    expect(best).toBeLessThan(0.1);
  });

  it('leaves songs without the tags exactly where they were', () => {
    const plain = song('p', { energy: 4 });
    const neutral = { ...plain, groove: 2 as const };
    expect(scoreTrack(neutral, work)!.score).toBeCloseTo(scoreTrack(plain, work)!.score, 10);
  });
});

describe('scoreTrack: a section without a cadence (DEFAULT_RPM 90)', () => {
  it('is scored at the default cadence like an explicit 90 rpm one', () => {
    const w = workout([steady('a', 600, 5)]);
    const [sec] = sectionsOf(w);
    expect(sec!.rpmKnown).toBe(false);
    const explicit = section({ ...sec!, rpmKnown: true });
    for (const bpm of [90, 180, 150]) {
      const t = song('x', { bpm });
      expect(scoreTrack(t, sec!)).toEqual(scoreTrack(t, explicit));
    }
    // 1:1 at the default 90 rpm, as in any easy part.
    expect(scoreTrack(song('y', { bpm: 90 }), sec!)?.fit).toBe('half');
  });
});

describe('scoreTrack', () => {
  const s = section();

  it('ranks on the beat over close over half time, and drops a song off the tempo', () => {
    // A hard part: 180 BPM is nearer the 120-160 band than 90, so 2x is the relation in full
    // (spec §9 B; at an easy 90 rpm 1:1 would be).
    const s = section({ role: 'hard', energy: 4, workEffort: 7 });
    const onBeat = scoreTrack(song('a', { bpm: 180, energy: 4 }), s)!;
    const close = scoreTrack(song('b', { bpm: 189, energy: 4 }), s)!; // 5% off
    const half = scoreTrack(song('c', { bpm: 90, energy: 4 }), s)!;
    expect(onBeat.fit).toBe('on-beat');
    expect(close.fit).toBe('close');
    expect(half.fit).toBe('half');
    expect(onBeat.score).toBeGreaterThan(half.score);
    expect(half.score).toBeGreaterThan(close.score);
    expect(onBeat.rideRpm).toBe(90);
    expect(half.rideRpm).toBe(90);
    expect(scoreTrack(song('d', { bpm: 150, energy: 4 }), s)).toBeUndefined();
  });

  it('honours the tempo window, the half/double switch and the ignore-tempo step', () => {
    const far = song('a', { bpm: 196 }); // 8.9% off
    expect(scoreTrack(far, s)).toBeUndefined();
    expect(scoreTrack(far, s, { tolerance: BPM_RELAXED })?.fit).toBe('close');
    expect(scoreTrack(song('b', { bpm: 90 }), s, { halfDouble: false })).toBeUndefined();
    const off = scoreTrack(song('c', { bpm: 100 }), s, { ignoreBpm: true });
    expect(off?.fit).toBe('off');
    expect(off!.score).toBeLessThan(scoreTrack(song('d', { bpm: 180 }), s)!.score);
  });

  it('plays a song without a beat only in the cool-down, and nothing explicit there', () => {
    const beatless = song('a', { roles: ['cooldown'], energy: 1, over: { beat: 'none' } });
    expect(scoreTrack(beatless, s)).toBeUndefined();
    const cool = section({ role: 'cooldown', energy: 1 });
    expect(scoreTrack(beatless, cool)?.fit).toBe('nobeat');
    expect(scoreTrack(song('b', { over: { clean: false } }), cool)).toBeUndefined();
    // A song on the beat may close the ride too, below a beatless one.
    const onBeat = scoreTrack(song('c', { roles: ['cooldown'], energy: 1 }), cool)!;
    expect(onBeat.score).toBeLessThan(scoreTrack(beatless, cool)!.score);
    expect(scoreTrack(song('d', { bpm: 70, roles: ['cooldown'] }), cool)?.fit).toBe('off');
  });

  it("keeps a sprint song (105 rpm or faster) to hard and peak sections (owner's rule)", () => {
    const sprint = song('a', { bpm: 120, roles: ['intervals'] }); // ridden at 120 rpm
    const climb = section({ rpmMean: 60, targetBpm: 120 });
    expect(scoreTrack(sprint, climb)).toBeUndefined();
    expect(scoreTrack(sprint, { ...climb, role: 'tempo' })).toBeUndefined();
    expect(scoreTrack(sprint, { ...climb, role: 'hard' })?.fit).toBe('on-beat');
    expect(scoreTrack(sprint, { ...climb, role: 'peak' })?.fit).toBe('on-beat');
  });

  it('prefers the role and the energy the section asks for', () => {
    const climb = section({ rpmMean: 65, targetBpm: 130, role: 'tempo', energy: 4 });
    const climber = scoreTrack(song('a', { bpm: 130, roles: ['climb'], energy: 4 }), climb)!;
    const warm = scoreTrack(song('b', { bpm: 130, roles: ['warmup'], energy: 4 }), climb)!;
    expect(climber.score).toBeGreaterThan(warm.score);
    const milder = scoreTrack(song('c', { bpm: 130, roles: ['climb'], energy: 3 }), climb)!;
    expect(climber.score).toBeGreaterThan(milder.score);
    // A light song (energy 1-2) never plays on a climb (music energy spec §2b).
    expect(scoreTrack(song('f', { bpm: 130, roles: ['climb'], energy: 2 }), climb)).toBeUndefined();
    const peak = section({ role: 'peak', energy: 5 });
    const sprinter = scoreTrack(song('d', { roles: ['intervals'], energy: 5 }), peak)!;
    const cruiser = scoreTrack(song('e', { roles: ['warmup'], energy: 5 }), peak)!;
    expect(sprinter.score).toBeGreaterThan(cruiser.score);
  });

  it('scales by the category fit', () => {
    const t = song('a');
    expect(scoreTrack(t, s, { categoryFit: 0.5 })!.score).toBeLessThan(scoreTrack(t, s)!.score);
  });
});

// --- buildQueue -----------------------------------------------------------------------------

describe('buildQueue', () => {
  const lengthsOf = (cands: Candidate[], picks: number[]) =>
    picks.map((i) => (cands[i] as Candidate).lenSec);

  it('fills a section with songs that end at its end', () => {
    const cands = [
      cand(song('a', { sec: 200 }), 0.9),
      cand(song('b', { sec: 240 }), 0.85),
      cand(song('c', { sec: 100 }), 0.8),
    ];
    const q = buildQueue(cands, 300);
    expect(q.gapSec).toBeLessThanOrEqual(10);
    expect(q.cutSec).toBeLessThanOrEqual(45);
    expect(lengthsOf(cands, q.picks).sort()).toEqual([100, 200]);
  });

  it('prefers a queue cut by at most 45 s over a better song cut much more', () => {
    const cands = [cand(song('long', { sec: 300 }), 1), cand(song('fit', { sec: 160 }), 0.7)];
    const q = buildQueue(cands, 150);
    expect(lengthsOf(cands, q.picks)).toEqual([160]);
  });

  it('gives a long single block as many songs as it takes (no gap, at most the cue limit)', () => {
    const cands = Array.from({ length: 20 }, (_, i) =>
      cand(song(`l${i}`, { sec: 200 + (i % 5) * 20 }), 0.8 - i * 0.001),
    );
    const q = buildQueue(cands, 1200);
    expect(q.picks.length).toBeGreaterThanOrEqual(5);
    expect(q.picks.length).toBeLessThanOrEqual(MAX_PICKS);
    expect(q.gapSec).toBeLessThanOrEqual(10);
    expect(new Set(q.picks).size).toBe(q.picks.length);
  });

  it('charges a short song its rotation cost as if it lasted ROTATION_REF_SEC (R1f)', () => {
    // A 150 s song of the last ride (rotation 0.3 already in its score) used to pay that cost only
    // for its 150 s, so it stayed the handy filler of every ride. Now it pays for 240 s.
    const x = cand(song('x', { sec: 300 }), 0.8);
    const repeated = { ...cand(song('s', { sec: 150 }), 0.6), rotation: 0.3 };
    const fresh = cand(song('y', { sec: 150 }), 0.55);
    const q = buildQueue([x, repeated, fresh], 450);
    expect(q.picks.map((i) => [x, repeated, fresh][i]!.track.id)).toEqual(['x', 'y']);
    // Without a rotation cost the better score wins, as before.
    const plain = buildQueue([x, { ...repeated, rotation: 0 }, fresh], 450);
    expect(plain.picks.map((i) => [x, repeated, fresh][i]!.track.id)).toEqual(['x', 's']);
    expect(ROTATION_REF_SEC).toBe(240);
  });

  it('returns the longest queue when the music cannot fill the section', () => {
    const cands = [cand(song('a', { sec: 120 })), cand(song('b', { sec: 100 }))];
    const q = buildQueue(cands, 600);
    expect(q.picks).toHaveLength(2);
    expect(q.gapSec).toBe(380);
    expect(buildQueue([], 300)).toMatchObject({ picks: [], gapSec: 300, cutSec: 0 });
  });

  it('never plays one artist twice in a row when another order exists', () => {
    const cands = [
      cand(song('a', { sec: 150, artist: 'X' }), 0.9),
      cand(song('b', { sec: 150, artist: 'X' }), 0.89),
      cand(song('c', { sec: 150, artist: 'Y' }), 0.6),
    ];
    const q = buildQueue(cands, 450);
    const artists = q.picks.map((i) => (cands[i] as Candidate).track.artist);
    for (let i = 1; i < artists.length; i++) expect(artists[i]).not.toBe(artists[i - 1]);
    // Across the boundary of the section too (a near-equal song by someone else wins).
    const next = [cands[0]!, { ...cands[2]!, score: 0.8 }];
    const first = buildQueue(next, 150, { prevArtist: 'X' });
    expect((next[first.picks[0]!] as Candidate).track.artist).toBe('Y');
  });

  it('takes at most one add-on style song (synthwave, drum and bass) per section', () => {
    const cands = [
      cand(song('a', { sec: 150, over: { supplement: true } }), 0.95),
      cand(song('b', { sec: 150, over: { supplement: true } }), 0.94),
      cand(song('c', { sec: 150 }), 0.5),
    ];
    const q = buildQueue(cands, 300);
    const addOns = q.picks.filter((i) => (cands[i] as Candidate).track.supplement).length;
    expect(addOns).toBe(1);
  });

  it('fills the section whenever some songs can (property test, fixed seed)', () => {
    let seed = 7;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let round = 0; round < 300; round++) {
      const n = 4 + Math.floor(rand() * 6);
      const lens = Array.from({ length: n }, () => 120 + Math.floor(rand() * 240));
      const dur = 150 + Math.floor(rand() * 600);
      const cands = lens.map((l, i) =>
        cand(song(`p${round}-${i}`, { sec: l }), 0.6 + rand() * 0.4),
      );
      // Brute force: is there any subset that ends within the tolerances?
      let solvable = false;
      for (let mask = 1; mask < 1 << n && !solvable; mask++) {
        let sum = 0;
        for (let i = 0; i < n; i++) if (mask & (1 << i)) sum += lens[i] as number;
        solvable = sum >= dur - 10 && sum <= dur + 45;
      }
      const q = buildQueue(cands, dur);
      if (solvable) {
        expect(q.gapSec, `round ${round}`).toBeLessThanOrEqual(10);
        expect(q.cutSec, `round ${round}`).toBeLessThanOrEqual(45);
      }
    }
  });
});

// --- planSoundtrack -------------------------------------------------------------------------

/** 5 min warm-up, 2 x 8 min work at 88 rpm, 6 min climb at 65 rpm, 4 min cool-down. */
const ride = workout([
  ramp('wu', 300, 2, 4, 90),
  steady('w1', 480, 6, 88),
  steady('w2', 480, 7, 88),
  steady('cl', 360, 7, 65),
  ramp('cd', 240, 3, 1, 80),
]);

describe('planSoundtrack', () => {
  const catalog = fixture();

  it('fills every section, in order, with picks on the section clock', () => {
    const plan = planSoundtrack(ride, catalog, prefs());
    expect(plan.v).toBe(1);
    expect(plan.workoutId).toBe('w');
    expect(plan.fingerprint).toBe(soundtrackFingerprint(ride));
    expect(plan.sections.map((s) => s.sectionId)).toEqual(sectionsOf(ride).map((s) => s.id));
    for (const s of plan.sections) {
      expect(s.picks.length, s.sectionId).toBeGreaterThan(0);
      expect(s.report.gapSec, s.sectionId).toBeLessThanOrEqual(10);
      expect(s.report.warn, s.sectionId).toEqual([]);
      let at = 0;
      for (const p of s.picks) {
        expect(p.atSec).toBe(at);
        expect(p.playSec).toBeGreaterThan(0);
        expect(p.atSec + p.playSec).toBeLessThanOrEqual(s.durationSec);
        const track = byId(catalog).get(p.ref.id)!;
        expect(track.youtube.map((u) => u.id)).toContain(p.upload);
        at += track.durationSec - p.startAtSec;
      }
    }
  });

  it('never plays a song twice in a ride', () => {
    const keys = allPicks(planSoundtrack(ride, catalog, prefs())).map((p) =>
      songKey(byId(catalog).get(p.ref.id)!),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps every song in the section's tempo window, beatless songs in the cool-down", () => {
    const plan = planSoundtrack(ride, catalog, prefs());
    for (const s of plan.sections) {
      for (const p of s.picks) {
        const t = byId(catalog).get(p.ref.id)!;
        if (s.role === 'cooldown') continue;
        expect(t.beat, p.ref.id).toBe('steady');
        expect(matchBpm(t.bpm!, s.rpm, { tolerance: BPM_RELAXED }), p.ref.id).toBeDefined();
        expect(p.fit).not.toBe('off');
      }
    }
    const cool = plan.sections.find((s) => s.role === 'cooldown')!;
    expect(cool.picks.some((p) => byId(catalog).get(p.ref.id)!.beat === 'none')).toBe(true);
  });

  it('breaks near-ties per workout: one seed does not shuffle every workout alike (R1f)', () => {
    const p = prefs({ categories: ['electronic', 'rock'] });
    const ids = (w: Workout, seed: number) =>
      allPicks(planSoundtrack(w, catalog, { ...p, seed })).map((x) => x.ref.id);
    const a = { ...ride, id: 'ride-a' };
    const b = { ...ride, id: 'ride-b' };
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(seeds.some((seed) => ids(a, seed).join() !== ids(b, seed).join())).toBe(true);
    // Still deterministic for a workout and a seed.
    expect(ids(a, 3)).toEqual(ids(a, 3));
  });

  it('is deterministic for a seed; another seed shuffles near-equal songs', () => {
    const a = planSoundtrack(ride, catalog, prefs({ seed: 1 }));
    expect(planSoundtrack(ride, catalog, prefs({ seed: 1 }))).toEqual(a);
    const ids = (p: SoundtrackPlan) => allPicks(p).map((x) => x.ref.id);
    const others = [2, 3, 4, 5].map((seed) => ids(planSoundtrack(ride, catalog, prefs({ seed }))));
    expect(others.some((o) => o.join() !== ids(a).join())).toBe(true);
    // The catalog order does not matter.
    expect(ids(planSoundtrack(ride, [...catalog].reverse(), prefs({ seed: 1 })))).toEqual(ids(a));
    expect(shuffleValue(1, 'x')).toBe(shuffleValue(1, 'x'));
    expect(shuffleValue(1, 'x')).not.toBe(shuffleValue(2, 'x'));
  });

  it('never mutates its inputs', () => {
    const copy = structuredClone(catalog);
    const w = structuredClone(ride);
    planSoundtrack(w, catalog, prefs());
    expect(catalog).toEqual(copy);
    expect(w).toEqual(ride);
  });

  it('keeps explicit songs out unless the rider allows them, and out of the cool-down always', () => {
    const rude = catalog.map((t) => ({ ...t, clean: false }) as CatalogTrack);
    const none = planSoundtrack(ride, rude, prefs({ continuity: 'gapsOk' }));
    expect(allPicks(none)).toEqual([]);
    expect(none.sections.every((s) => s.report.warn.includes('none'))).toBe(true);
    const allowed = planSoundtrack(ride, rude, prefs({ explicit: true }));
    const cool = allowed.sections.find((s) => s.role === 'cooldown')!;
    expect(
      allowed.sections.filter((s) => s.role !== 'cooldown').every((s) => s.picks.length > 0),
    ).toBe(true);
    expect(cool.picks).toEqual([]);
  });

  it('plays the chosen categories when they have the songs', () => {
    const plan = planSoundtrack(ride, catalog, prefs({ categories: ['electronic', 'rock'] }));
    for (const s of plan.sections.filter((x) => x.role !== 'cooldown')) {
      if (s.report.relaxed.some((r) => r !== 'tolerance')) continue;
      for (const p of s.picks) {
        const cats = byId(catalog).get(p.ref.id)!.categories;
        expect(
          cats.some((c) => c === 'electronic' || c === 'rock'),
          p.ref.id,
        ).toBe(true);
      }
    }
  });

  describe('relaxation ladder (one step at a time)', () => {
    const one = workout([steady('a', 400, 5, 90)]);
    const plan = (cat: CatalogTrack[], cats: MusicCategoryId[] = ['electronic']) =>
      planSoundtrack(one, cat, prefs({ categories: cats })).sections[0]!;

    it('takes nothing when the songs fit as asked', () => {
      const s = plan([song('a', { sec: 200 }), song('b', { sec: 200 }), song('c', { sec: 210 })]);
      expect(s.report.relaxed).toEqual([]);
    });

    it('1. widens the tempo window', () => {
      const s = plan([195, 196, 197].map((bpm, i) => song(`t${i}`, { bpm, sec: 200 })));
      expect(s.report.relaxed).toEqual(['tolerance']);
      expect(s.picks.length).toBeGreaterThan(0);
    });

    it('2. takes a neighbour category', () => {
      const s = plan([0, 1, 2].map((i) => song(`h${i}`, { sec: 200, categories: ['house'] })));
      expect(s.report.relaxed).toEqual(['tolerance', 'category']);
    });

    it('3. takes any category', () => {
      const s = plan([0, 1, 2].map((i) => song(`r${i}`, { sec: 200, categories: ['latino'] })));
      expect(s.report.relaxed).toEqual(['tolerance', 'category', 'anyCategory']);
    });

    it('4. at last takes any tempo, with a warning', () => {
      const s = plan([0, 1, 2].map((i) => song(`b${i}`, { bpm: 100, sec: 200 })));
      expect(s.report.relaxed).toEqual(['tolerance', 'category', 'anyCategory', 'bpm']);
      expect(s.report.warn).toContain('bpm');
      expect(s.picks.every((p) => p.fit === 'off')).toBe(true);
    });

    it('stops climbing once a queue fills the section', () => {
      // Too little in the category at 6%, plenty at 10%: the walk stops at step 1.
      const s = plan([
        song('a', { sec: 200 }),
        ...[0, 1, 2].map((i) => song(`t${i}`, { bpm: 195, sec: 200 })),
        ...[0, 1].map((i) => song(`h${i}`, { sec: 200, categories: ['house'] })),
      ]);
      expect(s.report.relaxed).toEqual(['tolerance']);
    });
  });

  it('takes a Polish song of another kind like a neighbour category with the "Polish" chip on', () => {
    // 10 minutes at 89 rpm; Electronic has two songs (not enough), House (its neighbour) none.
    const part = workout([steady('a', 600, 5, 89)]);
    const songs = [
      song('e1', { bpm: 178, sec: 200, categories: ['electronic'] }),
      song('e2', { bpm: 178, sec: 200, categories: ['electronic'] }),
      song('r1', { bpm: 178, sec: 200, categories: ['rock'] }),
      song('pl1', { bpm: 178, sec: 200, categories: ['rock'], over: { pl: true } }),
    ];
    const off = planSoundtrack(part, songs, prefs({ categories: ['electronic'] }));
    // Without the chip a rock song only comes with "any category", Polish or not.
    expect(off.sections[0]!.report.relaxed).toContain('anyCategory');
    const on = planSoundtrack(part, songs, prefs({ categories: ['electronic'], polish: true }));
    // With it, the Polish rock song is a neighbour: one step earlier, and it is taken.
    expect(on.sections[0]!.report.relaxed).toEqual(['tolerance', 'category']);
    expect(on.sections[0]!.picks.map((p) => p.ref.id).sort()).toEqual(['e1', 'e2', 'pl1']);
    // Where the chosen kinds fill the part, the chip changes nothing (no full fit, no lift).
    const full = [...songs, song('e3', { bpm: 178, sec: 200, categories: ['electronic'] })];
    expect(
      planSoundtrack(part, full, prefs({ categories: ['electronic'], polish: true })).sections,
    ).toEqual(planSoundtrack(part, full, prefs({ categories: ['electronic'] })).sections);
  });

  it('rotates with the history of the last rides: a song of the last ride steps back', () => {
    // Electronic and rock: the fixture's electronic songs alone are all energy 2, which the work
    // now charges for (spec §9 C), so they no longer offer a real choice.
    const p = prefs({ categories: ['electronic', 'rock'] });
    const first = planSoundtrack(ride, catalog, p);
    const again = planSoundtrack(ride, catalog, p, {
      history: [allPicks(first).map((x) => x.ref.id)],
    });
    // The first song of some part is another one, and the plan as a whole changed.
    const firsts = (pl: SoundtrackPlan) => pl.sections.map((x) => x.picks[0]?.ref.id);
    expect(firsts(again)).not.toEqual(firsts(first));
    expect(allPicks(again).map((x) => x.ref.id)).not.toEqual(allPicks(first).map((x) => x.ref.id));
    // Ids that are not in the catalog are ignored.
    expect(planSoundtrack(ride, catalog, p, { history: [['no-such-song']] })).toEqual(first);
  });

  describe('a song of the last rides rests (owner decision of 2026-11-26: one song in at most 25% of rides)', () => {
    // 10 minutes at 90 rpm, Electronic chosen: three electronic songs right on the beat, and three
    // house songs (the neighbour category) as good in tempo.
    const part = workout([steady('a', 600, 3, 90)]);
    const own = ['e1', 'e2', 'e3'].map((id) => song(id, { sec: 200, categories: ['electronic'] }));
    const near = ['h1', 'h2', 'h3'].map((id) => song(id, { sec: 200, categories: ['house'] }));
    const p = prefs({ categories: ['electronic'] });
    const ids = (pl: SoundtrackPlan) =>
      allPicks(pl)
        .map((x) => x.ref.id)
        .sort();

    it('takes fresh songs of a neighbour category over the songs of one of the last rides', () => {
      expect(ids(planSoundtrack(part, [...own, ...near], p))).toEqual(['e1', 'e2', 'e3']);
      // Four rides of rest: a song plays in at most one ride of five.
      expect(ROTATION_REST_RIDES).toBe(4);
      for (let k = 0; k < ROTATION_REST_RIDES; k++) {
        const history = [...Array.from({ length: k }, () => ['other']), ['e1', 'e2', 'e3']];
        const plan = planSoundtrack(part, [...own, ...near], p, { history });
        expect(ids(plan), `ride ${k + 1} back`).toEqual(['h1', 'h2', 'h3']);
        expect(plan.sections[0]!.report.relaxed).toContain('category');
      }
    });

    it('lets a song play again once the rest is over', () => {
      const history = [
        ...Array.from({ length: ROTATION_REST_RIDES }, () => ['other']),
        ['e1', 'e2', 'e3'],
      ];
      expect(ids(planSoundtrack(part, [...own, ...near], p, { history }))).toEqual([
        'e1',
        'e2',
        'e3',
      ]);
    });

    it('still plays a resting song where nothing else fits (no gap instead)', () => {
      const plan = planSoundtrack(part, own, p, { history: [['e1', 'e2', 'e3']] });
      expect(ids(plan)).toEqual(['e1', 'e2', 'e3']);
      expect(plan.sections[0]!.report.gapSec).toBeLessThanOrEqual(10);
    });
  });

  it('leaves a locked section alone (the workout has its cool-down track)', () => {
    const cooldownTrack: TrackRef = {
      provider: 'youtube',
      id: 'abcdefghijk',
      title: 'Own',
      startAtSec: 0,
    };
    const w = { ...ride, cooldownTrack };
    const plan = planSoundtrack(w, catalog, prefs());
    const last = plan.sections[plan.sections.length - 1]!;
    expect(last.locked).toBe('cooldownTrack');
    expect(last.picks).toEqual([]);
    expect(last.report).toEqual({ gapSec: 0, cutSec: 0, relaxed: [], warn: [], fills: [] });
  });

  it('plans a very short ride with one song and a 20-minute block with many', () => {
    const short = planSoundtrack(workout([steady('a', 60, 5, 90)]), catalog, prefs());
    expect(short.sections).toHaveLength(1);
    expect(short.sections[0]!.picks).toHaveLength(1);
    expect(short.sections[0]!.picks[0]!.playSec).toBe(60);
    const long = planSoundtrack(workout([steady('z2', 1200, 4, 90)]), catalog, prefs());
    expect(long.sections).toHaveLength(1);
    expect(long.sections[0]!.picks.length).toBeGreaterThanOrEqual(4);
    expect(long.sections[0]!.report.gapSec).toBeLessThanOrEqual(10);
  });

  it('has nothing to play with an empty catalog, and says so', () => {
    const plan = planSoundtrack(ride, [], prefs());
    expect(allPicks(plan)).toEqual([]);
    expect(plan.fallback).toEqual([]);
    for (const s of plan.sections) expect(s.report.warn).toEqual(['none', 'gap']);
  });

  describe('gap rules', () => {
    const one = workout([steady('a', 300, 5, 90)]);

    it('R1: a longer upload of a queued song', () => {
      const cat = [song('a', { sec: 120, altSec: 175 }), song('b', { sec: 120, altSec: 120 })];
      const s = planSoundtrack(one, cat, prefs()).sections[0]!;
      expect(s.report.fills).toEqual(['longer']);
      expect(s.report.gapSec).toBeLessThanOrEqual(10);
      const a = s.picks.find((p) => p.ref.id === 'a')!;
      expect(a.upload).toBe(cat[0]!.youtube[1]!.id);
    });

    it('R3: the ending of an instrumental song again', () => {
      const cat = [song('i', { sec: 280, over: { traits: ['instrumental'] } })];
      const s = planSoundtrack(one, cat, prefs()).sections[0]!;
      expect(s.report.fills).toEqual(['loop']);
      expect(s.picks).toHaveLength(2);
      expect(s.picks[1]).toMatchObject({ ref: { id: 'i' }, startAtSec: 260, atSec: 280 });
      expect(s.report.gapSec).toBe(0);
    });

    it('R4: the long fallback songs, only with "no gaps"', () => {
      const fallback = song('fb', {
        sec: 500,
        roles: ['cooldown'],
        energy: 1,
        over: { beat: 'none', traits: ['instrumental', 'fallback'] },
      });
      const cat = [song('a', { sec: 120 }), fallback];
      const seamless = planSoundtrack(one, cat, prefs());
      expect(seamless.fallback.map((p) => p.ref.id)).toEqual(['fb']);
      expect(seamless.sections[0]!.report.fills).toEqual(['fallback']);
      expect(seamless.sections[0]!.report.warn).toEqual([]);
      // The fallback song is kept for the gaps, never queued.
      expect(allPicks(seamless).some((p) => p.ref.id === 'fb')).toBe(false);
      const gapsOk = planSoundtrack(one, cat, prefs({ continuity: 'gapsOk' }));
      expect(gapsOk.fallback).toEqual([]);
      expect(gapsOk.sections[0]!.report.warn).toEqual(['gap']);
      expect(gapsOk.sections[0]!.report.gapSec).toBe(180);
    });

    it('"short gaps are fine" leaves a gap of up to 30 s as it is', () => {
      const cat = [song('a', { sec: 280 })];
      const s = planSoundtrack(one, cat, prefs({ continuity: 'gapsOk' })).sections[0]!;
      expect(s.report).toMatchObject({ gapSec: 20, fills: [], warn: [] });
    });

    it('R4 covers a section with no song at all', () => {
      const fallback = song('fb', {
        sec: 900,
        roles: ['cooldown'],
        energy: 1,
        over: { beat: 'none', traits: ['fallback'] },
      });
      const s = planSoundtrack(one, [fallback], prefs()).sections[0]!;
      expect(s.picks).toEqual([]);
      expect(s.report.fills).toEqual(['fallback']);
      expect(s.report.warn).toEqual(['none']);
    });
  });

  it('plans 12 sections against 300 songs within the budget (spec: < 50 ms; CI ceiling 200 ms)', () => {
    const blocks = Array.from({ length: 12 }, (_, i) =>
      steady(`b${i}`, 300, i % 2 === 0 ? 4 : 8, i % 2 === 0 ? 90 : 65),
    );
    const w = workout(blocks);
    expect(sectionsOf(w)).toHaveLength(12);
    const big = Array.from({ length: 300 }, (_, i) =>
      song(`x${i}`, {
        bpm: 120 + ((i * 37) % 70),
        sec: 150 + ((i * 53) % 200),
        categories: [(['electronic', 'rock', 'pop'] as const)[i % 3]!],
        artist: `A${i % 40}`,
      }),
    );
    planSoundtrack(w, big, prefs()); // warm-up
    const t0 = performance.now();
    planSoundtrack(w, big, prefs());
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it('changes the fingerprint when the cadence or the effort changes, not the name', () => {
    const base = workout([steady('a', 300, 5, 90)]);
    const f = soundtrackFingerprint(base);
    expect(soundtrackFingerprint(workout([steady('a', 300, 5, 80)]))).not.toBe(f);
    expect(soundtrackFingerprint(workout([steady('a', 300, 7, 90)]))).not.toBe(f);
    expect(soundtrackFingerprint(workout([steady('a', 300, 5)]))).not.toBe(f);
    expect(soundtrackFingerprint({ ...base, name: 'Other', description: 'x' })).toBe(f);
  });

  it('keeps its own copy of the preferences', () => {
    const mine = prefs({ categories: ['rock'] });
    const p = planSoundtrack(ride, catalog, mine);
    mine.categories.push('pop');
    mine.seed = 99;
    expect(p.prefs.categories).toEqual(['rock']);
    expect(p.prefs.seed).toBe(DEFAULT_SOUNDTRACK_PREFS.seed);
  });

  describe('exclude and keep (Replace, Shuffle with locked sections)', () => {
    const all = (p: SoundtrackPlan) => allPicks(p).map((x) => x.ref.id);

    it('never plans a song the rider threw out', () => {
      const first = planSoundtrack(ride, catalog, prefs());
      const gone = new Set(all(first).slice(0, 3));
      const second = planSoundtrack(ride, catalog, prefs(), { exclude: gone });
      for (const id of gone) expect(all(second)).not.toContain(id);
      for (const s of second.sections) expect(s.report.gapSec).toBeLessThanOrEqual(10);
    });

    it('ignores an excluded id that is not in the catalog', () => {
      const a = planSoundtrack(ride, catalog, prefs());
      expect(planSoundtrack(ride, catalog, prefs(), { exclude: new Set(['nope']) })).toEqual(a);
    });

    it('keeps a locked section as it is and builds the rest around it', () => {
      const first = planSoundtrack(ride, catalog, prefs({ seed: 1 }));
      const locked = first.sections[1]!;
      const keep = new Map([[locked.sectionId, locked]]);
      const next = planSoundtrack(ride, catalog, prefs({ seed: 7 }), { keep });
      expect(next.sections[1]).toEqual(locked);
      // The other sections are planned again (another seed) and never repeat a locked song.
      const lockedIds = new Set(locked.picks.map((x) => x.ref.id));
      next.sections.forEach((s, i) => {
        if (i !== 1) for (const x of s.picks) expect(lockedIds.has(x.ref.id)).toBe(false);
      });
      const keys = all(next).map((id) => songKey(byId(catalog).get(id)!));
      expect(new Set(keys).size).toBe(keys.length);
      expect(all(next)).not.toEqual(all(first));
    });

    it('never repeats a song that a LATER locked section keeps', () => {
      const first = planSoundtrack(ride, catalog, prefs({ seed: 1 }));
      // Lock every section but the first: the first is planned again with a new seed and must
      // stay clear of the songs of all the others, though they come after it in the ride.
      const keep = new Map(first.sections.slice(1).map((s) => [s.sectionId, s]));
      for (const seed of [2, 3, 4, 5, 6]) {
        const next = planSoundtrack(ride, catalog, prefs({ seed }), {
          keep,
          exclude: new Set(first.sections[0]!.picks.map((x) => x.ref.id)),
        });
        const keys = all(next).map((id) => songKey(byId(catalog).get(id)!));
        expect(new Set(keys).size, `seed ${seed}`).toBe(keys.length);
      }
    });

    it('keeps everything when every section is locked', () => {
      const first = planSoundtrack(ride, catalog, prefs({ seed: 1 }));
      const keep = new Map(first.sections.map((s) => [s.sectionId, s]));
      const next = planSoundtrack(ride, catalog, prefs({ seed: 5 }), { keep });
      expect(next.sections).toEqual(first.sections);
    });

    it('does not add a second Polish song when a locked section has one', () => {
      // The Polish song made a good fit for the 65 rpm climb (2x = 130 BPM, in the band; spec §9 B/E
      // moved it out of the 88 rpm parts). Many fixture songs tie with it there, so whether a plan
      // takes it depends on the shuffle.
      const catalog = fixture().map((t) =>
        t.id === 'pl1'
          ? { ...t, bpm: 130, energy: 4 as const, roles: ['climb' as const, 'steady' as const] }
          : t,
      );
      // The first seed whose plan has it.
      const hasPl = (p: SoundtrackPlan) =>
        p.sections.find((s) => s.picks.some((x) => byId(catalog).get(x.ref.id)!.pl));
      const seed = Array.from({ length: 60 }, (_, i) => i + 1).find((n) =>
        hasPl(planSoundtrack(ride, catalog, prefs({ seed: n }))),
      )!;
      const withPl = hasPl(planSoundtrack(ride, catalog, prefs({ seed })))!;
      const keep = new Map([[withPl.sectionId, withPl]]);
      const next = planSoundtrack(ride, catalog, prefs({ seed: 3 }), { keep });
      const pl = all(next).filter((id) => byId(catalog).get(id)!.pl);
      expect(pl).toEqual(
        withPl.picks.map((x) => x.ref.id).filter((id) => byId(catalog).get(id)!.pl),
      );
    });

    it('ignores a lock whose section changed or whose song left the catalog', () => {
      const first = planSoundtrack(ride, catalog, prefs({ seed: 1 }));
      const locked = first.sections[0]!;
      const plain = planSoundtrack(ride, catalog, prefs({ seed: 2 }));
      const longer = { ...locked, durationSec: locked.durationSec + 30 };
      expect(
        planSoundtrack(ride, catalog, prefs({ seed: 2 }), {
          keep: new Map([[locked.sectionId, longer]]),
        }),
      ).toEqual(plain);
      const gone = catalog.filter((t) => t.id !== locked.picks[0]!.ref.id);
      const other = planSoundtrack(ride, gone, prefs({ seed: 2 }), {
        keep: new Map([[locked.sectionId, locked]]),
      });
      expect(other.sections[0]!.picks.map((x) => x.ref.id)).not.toContain(locked.picks[0]!.ref.id);
    });
  });

  it('changes the fingerprint when the structure changes', () => {
    const other = workout([steady('wu', 300, 2, 90)]);
    expect(soundtrackFingerprint(ride)).toMatch(/^[0-9a-f]{8}$/);
    expect(soundtrackFingerprint(other)).not.toBe(soundtrackFingerprint(ride));
    expect(soundtrackFingerprint(structuredClone(ride))).toBe(soundtrackFingerprint(ride));
  });
});

describe('preferredKindAt (the editor judges songs by the planner rule)', () => {
  // A calm 10-minute warm-up at 90 rpm, then easy work at 90 rpm, then a cool-down.
  const w = workout([
    steady('warm', 600, 3, 90),
    steady('work', 1200, 5, 90),
    steady('cool', 600, 2, 90),
  ]);

  it('is 2x in the warm-up and the cool-down, 1:1 in easy work at 90 rpm', () => {
    expect(preferredKindAt(w, 'warm')).toBe('exact');
    expect(preferredKindAt(w, 'work')).toBe('half');
    expect(preferredKindAt(w, 'cool')).toBe('exact');
    expect(preferredKindAt(w, 'missing')).toBeUndefined();
  });

  it('turns a 1:1 song in the warm-up into a second choice, a fit in the work', () => {
    expect(cadenceFit(90, 90, preferredKindAt(w, 'warm'))).toEqual({
      verdict: 'alt',
      kind: 'half',
    });
    expect(cadenceFit(90, 90, preferredKindAt(w, 'work'))).toEqual({
      verdict: 'fit',
      kind: 'half',
    });
    expect(cadenceFit(180, 90, preferredKindAt(w, 'warm'))).toEqual({
      verdict: 'fit',
      kind: 'exact',
    });
  });
});

describe('in intervals and at the peak the energy outweighs the tempo (spec §9 A, R1e-3)', () => {
  // On the beat but one step calmer, against the right energy 5.6% off the beat (190 BPM at 90 rpm).
  const onBeat = song('onbeat', { bpm: 180, energy: 4, roles: ['intervals'] });
  const energetic = song('energetic', { bpm: 190, energy: 5, roles: ['intervals'] });
  const scoreIn = (t: CatalogTrack, s: MusicSection) => scoreTrack(t, s)!.score;

  it('shifts weight from the tempo to the energy in intervals and peaks only', () => {
    const steady = fitWeights(section());
    expect(steady).toEqual({ bpm: WEIGHTS.bpm, energy: WEIGHTS.energy });
    for (const s of [section({ role: 'peak' }), section({ profile: 'intervals', role: 'hard' })]) {
      const w = fitWeights(s);
      expect(w.energy).toBeGreaterThan(WEIGHTS.energy);
      expect(w.bpm + w.energy).toBeCloseTo(WEIGHTS.bpm + WEIGHTS.energy, 10);
    }
  });

  it('prefers the energetic song at the peak, the on-beat one in a long hard part', () => {
    const peak = section({ role: 'peak', energy: 5, workEffort: 9 });
    const hard = section({ role: 'hard', energy: 5, workEffort: 8 });
    expect(scoreIn(energetic, peak)).toBeGreaterThan(scoreIn(onBeat, peak));
    expect(scoreIn(onBeat, hard)).toBeGreaterThan(scoreIn(energetic, hard));
  });
});
