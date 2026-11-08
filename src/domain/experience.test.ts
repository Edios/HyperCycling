import { describe, expect, it } from 'vitest';
import {
  experienceProblems,
  experienceSchema,
  experienceText,
  resolveChapters,
  songStartsSec,
  withExperiencePins,
  type Experience,
} from './experience';
import type { Workout } from './workout';

const steady = (id: string, durationSec: number) =>
  ({ kind: 'steady', id, durationSec, intensity: { effort: 4 } }) as const;

/** Three songs of 5, 20 and 5 minutes = 30 min. */
const WORKOUT = {
  id: 'w',
  name: 'W',
  description: '',
  category: 'freestyle',
  tags: [],
  source: { kind: 'builtin' },
  blocks: [steady('a', 300), steady('b', 1200), steady('c', 300)],
  musicCues: [],
  fallbackPlaylist: [],
  format: 'songs',
  songs: [
    { id: 's1', firstBlockId: 'a', lastBlockId: 'a' },
    { id: 's2', firstBlockId: 'b', lastBlockId: 'b' },
    { id: 's3', firstBlockId: 'c', lastBlockId: 'c' },
  ],
  schemaVersion: 1,
  updatedAt: '2026-11-07T00:00:00.000Z',
} as unknown as Workout;

const RAW = {
  id: 'e',
  title: 'E',
  description: 'd',
  workoutRef: { kind: 'builtin', id: 'w' },
  musicPins: [],
  worldTheme: {
    theme: 'neon-grid',
    chapters: [
      { atPin: 0, look: 'grid-wake' },
      { atPin: 2, look: 'arches' },
    ],
  },
  lengthMin: 30,
  level: 'easy',
  bike: 'manual-stepped',
  stepCount: 5,
  tags: [],
  schemaVersion: 1,
  updatedAt: '2026-11-07T00:00:00.000Z',
};

function parse(over: Record<string, unknown> = {}): Experience {
  return experienceSchema.parse({ ...RAW, ...over });
}

describe('experienceSchema', () => {
  it('accepts a valid file', () => {
    expect(parse().worldTheme.theme).toBe('neon-grid');
  });
  it('falls back to the abstract theme for an unknown one', () => {
    expect(parse({ worldTheme: { theme: 'jungle-from-the-future' } }).worldTheme.theme).toBe(
      'abstract',
    );
  });
  it('rejects chapters that are not sorted or repeat a pin', () => {
    const chapters = [
      { atPin: 2, look: 'a' },
      { atPin: 2, look: 'b' },
    ];
    expect(() => parse({ worldTheme: { theme: 'neon-grid', chapters } })).toThrow();
  });
  it('rejects a length outside 30/45/60 and an unknown level', () => {
    expect(() => parse({ lengthMin: 40 })).toThrow();
    expect(() => parse({ level: 'brutal' })).toThrow();
  });
});

describe('experienceText', () => {
  it('uses the localized text and falls back to the default', () => {
    const e = parse({ localized: { pl: { title: 'T', description: 'D' } } });
    expect(experienceText(e, 'pl').title).toBe('T');
    expect(experienceText(e, 'en').title).toBe('E');
  });
});

describe('songStartsSec / resolveChapters', () => {
  it('computes song starts from the slots', () => {
    expect(songStartsSec(WORKOUT)).toEqual([0, 300, 1500]);
  });
  it('maps atPin to workout seconds and drops pins past the last song', () => {
    const e = parse({
      worldTheme: {
        theme: 'neon-grid',
        chapters: [
          { atPin: 0, look: 'x' },
          { atPin: 1, look: 'y' },
          { atPin: 9, look: 'z' },
        ],
      },
    });
    expect(resolveChapters(e, WORKOUT)).toEqual([
      { startSec: 0, look: 'x' },
      { startSec: 300, look: 'y' },
    ]);
  });
  it('starts the first chapter at 0 even when it points at a later song', () => {
    const e = parse({ worldTheme: { theme: 'neon-grid', chapters: [{ atPin: 1, look: 'y' }] } });
    expect(resolveChapters(e, WORKOUT)).toEqual([
      { startSec: 0, look: 'y' },
      { startSec: 300, look: 'y' },
    ]);
  });
});

describe('experienceProblems', () => {
  it('is empty for a matching workout', () => {
    expect(experienceProblems(parse({ lengthMin: 30 }), WORKOUT)).toEqual([]);
  });
  it('reports a chapter past the last song, an unknown pin block and a wrong length', () => {
    const pin = {
      blockId: 'nope',
      rep: 1,
      track: { provider: 'youtube', id: 'x', title: 't', startAtSec: 0 },
    };
    const e = parse({
      lengthMin: 60,
      musicPins: [pin],
      worldTheme: { theme: 'neon-grid', chapters: [{ atPin: 7, look: 'x' }] },
    });
    const p = experienceProblems(e, WORKOUT).join('|');
    expect(p).toContain('past the last song');
    expect(p).toContain('unknown block');
    expect(p).toContain('length');
  });
  it('reports a workout without song slots', () => {
    const plain = { ...WORKOUT, format: 'classic', songs: undefined } as unknown as Workout;
    expect(experienceProblems(parse(), plain)[0]).toContain('no song slots');
  });
});

describe('withExperiencePins', () => {
  const track = (id: string) => ({ provider: 'youtube' as const, id, title: id, startAtSec: 0 });
  it('returns the same workout when there are no pins', () => {
    expect(withExperiencePins(WORKOUT, parse())).toBe(WORKOUT);
  });
  it('lets a pin win over the workout cue of the same block and repeat', () => {
    const w = {
      ...WORKOUT,
      musicCues: [
        { blockId: 'a', rep: 1, track: track('old') },
        { blockId: 'b', rep: 1, track: track('keep') },
      ],
    } as Workout;
    const e = parse({ musicPins: [{ blockId: 'a', rep: 1, track: track('new') }] });
    const out = withExperiencePins(w, e);
    expect(out.musicCues.map((c) => c.track.id).sort()).toEqual(['keep', 'new']);
  });
});

describe('musicHints', () => {
  const hint = { slot: 0, artist: 'Kavinsky', title: 'Nightcall', bpm: 91, durationSec: 259 };
  it('are optional: an older file without them still loads', () => {
    expect(parse().musicHints).toBeUndefined();
  });
  it('accept a suggestion with alternatives', () => {
    const e = parse({
      musicHints: [{ ...hint, alternatives: [{ artist: 'Tycho', title: 'Awake', bpm: 88 }] }],
    });
    expect(e.musicHints?.[0]?.alternatives).toHaveLength(1);
  });
  it('reject a missing title, an absurd tempo and no field for a Spotify id', () => {
    expect(() => parse({ musicHints: [{ ...hint, title: '' }] })).toThrow();
    expect(() => parse({ musicHints: [{ ...hint, bpm: 900 }] })).toThrow();
    expect(parse({ musicHints: [{ ...hint, id: 'abc' }] }).musicHints?.[0]).not.toHaveProperty(
      'id',
    );
  });
  it('are flagged when pointing past the last slot or repeated', () => {
    const past = parse({ musicHints: [{ ...hint, slot: 9 }] });
    expect(experienceProblems(past, WORKOUT).join()).toMatch(/past the last song/);
    const twice = parse({ musicHints: [hint, hint] });
    expect(experienceProblems(twice, WORKOUT).join()).toMatch(/duplicate music hint/);
  });
});
