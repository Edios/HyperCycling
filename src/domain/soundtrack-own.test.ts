import { describe, expect, it } from 'vitest';
import raw from '../content/soundtrack/catalog.json';
import { builtinWorkouts } from '../client/data/builtin';
import { parseCatalog } from './soundtrack-catalog';
import { compilePlan } from './soundtrack-compile';
import {
  DEFAULT_OWN_DURATION_SEC,
  DEFAULT_OWN_ENERGY,
  OWN_ID_PREFIX,
  isOwnTrackId,
  ownTrackRecord,
  ownTrackRecordSchema,
  withOwnTracks,
  toCatalogTrack,
  type OwnTrackRecord,
} from './soundtrack-own';
import { matchBpm } from './bpm-match';
import { sectionsOf } from './soundtrack';
import {
  OWN_BONUS,
  OWN_SHARE_BONUS,
  ownBonus,
  planSoundtrack,
  type OwnShare,
} from './soundtrack-plan';
import { soundtrackPlanRecordSchema, planRecord } from './soundtrack-store';
import { FIRST_VISIT_PREFS } from './soundtrack-wizard';

const catalog = parseCatalog(raw).tracks;
const NOW = new Date('2026-11-26T10:00:00.000Z');

function own(over: Partial<Parameters<typeof ownTrackRecord>[0]> = {}): OwnTrackRecord {
  return ownTrackRecord(
    { youtubeId: 'abcdefghijk', title: 'My Song', artist: 'Me', bpm: 128, ...over },
    NOW,
  );
}

describe('ownTrackRecord', () => {
  it('keys the record by the video id and stamps the time', () => {
    expect(own()).toEqual({
      id: `${OWN_ID_PREFIX}abcdefghijk`,
      schemaVersion: 1,
      createdAt: '2026-11-26T10:00:00.000Z',
      youtubeId: 'abcdefghijk',
      title: 'My Song',
      artist: 'Me',
      bpm: 128,
    });
    expect(isOwnTrackId(own().id)).toBe(true);
    expect(isOwnTrackId('kavinsky-nightcall')).toBe(false);
  });

  it('trims the texts, rounds the tempo and drops an empty artist', () => {
    const r = own({ title: '  Song  ', artist: '  ', bpm: 127.6, energy: 4, durationSec: 245.4 });
    expect(r.title).toBe('Song');
    expect(r).not.toHaveProperty('artist');
    expect(r.bpm).toBe(128);
    expect(r.energy).toBe(4);
    expect(r.durationSec).toBe(245);
  });
});

describe('ownTrackRecordSchema', () => {
  it('accepts a record it made and refuses broken ones', () => {
    expect(ownTrackRecordSchema.safeParse(own()).success).toBe(true);
    expect(ownTrackRecordSchema.safeParse(own({ energy: 5, durationSec: 300 })).success).toBe(true);
    const bad: unknown[] = [
      { ...own(), youtubeId: 'short' },
      { ...own(), bpm: 20 },
      { ...own(), energy: 6 },
      { ...own(), title: '' },
      { ...own(), schemaVersion: 2 },
    ];
    for (const b of bad) expect(ownTrackRecordSchema.safeParse(b).success).toBe(false);
  });
});

describe('toCatalogTrack', () => {
  it('is a clean song on the beat with one upload, of any category', () => {
    const t = toCatalogTrack(own());
    expect(t).toMatchObject({
      id: own().id,
      artist: 'Me',
      title: 'My Song',
      bpm: 128,
      energy: DEFAULT_OWN_ENERGY,
      durationSec: DEFAULT_OWN_DURATION_SEC,
      youtube: [{ id: 'abcdefghijk' }],
      categories: [],
      beat: 'steady',
      clean: true,
      own: true,
    });
    expect(t.roles).not.toContain('finisher');
  });

  it('keeps a sprint tempo for intervals only (the owner rule for the catalog)', () => {
    // 220 BPM ridden at 110 rpm.
    expect(toCatalogTrack(own({ bpm: 220 })).roles).toEqual(['intervals']);
  });

  it('uses the title as the artist when there is none (each own song its own artist)', () => {
    expect(toCatalogTrack(own({ artist: undefined })).artist).toBe('My Song');
  });
});

