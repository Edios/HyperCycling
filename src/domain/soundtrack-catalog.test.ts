import { describe, expect, it } from 'vitest';
import {
  catalogProblems,
  catalogRpm,
  catalogSchema,
  catalogTrackSchema,
  ENERGY_NOTE_MAX,
  HALF_FROM_BPM,
  isSprintTrack,
  parseCatalog,
  type CatalogTrack,
} from './soundtrack-catalog';

function track(over: Partial<CatalogTrack> = {}): CatalogTrack {
  return {
    id: 'artist-song',
    artist: 'Artist',
    title: 'Song',
    bpm: 170,
    durationSec: 240,
    categories: ['electronic'],
    roles: ['steady'],
    energy: 4,
    beat: 'steady',
    clean: true,
    verified: '2026-11-19',
    youtube: [
      { id: 'aaaaaaaaaaa', label: 'official/topic (Artist)', durationSec: 240 },
      { id: 'bbbbbbbbbbb', label: 're-upload', durationSec: 238 },
    ],
    ...over,
  };
}

const valid = (raw: unknown): boolean => catalogTrackSchema.safeParse(raw).success;

describe('catalogRpm', () => {
  it('rides fast songs two beats per stroke and slower ones one beat per stroke', () => {
    expect(catalogRpm(180)).toBe(90);
    expect(catalogRpm(HALF_FROM_BPM)).toBe(62.5);
    expect(catalogRpm(124)).toBe(124);
    expect(catalogRpm(85)).toBe(85);
  });
});

