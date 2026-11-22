import { describe, expect, it } from 'vitest';
import type { EffortLevel } from './effort';
import { musicAt } from './music-schedule';
import { flattenWorkout } from './segments';
import type { CatalogTrack } from './soundtrack-catalog';
import { compilePlan, withSoundtrack } from './soundtrack-compile';
import {
  DEFAULT_SOUNDTRACK_PREFS,
  planSoundtrack,
  type SoundtrackPlan,
  type SoundtrackPrefs,
} from './soundtrack-plan';
import {
  effectiveMusicCues,
  totalDurationSec,
  type Block,
  type SteadyBlock,
  type TrackRef,
  type Workout,
} from './workout';

const steady = (id: string, sec: number, effort: number, rpm: number): SteadyBlock => ({
  kind: 'steady',
  id,
  durationSec: sec,
  intensity: { effort: effort as EffortLevel },
  rpm,
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

let seq = 0;
const uid = (): string => `cp${String(seq++).padStart(9, '0')}`;

function song(
  id: string,
  sec: number,
  over: Partial<CatalogTrack> = {},
  uploads = 3,
): CatalogTrack {
  return {
    id,
    artist: `Artist ${id}`,
    title: `Title ${id}`,
    bpm: 180,
    durationSec: sec,
    categories: ['electronic'],
    roles: ['steady'],
    energy: 3,
    beat: 'steady',
    clean: true,
    verified: '2026-11-22',
    youtube: Array.from({ length: uploads }, (_, i) => ({ id: uid(), durationSec: sec + i * 4 })),
    ...over,
  };
}

const prefs = (over: Partial<SoundtrackPrefs> = {}): SoundtrackPrefs => ({
  ...DEFAULT_SOUNDTRACK_PREFS,
  ...over,
});

/** Two sections: 8 min at 90 rpm (effort 5), 6 min climb at 65 rpm (effort 8). */
const ride = workout([steady('a', 480, 5, 90), steady('b', 360, 8, 65)]);

const catalog: CatalogTrack[] = [
  ...[200, 220, 240, 260, 280].map((s, i) => song(`f${i}`, s)),
  ...[170, 180, 190, 200].map((s, i) =>
    song(`c${i}`, s, { bpm: 130, roles: ['climb'], energy: 4 }),
  ),
  song('fb', 600, {
    bpm: undefined,
    beat: 'none',
    roles: ['cooldown'],
    energy: 1,
    traits: ['instrumental', 'fallback'],
  }),
];

/** Every second outside the closing silence plays something. */
function holes(w: Workout, plan: SoundtrackPlan, cat: readonly CatalogTrack[]): number[] {
  const compiled = compilePlan(plan, w, { catalog: cat });
  const segments = flattenWorkout(w);
  const cues = effectiveMusicCues({ ...w, musicCues: compiled.cues });
  const end = totalDurationSec(w) - (w.silenceLastSec ?? 0);
  const out: number[] = [];
  for (let t = 0; t < end; t++) {
    if (!musicAt({ segments, cues, fallback: compiled.fallbackPlaylist, tSec: t })) out.push(t);
  }
  return out;
}

describe('compilePlan', () => {
  const plan = planSoundtrack(ride, catalog, prefs());
  const byId = new Map(catalog.map((t) => [t.id, t]));

  it("puts one cue per section at its anchor, the section's songs in order", () => {
    const { cues, stale, skipped, missing } = compilePlan(plan, ride, { catalog });
    expect(stale).toBe(false);
    expect(skipped).toEqual([]);
    expect(missing).toEqual([]);
    expect(cues.map((c) => [c.blockId, c.rep])).toEqual(
      plan.sections.map((s) => [s.anchor.blockId, s.anchor.rep]),
    );
    cues.forEach((cue, i) => {
      const picks = plan.sections[i]!.picks;
      const run = [cue.track, ...(cue.queue ?? [])];
      expect(run.map((t) => t.id)).toEqual(picks.map((p) => p.upload));
      run.forEach((t, k) => {
        const song = byId.get(picks[k]!.ref.id)!;
        expect(t).toMatchObject({ provider: 'youtube', title: song.title, artist: song.artist });
        expect(t.bpm).toBe(song.bpm);
        // The other uploads stay its backups.
        expect(t.alternates?.map((a) => a.id).sort()).toEqual(
          song.youtube
            .map((u) => u.id)
            .filter((id) => id !== t.id)
            .sort(),
        );
      });
    });
  });

  it('keeps at most 8 backups per song and the queue within the schema', () => {
    const many = [song('m', 480, {}, 6)];
    const p = planSoundtrack(workout([steady('a', 480, 5, 90)]), many, prefs());
    const { cues } = compilePlan(p, ride, { catalog: many });
    expect(cues[0]!.track.alternates!.length).toBeLessThanOrEqual(8);
    expect(cues[0]!.queue).toBeUndefined();
  });

  it('plays the chosen upload first (rule R1), unless a music check found it dead', () => {
    const cat = [song('a', 120, {}, 1), song('b', 120)];
    cat[0]!.youtube.push({ id: uid(), durationSec: 175 });
    const one = workout([steady('x', 300, 5, 90)]);
    const p = planSoundtrack(one, cat, prefs());
    expect(p.sections[0]!.report.fills).toContain('longer');
    const longId = cat[0]!.youtube[1]!.id;
    const run = (c: ReturnType<typeof compilePlan>) => [
      c.cues[0]!.track,
      ...(c.cues[0]!.queue ?? []),
    ];
    const live = run(compilePlan(p, one, { catalog: cat }));
    const a = live.find((t) => t.title === 'Title a')!;
    expect(a.id).toBe(longId);
    expect(a.alternates?.map((t) => t.id)).toEqual([cat[0]!.youtube[0]!.id]);
    const dead = run(
      compilePlan(p, one, {
        catalog: cat,
        chain: { source: 'youtube', spotifyUsable: false, dead: new Set([`youtube:${longId}`]) },
      }),
    );
    expect(dead.find((t) => t.title === 'Title a')!.alternates!.at(-1)!.id).toBe(longId);
  });

  it('starts a repeated ending (rule R3) the same distance before the end of every upload', () => {
    const cat = [song('i', 280, { traits: ['instrumental'] })];
    const one = workout([steady('x', 300, 5, 90)]);
    const p = planSoundtrack(one, cat, prefs());
    expect(p.sections[0]!.report.fills).toEqual(['loop']);
    const { cues } = compilePlan(p, one, { catalog: cat });
    const loop = cues[0]!.queue![0]!;
    expect(loop.startAtSec).toBe(260);
    // Uploads of 284 s and 288 s start 20 s before their end too.
    expect(loop.alternates!.map((t) => t.startAtSec)).toEqual([264, 268]);
  });

  it("compiles the plan's fallback songs for the gaps (rule R4)", () => {
    const { fallbackPlaylist } = compilePlan(plan, ride, { catalog });
    expect(fallbackPlaylist.map((t) => t.title)).toEqual(['Title fb']);
  });

  it('skips sections whose anchor is gone and picks whose song is gone, and says so', () => {
    const changed = workout([steady('a', 480, 5, 90), steady('z', 360, 8, 65)]);
    const out = compilePlan(plan, changed, { catalog: catalog.filter((t) => t.id !== 'fb') });
    expect(out.stale).toBe(true);
    expect(out.skipped).toEqual([plan.sections[1]!.sectionId]);
    expect(out.cues).toHaveLength(1);
    expect(out.missing).toEqual(['fb']);
    expect(out.fallbackPlaylist).toEqual([]);
  });

  it('leaves locked sections to their own music', () => {
    const cooldownTrack: TrackRef = {
      provider: 'youtube',
      id: 'abcdefghijk',
      title: 'Own',
      startAtSec: 0,
    };
    const w = workout([steady('a', 480, 5, 90), steady('cd', 300, 2, 80)], {
      cooldownTrack,
      scaling: { warmupBlockId: 'a', cooldownBlockId: 'cd' },
    });
    const p = planSoundtrack(w, catalog, prefs());
    expect(p.sections.at(-1)!.locked).toBe('cooldownTrack');
    const { cues } = compilePlan(p, w, { catalog });
    expect(cues.some((c) => c.blockId === 'cd')).toBe(false);
  });

  it('"no gaps": no second without music outside the closing silence (spec §11.3)', () => {
    expect(holes(ride, plan, catalog)).toEqual([]);
    // Too little music for the time: the fallback song plays in what is left.
    const thin = [song('t', 200), catalog.at(-1)!];
    const long = workout([steady('a', 700, 5, 90)], { silenceLastSec: 30 });
    const p = planSoundtrack(long, thin, prefs());
    expect(p.sections[0]!.report.fills).toContain('fallback');
    expect(holes(long, p, thin)).toEqual([]);
    // With short gaps allowed there is no fallback, so the silence stays.
    const gaps = planSoundtrack(long, thin, prefs({ continuity: 'gapsOk' }));
    expect(holes(long, gaps, thin).length).toBeGreaterThan(0);
  });
});

describe('withSoundtrack', () => {
  const own: TrackRef = { provider: 'youtube', id: 'abcdefghijk', title: 'Own', startAtSec: 0 };

  it("lets the plan's cues win at the same block and repetition and keeps the others", () => {
    const plan = planSoundtrack(ride, catalog, prefs());
    const compiled = compilePlan(plan, ride, { catalog });
    const keep = { blockId: 'elsewhere', rep: 1, track: own };
    const replaced = { blockId: 'a', rep: 1, track: { ...own, id: 'zzzzzzzzzzz', title: 'Old' } };
    const w = workout([steady('a', 480, 5, 90), steady('b', 360, 8, 65)], {
      musicCues: [replaced, keep],
      fallbackPlaylist: [own],
    });
    const out = withSoundtrack(w, compiled);
    expect(out.musicCues).toContainEqual(keep);
    expect(out.musicCues).not.toContainEqual(replaced);
    expect(out.musicCues.filter((c) => c.blockId === 'a')).toHaveLength(1);
    expect(out.musicCues).toHaveLength(compiled.cues.length + 1);
    expect(out.fallbackPlaylist.map((t) => t.title)).toEqual(['Title fb', 'Own']);
    // The workout itself is untouched.
    expect(w.musicCues).toEqual([replaced, keep]);
    expect(w.fallbackPlaylist).toEqual([own]);
  });

  it('returns the workout itself when the plan has no music', () => {
    expect(withSoundtrack(ride, { cues: [], fallbackPlaylist: [] })).toBe(ride);
  });
});