describe('withOwnTracks', () => {
  it('is the catalog itself without own songs, the catalog and the own songs otherwise', () => {
    expect(withOwnTracks(catalog, [])).toBe(catalog);
    expect(withOwnTracks(catalog, [own()])).toHaveLength(catalog.length + 1);
  });
});

describe('planning with own songs', () => {
  const workout = builtinWorkouts.find((w) => w.id === 'class-endurance-45')!;

  it('picks an own song that fits the cadence and marks it as own in the plan', () => {
    // Many own songs at a tempo that fits almost any part, in every energy.
    const mine = [1, 2, 3, 4, 5].flatMap((energy) =>
      [170, 176, 180, 88, 90].map((bpm, i) =>
        own({
          youtubeId: `own${energy}${i}abcdefg`.slice(0, 11),
          title: `Mine ${energy}-${i}`,
          artist: `Artist ${energy}-${i}`,
          bpm,
          energy: energy as 1 | 2 | 3 | 4 | 5,
        }),
      ),
    );
    const tracks = withOwnTracks(catalog, mine);
    const plan = planSoundtrack(workout, tracks, { ...FIRST_VISIT_PREFS, includeLibrary: true });
    const picks = plan.sections.flatMap((s) => s.picks);
    const ownPicks = picks.filter((p) => p.ref.kind === 'own');
    expect(ownPicks.length).toBeGreaterThan(0);
    for (const p of ownPicks) expect(isOwnTrackId(p.ref.id)).toBe(true);
    for (const p of picks.filter((x) => x.ref.kind === 'catalog'))
      expect(isOwnTrackId(p.ref.id)).toBe(false);
    // With the option off, the planner leaves them out.
    const off = planSoundtrack(workout, tracks, FIRST_VISIT_PREFS);
    expect(off.sections.flatMap((s) => s.picks).some((p) => p.ref.kind === 'own')).toBe(false);
    // The saved record takes it.
    expect(soundtrackPlanRecordSchema.safeParse(planRecord(plan, NOW)).success).toBe(true);
  });

  it('changes nothing when the rider has no own songs', () => {
    const plain = planSoundtrack(workout, catalog, FIRST_VISIT_PREFS);
    const withOption = planSoundtrack(workout, withOwnTracks(catalog, []), {
      ...FIRST_VISIT_PREFS,
      includeLibrary: true,
    });
    expect(withOption.sections).toEqual(plain.sections);
  });
});

describe('review of #153', () => {
  it('keeps the start of the link as the start of the song', () => {
    const r = own({ startSec: 30 });
    expect(r.startSec).toBe(30);
    expect(ownTrackRecordSchema.safeParse(r).success).toBe(true);
    expect(toCatalogTrack(r).startOffsetSec).toBe(30);
    expect(own({ startSec: 0 })).not.toHaveProperty('startSec');
  });

  it('leaves out an own song whose video is a catalog upload (one video, one song)', () => {
    const upload = catalog[0]!.youtube[0]!.id;
    const tracks = withOwnTracks(catalog, [own({ youtubeId: upload }), own()]);
    expect(tracks.filter((t) => t.own === true).map((t) => t.id)).toEqual([own().id]);
  });

  it('compiles an own song with a typed tempo: no catalog source', () => {
    const workout = builtinWorkouts.find((w) => w.id === 'class-endurance-45')!;
    const mine = [170, 176, 180, 88, 90].map((bpm, i) =>
      own({ youtubeId: `zzown${i}abcdef`, title: `Mine ${i}`, artist: `A${i}`, bpm }),
    );
    const tracks = withOwnTracks(catalog, mine);
    const plan = planSoundtrack(workout, tracks, { ...FIRST_VISIT_PREFS, includeLibrary: true });
    const out = compilePlan(plan, workout, { catalog: tracks });
    const refs = out.cues.flatMap((c) => [c.track, ...(c.queue ?? [])]);
    const ownRefs = refs.filter((r) => r.id.startsWith('zzown'));
    expect(ownRefs.length).toBeGreaterThan(0);
    for (const r of ownRefs) expect(r).not.toHaveProperty('bpmSource');
    for (const r of refs.filter((x) => !x.id.startsWith('zzown') && x.bpm !== undefined))
      expect(r.bpmSource).toBe('catalog');
    // Without the own songs the plan has a hole it says so (the ride setup shows it as stale).
    expect(compilePlan(plan, workout, { catalog }).missing.some(isOwnTrackId)).toBe(true);
  });
});