describe('catalogTrackSchema', () => {
  it('accepts a full entry and the optional fields', () => {
    expect(valid(track())).toBe(true);
    expect(
      valid(
        track({
          version: 'extended',
          startOffsetSec: 12,
          traits: ['instrumental', 'loopable'],
          bpmNote: 'sources say 85 (octave)',
          gem: true,
          pl: true,
        }),
      ),
    ).toBe(true);
  });

  it('rejects fields outside the schema (Spotify ids, URLs, proposal helpers)', () => {
    expect(valid({ ...track(), spotifyId: '4uLU6hMCjMI75M1A2tKUQC' })).toBe(false);
    expect(valid({ ...track(), _proposal: { roles: ['s'] } })).toBe(false);
    const upload = { id: 'ccccccccccc', durationSec: 200, url: 'https://youtu.be/ccccccccccc' };
    expect(valid(track({ youtube: [track().youtube[0]!, upload] }))).toBe(false);
  });

  it('needs at least two distinct uploads with real ids and at most six', () => {
    const [a, b] = track().youtube;
    expect(valid(track({ youtube: [a!] }))).toBe(false);
    expect(valid(track({ youtube: [a!, { ...b!, id: a!.id }] }))).toBe(false);
    expect(valid(track({ youtube: [a!, { ...b!, id: 'too-short' }] }))).toBe(false);
    expect(valid(track({ youtube: [a!, { id: 'bbbbbbbbbbb' }] }))).toBe(false); // no length
    const six = Array.from({ length: 6 }, (_, i) => ({ id: `video${i}abcde`, durationSec: 240 }));
    expect(valid(track({ youtube: six }))).toBe(true);
    expect(valid(track({ youtube: [...six, { id: 'video6abcde', durationSec: 240 }] }))).toBe(
      false,
    );
  });

  it('keeps tempo, length and energy in range', () => {
    expect(valid(track({ bpm: 39 }))).toBe(false);
    expect(valid(track({ bpm: 221 }))).toBe(false);
    expect(valid(track({ durationSec: 59 }))).toBe(false);
    expect(valid(track({ durationSec: 901 }))).toBe(false);
    expect(valid(track({ durationSec: 240.5 }))).toBe(false);
    expect(valid({ ...track(), energy: 6 })).toBe(false);
  });

  it('takes the energy tagging revision and a short energy note, both optional', () => {
    expect(valid(track({ tagged: 2 }))).toBe(true);
    expect(valid(track({ tagged: 2, energyNote: 'Soft ballad; ridden at 105 rpm.' }))).toBe(true);
    expect(valid(track({ energyNote: 'x'.repeat(ENERGY_NOTE_MAX) }))).toBe(true);
    expect(valid(track({ energyNote: 'x'.repeat(ENERGY_NOTE_MAX + 1) }))).toBe(false);
    expect(valid(track({ energyNote: '   ' }))).toBe(false);
    expect(valid({ ...track(), tagged: 1 })).toBe(false);
    expect(valid({ ...track(), tagged: 3 })).toBe(false);
  });

  it('needs known, distinct categories and roles and a slug id', () => {
    expect(valid(track({ categories: [] }))).toBe(false);
    expect(valid({ ...track(), categories: ['jazz'] })).toBe(false);
    expect(valid(track({ categories: ['pop', 'pop'] }))).toBe(false);
    expect(valid(track({ roles: [] }))).toBe(false);
    expect(valid({ ...track(), roles: ['sprint'] })).toBe(false);
    expect(valid(track({ roles: ['steady', 'steady'] }))).toBe(false);
    expect(valid(track({ traits: ['loopable', 'loopable'] }))).toBe(false);
    expect(valid(track({ id: 'Artist Song' }))).toBe(false);
    expect(valid(track({ verified: '19.11.2026' }))).toBe(false);
    expect(valid({ ...track(), gem: false })).toBe(false);
  });

  it('needs the tempo of a song on the beat only', () => {
    const noTempo = track({ bpm: undefined });
    expect(valid(noTempo)).toBe(false);
    expect(catalogTrackSchema.safeParse(noTempo).error?.issues[0]?.path).toEqual(['bpm']);
    expect(valid({ ...noTempo, beat: 'none' })).toBe(true);
    expect(valid(track({ beat: 'none' }))).toBe(true); // a nominal tempo may stay
  });

  it('knows the fallback trait', () => {
    expect(valid(track({ traits: ['instrumental', 'fallback'] }))).toBe(true);
    expect(valid({ ...track(), traits: ['backup'] })).toBe(false);
  });

  it('wraps the tracks in a versioned file', () => {
    expect(catalogSchema.safeParse({ v: 1, tracks: [track()] }).success).toBe(true);
    expect(catalogSchema.safeParse({ v: 2, tracks: [track()] }).success).toBe(false);
    expect(catalogSchema.safeParse({ v: 1, tracks: [] }).success).toBe(false);
  });
});

describe('catalogProblems', () => {
  const other = (id: string, ids: [string, string], over: Partial<CatalogTrack> = {}) =>
    track({
      id,
      title: id,
      youtube: ids.map((v) => ({ id: v, durationSec: 240 })),
      ...over,
    });

  it('finds nothing wrong in a clean list', () => {
    expect(catalogProblems([track(), other('second', ['ccccccccccc', 'ddddddddddd'])])).toEqual([]);
  });

  it('reports a duplicate id', () => {
    const dup = other('artist-song', ['ccccccccccc', 'ddddddddddd']);
    expect(catalogProblems([track(), dup])).toContain('artist-song: duplicate id');
  });

  it('reports the same song twice, whatever the version suffix', () => {
    const again = other('artist-song-remaster', ['ccccccccccc', 'ddddddddddd'], {
      title: 'Song (2011 Remaster)',
    });
    expect(catalogProblems([track(), again])).toEqual([
      'artist-song-remaster: same song as artist-song',
    ]);
  });

  it('reports one upload used by two songs', () => {
    const shared = other('second', ['aaaaaaaaaaa', 'ddddddddddd']);
    expect(catalogProblems([track(), shared])).toEqual([
      'second: upload aaaaaaaaaaa also used by artist-song',
    ]);
  });

  it("applies the owner's rule: a song ridden at 105 rpm or faster is for intervals only", () => {
    expect(catalogProblems([track({ bpm: 110, roles: ['intervals'] })])).toEqual([]);
    expect(catalogProblems([track({ bpm: 110, roles: ['steady'] })])).toEqual([
      'artist-song: ridden at 110 rpm, so its only role is intervals',
    ]);
    expect(catalogProblems([track({ bpm: 110, roles: ['intervals', 'climb'] })])).toHaveLength(1);
    // 104 rpm and half-time songs keep any role.
    expect(catalogProblems([track({ bpm: 104, roles: ['steady'] })])).toEqual([]);
    expect(catalogProblems([track({ bpm: 128, roles: ['climb'] })])).toEqual([]);
    // No beat, no cadence: any role.
    const noTempo = track({ bpm: undefined, beat: 'none', roles: ['cooldown'] });
    expect(catalogProblems([noTempo])).toEqual([]);
  });
});

