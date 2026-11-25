import { describe, expect, it } from 'vitest';
import raw from '../content/soundtrack/catalog.json';
import { builtinWorkouts } from '../client/data/builtin';
import { parseCatalog } from './soundtrack-catalog';
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
import { planSoundtrack } from './soundtrack-plan';
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