describe('how many of my songs (owner decision of 2026-11-26)', () => {
  // Ten own songs at tempos that fit the usual 86-94 rpm, energy 3 or 4.
  const mine = [172, 174, 176, 178, 180, 182, 184, 186, 188, 180].map((bpm, i) =>
    own({
      youtubeId: `share${i}abcdef`.slice(0, 11),
      title: `Mine ${i}`,
      artist: `Me ${i}`,
      bpm,
      energy: i % 2 === 0 ? 3 : 4,
      durationSec: 180 + 10 * i,
    }),
  );
  const tracks = withOwnTracks(catalog, mine);
  const ownSongs = mine.map(toCatalogTrack);

  /** Share of own songs among the picks where an own song not yet played fits the tempo. */
  function shareOf(ownShare: OwnShare | undefined): number {
    let chances = 0;
    let taken = 0;
    for (const w of builtinWorkouts) {
      const sections = new Map(sectionsOf(w).map((s) => [s.id, s]));
      const prefs = {
        ...FIRST_VISIT_PREFS,
        includeLibrary: true,
        ...(ownShare ? { ownShare } : {}),
      };
      const plan = planSoundtrack(w, tracks, prefs);
      const played = new Set<string>();
      for (const s of plan.sections) {
        const rpm = sections.get(s.sectionId)!.rpmMean;
        for (const p of s.picks) {
          const free = ownSongs.some(
            (t) => !played.has(t.id) && matchBpm(t.bpm!, rpm) !== undefined,
          );
          if (p.ref.kind === 'own') played.add(p.ref.id);
          if (!free) continue;
          chances += 1;
          if (p.ref.kind === 'own') taken += 1;
        }
      }
    }
    return taken / chances;
  }

  it('keeps the bonus of today on "half and half", the default', () => {
    expect(OWN_SHARE_BONUS.half).toBe(OWN_BONUS);
    expect(ownBonus({ ...FIRST_VISIT_PREFS })).toBe(OWN_BONUS);
    expect(ownBonus({ ...FIRST_VISIT_PREFS, ownShare: 'few' })).toBeLessThan(OWN_BONUS);
    expect(ownBonus({ ...FIRST_VISIT_PREFS, ownShare: 'most' })).toBeGreaterThan(OWN_BONUS);
  });

  it('plays about 10% / 50% / 80% own songs where their tempo fits (10 songs, 116 workouts)', () => {
    const few = shareOf('few');
    const half = shareOf(undefined);
    const most = shareOf('most');
    // Measured on the shipped catalog: 12.1% / 46.9% / 77.2% (one play per song and ride caps
    // "mostly mine" near 78%). Before the 85-95 rpm addition: 12.6% / 53.9% / 76.9%.
    expect(few).toBeGreaterThan(0.05);
    expect(few).toBeLessThan(0.18);
    expect(half).toBeGreaterThan(0.42);
    expect(half).toBeLessThan(0.6);
    expect(shareOf('half')).toBe(half);
    expect(most).toBeGreaterThan(0.72);
  }, 60_000);

  it('changes nothing without own songs, whatever the level', () => {
    const workout = builtinWorkouts.find((w) => w.id === 'class-endurance-45')!;
    const plain = planSoundtrack(workout, catalog, FIRST_VISIT_PREFS);
    for (const ownShare of ['few', 'half', 'most'] as const) {
      const p = planSoundtrack(workout, catalog, {
        ...FIRST_VISIT_PREFS,
        includeLibrary: true,
        ownShare,
      });
      expect(p.sections).toEqual(plain.sections);
    }
  });
});