describe('sprint songs: intervals, energy 4-5, no long intro', () => {
  it('knows a sprint song', () => {
    expect(isSprintTrack(track({ roles: ['intervals'], energy: 4 }))).toBe(true);
    expect(isSprintTrack(track({ roles: ['steady', 'intervals'], energy: 5 }))).toBe(true);
    expect(isSprintTrack(track({ roles: ['intervals'], energy: 3 }))).toBe(false);
    expect(isSprintTrack(track({ roles: ['steady'], energy: 5 }))).toBe(false);
    expect(isSprintTrack(track({ roles: ['intervals'], energy: 5, traits: ['long-intro'] }))).toBe(
      false,
    );
  });

  const tagged = (over: Partial<CatalogTrack>) => track({ tagged: 2, bpm: 120, ...over });

  it('lets a tagged intervals song that is not a sprint song stand only with a note', () => {
    const calm = tagged({ roles: ['intervals'], energy: 2 });
    expect(catalogProblems([calm])).toEqual([
      'artist-song: intervals role without sprint energy needs an energyNote',
    ]);
    expect(catalogProblems([{ ...calm, energyNote: 'Ballad; 105 rpm only by BPM.' }])).toEqual([]);
    const slowStart = tagged({ roles: ['intervals'], energy: 5, traits: ['long-intro'] });
    expect(catalogProblems([slowStart])).toHaveLength(1);
    expect(catalogProblems([tagged({ roles: ['intervals'], energy: 4 })])).toEqual([]);
  });

  it('asks for a note on a peak song in a warm-up or cool-down', () => {
    const hot = tagged({ bpm: 90, roles: ['warmup'], energy: 5 });
    expect(catalogProblems([hot])).toEqual([
      'artist-song: energy 5 in a warm-up or cool-down needs an energyNote',
    ]);
    expect(catalogProblems([{ ...hot, energyNote: 'Heavy riffs after a quiet start.' }])).toEqual(
      [],
    );
    expect(catalogProblems([tagged({ bpm: 90, roles: ['warmup'], energy: 4 })])).toEqual([]);
  });

  it('does not ask an untagged (first revision) song for a note, and a note needs a revision', () => {
    expect(catalogProblems([track({ bpm: 120, roles: ['intervals'], energy: 2 })])).toEqual([]);
    expect(catalogProblems([track({ energyNote: 'Doubt.' })])).toEqual([
      'artist-song: an energy note needs the tagging revision (tagged: 2)',
    ]);
  });
});

describe('parseCatalog', () => {
  it('returns a valid catalog', () => {
    const c = parseCatalog({ v: 1, tracks: [track()] });
    expect(c.tracks.map((t) => t.id)).toEqual(['artist-song']);
  });

  it('throws with the schema problems listed by path', () => {
    expect(() => parseCatalog({ v: 1, tracks: [{ ...track(), bpm: 300 }] })).toThrow(
      /tracks\.0\.bpm/,
    );
  });

  it('throws with the cross-entry problems listed', () => {
    expect(() => parseCatalog({ v: 1, tracks: [track(), track()] })).toThrow(
      /artist-song: duplicate id/,
    );
  });
});
