import { describe, expect, it } from 'vitest';
import { BPM_RELAXED, matchBpm } from './bpm-match';
import type { EffortLevel } from './effort';
import { songKey } from './slot-plan';
import { sectionsOf, type MusicCategoryId, type MusicSection } from './soundtrack';
import type { CatalogTrack, TrackRole } from './soundtrack-catalog';
import {
  buildQueue,
  DEFAULT_SOUNDTRACK_PREFS,
  MAX_PICKS,
  planSoundtrack,
  scoreTrack,
  shuffleValue,
  soundtrackFingerprint,
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

describe('scoreTrack', () => {
  const s = section();

  it('ranks on the beat over close over half time, and drops a song off the tempo', () => {
    const onBeat = scoreTrack(song('a', { bpm: 180 }), s)!;
    const close = scoreTrack(song('b', { bpm: 189 }), s)!; // 5% off
    const half = scoreTrack(song('c', { bpm: 90 }), s)!;
    expect(onBeat.fit).toBe('on-beat');
    expect(close.fit).toBe('close');
    expect(half.fit).toBe('half');
    expect(onBeat.score).toBeGreaterThan(half.score);
    expect(half.score).toBeGreaterThan(close.score);
    expect(onBeat.rideRpm).toBe(90);
    expect(half.rideRpm).toBe(90);
    expect(scoreTrack(song('d', { bpm: 150 }), s)).toBeUndefined();
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
    const calm = scoreTrack(song('c', { bpm: 130, roles: ['climb'], energy: 1 }), climb)!;
    expect(climber.score).toBeGreaterThan(calm.score);
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

  it("puts a Polish song in every ride (owner's rule)", () => {
    const plan = planSoundtrack(ride, catalog, prefs({ categories: ['electronic'] }));
    const pl = allPicks(plan).filter((p) => byId(catalog).get(p.ref.id)!.pl);
    expect(pl).toHaveLength(1);
    // pl1 is rock: outside the chosen category, so the report says so.
    expect(plan.sections.some((s) => s.report.relaxed.includes('polish'))).toBe(true);
    // No Polish song that fits anywhere: nothing to do.
    const noPl = catalog.filter((t) => !t.pl);
    expect(allPicks(planSoundtrack(ride, noPl, prefs())).length).toBeGreaterThan(0);
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
      const first = planSoundtrack(ride, catalog, prefs());
      const withPl = first.sections.find((s) =>
        s.picks.some((x) => byId(catalog).get(x.ref.id)!.pl),
      )!;
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
