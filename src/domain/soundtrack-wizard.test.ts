import { describe, expect, it } from 'vitest';
import { builtinWorkouts } from '../client/data/builtin';
import { sectionsOf, type MusicCategoryId } from './soundtrack';
import { parseCatalog, type CatalogTrack } from './soundtrack-catalog';
import { DEFAULT_SOUNDTRACK_PREFS, planSoundtrack, type SoundtrackPlan } from './soundtrack-plan';
import {
  categoryChips,
  FIRST_VISIT_PREFS,
  isOffTempo,
  isStretched,
  makePlan,
  NO_CHOICES,
  nextSeed,
  parseSoundtrackPrefs,
  planSummary,
  replaceSong,
  shufflePlan,
  toggleCategory,
} from './soundtrack-wizard';
import raw from '../content/soundtrack/catalog.json';

const catalog: CatalogTrack[] = parseCatalog(raw).tracks;
const workout = (id: string) => {
  const w = builtinWorkouts.find((x) => x.id === id);
  if (!w) throw new Error(id);
  return w;
};
const ids = (p: SoundtrackPlan) => p.sections.flatMap((s) => s.picks.map((x) => x.ref.id));

describe('parseSoundtrackPrefs', () => {
  it('starts a first visit on Electronic and Pop with "no gaps"', () => {
    expect(parseSoundtrackPrefs(undefined)).toEqual(FIRST_VISIT_PREFS);
    expect(FIRST_VISIT_PREFS).toMatchObject({
      categories: ['electronic', 'pop'],
      continuity: 'seamless',
      explicit: false,
      allowHalfDouble: true,
      polish: true,
    });
  });

  it('keeps the "Polish" chip as stored, and turns it on for an entry saved before the chip', () => {
    expect(parseSoundtrackPrefs({ categories: ['rock'], polish: false }).polish).toBe(false);
    expect(parseSoundtrackPrefs({ categories: ['rock'], polish: true }).polish).toBe(true);
    expect(parseSoundtrackPrefs({ categories: ['rock'] }).polish).toBe(true);
    expect(parseSoundtrackPrefs({ categories: ['rock'], polish: 'yes' }).polish).toBe(true);
  });

  it('keeps what a good entry says', () => {
    const p = parseSoundtrackPrefs({
      v: 1,
      categories: ['rock', 'house'],
      continuity: 'gapsOk',
      explicit: true,
      allowHalfDouble: false,
      seed: 42,
    });
    expect(p).toMatchObject({
      categories: ['rock', 'house'],
      continuity: 'gapsOk',
      explicit: true,
      allowHalfDouble: false,
      seed: 42,
    });
  });

  it('falls back field by field on a damaged entry, and keeps at least one category', () => {
    const p = parseSoundtrackPrefs({
      categories: ['jazz', 3, 'pop', 'pop'],
      continuity: 'whenever',
      explicit: 'yes',
      seed: -4,
    });
    expect(p.categories).toEqual(['pop']);
    expect(p.continuity).toBe('seamless');
    expect(p.explicit).toBe(false);
    expect(p.seed).toBe(FIRST_VISIT_PREFS.seed);
    expect(parseSoundtrackPrefs({ categories: [] }).categories).toEqual(['electronic', 'pop']);
    expect(parseSoundtrackPrefs('nope')).toEqual(FIRST_VISIT_PREFS);
    expect(parseSoundtrackPrefs({ seed: 2 ** 40 }).seed).toBe(FIRST_VISIT_PREFS.seed);
  });

  it('remembers "use my songs" (PR 6), off on a first visit or a broken value', () => {
    expect(parseSoundtrackPrefs({ includeLibrary: true }).includeLibrary).toBe(true);
    expect(parseSoundtrackPrefs({ includeLibrary: 'yes' }).includeLibrary).toBe(false);
    expect(parseSoundtrackPrefs({}).includeLibrary).toBe(false);
  });
});

describe('toggleCategory and nextSeed', () => {
  it('adds in the catalog order, removes, and keeps the last one', () => {
    expect(toggleCategory(['pop'], 'electronic')).toEqual(['electronic', 'pop']);
    expect(toggleCategory(['electronic', 'pop'], 'pop')).toEqual(['electronic']);
    expect(toggleCategory(['electronic'], 'electronic')).toEqual(['electronic']);
  });

  it('gives another seed every time, in range, deterministically', () => {
    const seeds = new Set<number>();
    let s = 1;
    for (let i = 0; i < 50; i++) {
      s = nextSeed(s);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(2 ** 31);
      seeds.add(s);
    }
    expect(seeds.size).toBe(50);
    expect(nextSeed(1)).toBe(nextSeed(1));
  });
});

describe('categoryChips', () => {
  it('dims the categories without songs at this tempo, never blocks them', () => {
    const { chips, best } = categoryChips(sectionsOf(workout('zone2-60')), catalog);
    expect(chips.map((c) => c.category)).toHaveLength(8);
    const by = Object.fromEntries(chips.map((c) => [c.category, c]));
    expect(by.electronic?.dimmed).toBe(false);
    expect(by.house?.tracks).toBe(0);
    expect(by.house?.dimmed).toBe(true);
    expect(best).toContain('electronic');
  });

  it('does not dim a single chip of a workout that changes cadence a lot (owner, 2026-11-22)', () => {
    for (const id of ['class-neon-grid-45', 'big-gear-ladder', 'demo-mixed']) {
      const { chips, best } = categoryChips(sectionsOf(workout(id)), catalog);
      expect(chips.filter((c) => c.tracks > 0).length, id).toBeGreaterThan(0);
      expect(best.length, id).toBeGreaterThan(0);
    }
  });

  it('dims nothing when no category has a song at all', () => {
    const { chips, best } = categoryChips(sectionsOf(workout('zone2-60')), []);
    expect(chips.every((c) => !c.dimmed && c.tracks === 0)).toBe(true);
    expect(best).toEqual([]);
  });

  it('never dims every chip on any built-in workout', () => {
    for (const w of builtinWorkouts) {
      const { chips } = categoryChips(sectionsOf(w), catalog);
      expect(
        chips.some((c) => !c.dimmed),
        w.id,
      ).toBe(true);
    }
  });

  it('ignores songs without a beat (they have no tempo to count)', () => {
    const beatless = catalog.filter((t) => t.beat === 'none');
    expect(beatless.length).toBeGreaterThan(0);
    const { chips } = categoryChips(sectionsOf(workout('zone2-60')), beatless);
    // Only the cool-down counts for a song with no beat, which is short of half the ride.
    expect(chips.every((c) => c.tracks === 0)).toBe(true);
  });
});

describe('planSummary', () => {
  const prefs = { ...FIRST_VISIT_PREFS, categories: ['electronic', 'rock'] as MusicCategoryId[] };
  const plan = planSoundtrack(workout('class-endurance-45'), catalog, prefs);

  it('counts parts, songs and time, and finds no silence in a good plan', () => {
    const s = planSummary(plan);
    expect(s.parts).toBe(plan.sections.length);
    expect(s.songs).toBe(plan.sections.reduce((n, x) => n + x.picks.length, 0));
    expect(s.durationSec).toBe(plan.sections.reduce((n, x) => n + x.durationSec, 0));
    expect(s).toMatchObject({ silenceSec: 0, gapParts: 0, emptyParts: 0, offTempoParts: 0 });
  });

  it('reports songs from other categories and the silence honestly', () => {
    const only = planSoundtrack(workout('zone2-60'), catalog, { ...prefs, categories: ['house'] });
    const stretched = planSummary(only);
    expect(stretched.stretchedParts).toBeGreaterThan(0);
    expect(only.sections.some(isStretched)).toBe(true);
    expect(only.sections.some(isOffTempo)).toBe(false);
    const none = planSummary(
      planSoundtrack(workout('zone2-60'), [], { ...prefs, continuity: 'gapsOk' }),
    );
    expect(none.emptyParts).toBe(none.parts);
    expect(none.gapParts).toBe(none.parts);
    expect(none.silenceSec).toBe(none.durationSec);
    expect(none.songs).toBe(0);
  });

  it('leaves parts that keep their own music out of the count', () => {
    const w = {
      ...workout('class-endurance-45'),
      cooldownTrack: { provider: 'youtube', id: 'abcdefghijk', title: 'Own', startAtSec: 0 },
    } as ReturnType<typeof workout>;
    const p = planSoundtrack(w, catalog, prefs);
    const s = planSummary(p);
    expect(s.parts).toBe(p.sections.length - 1);
    expect(s.durationSec).toBe(planSummary(plan).durationSec);
  });
});

describe('makePlan and replaceSong', () => {
  const w = workout('class-endurance-45');
  const prefs = { ...FIRST_VISIT_PREFS, categories: ['electronic', 'rock'] as MusicCategoryId[] };
  const first = makePlan(w, catalog, prefs);

  it('is the planner without choices', () => {
    expect(first).toEqual(planSoundtrack(w, catalog, prefs));
    expect(makePlan(w, catalog, prefs, NO_CHOICES, first)).toEqual(first);
  });

  it('shuffles with another seed and keeps the locked parts as they are', () => {
    const locked = new Set([first.sections[1]!.sectionId, first.sections[3]!.sectionId]);
    const out = shufflePlan(w, catalog, prefs, { locked, excluded: new Set() }, first);
    expect(out.prefs.seed).toBe(nextSeed(prefs.seed));
    const shuffled = out.plan;
    expect(shuffled.sections[1]).toEqual(first.sections[1]);
    expect(shuffled.sections[3]).toEqual(first.sections[3]);
    expect(ids(shuffled)).not.toEqual(ids(first));
    const all = ids(shuffled);
    expect(new Set(all).size).toBe(all.length);
  });

  it('replaces one song: only its part changes, and the song never comes back', () => {
    const section = first.sections[2]!;
    const song = section.picks[0]!.ref.id;
    const { plan, excluded } = replaceSong(
      w,
      catalog,
      prefs,
      NO_CHOICES,
      first,
      section.sectionId,
      song,
    );
    expect([...excluded]).toEqual([song]);
    plan.sections.forEach((s, i) => {
      if (i !== 2) expect(s).toEqual(first.sections[i]);
    });
    expect(plan.sections[2]!.picks.map((p) => p.ref.id)).not.toContain(song);
    expect(plan.sections[2]!.picks.length).toBeGreaterThan(0);
    expect(plan.sections[2]!.report.gapSec).toBeLessThanOrEqual(10);
    // Replacing again keeps the earlier one out too, and the plan keeps no song twice.
    const second = replaceSong(
      w,
      catalog,
      prefs,
      { locked: new Set(), excluded },
      plan,
      section.sectionId,
      plan.sections[2]!.picks[0]!.ref.id,
    );
    expect(second.excluded.size).toBe(2);
    const all = ids(second.plan);
    expect(new Set(all).size).toBe(all.length);
    for (const gone of second.excluded) expect(all).not.toContain(gone);
  });

  it('plays no song twice after lock, shuffle and replace on a ride of many stretches', () => {
    // The sequence of a real session: a replace in a stretch that comes before a locked one.
    const climbs = workout('music-climbs');
    const p = { ...prefs, categories: ['electronic', 'pop', 'rock'] as MusicCategoryId[] };
    const base = makePlan(climbs, catalog, p);
    let plan = base;
    let seed = p.seed;
    let excluded = new Set<string>();
    for (let round = 0; round < 6; round++) {
      const locked = new Set([plan.sections[(round + 1) % plan.sections.length]!.sectionId]);
      seed = nextSeed(seed);
      plan = makePlan(climbs, catalog, { ...p, seed }, { locked, excluded }, plan);
      const target = plan.sections[(round + 2) % plan.sections.length]!;
      const out = replaceSong(
        climbs,
        catalog,
        { ...p, seed },
        { locked, excluded },
        plan,
        target.sectionId,
        target.picks[0]!.ref.id,
      );
      plan = out.plan;
      excluded = out.excluded;
      // A repeated ending (R3) plays the same song twice on purpose: once per stretch counts.
      const ids = plan.sections.flatMap((s) => [...new Set(s.picks.map((x) => x.ref.id))]);
      expect(new Set(ids).size, `round ${round}`).toBe(ids.length);
    }
  });

  it('keeps every plan within the budget the wizard needs (a few ms)', () => {
    makePlan(w, catalog, prefs);
    const t0 = performance.now();
    makePlan(w, catalog, prefs, NO_CHOICES, first);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});

describe('the wizard on the built-in workouts', () => {
  it('gives every workout of 5 minutes or more a plan for the first-visit preferences', () => {
    for (const w of builtinWorkouts) {
      const p = makePlan(w, catalog, FIRST_VISIT_PREFS);
      const s = planSummary(p);
      expect(s.emptyParts, w.id).toBe(0);
      expect(s.silenceSec, w.id).toBe(0);
    }
  });

  it('default preferences plan the same as the first-visit ones with no category chosen', () => {
    const w = workout('music-climbs');
    // The same songs; the plan keeps its own copy of the chip (off).
    expect(
      makePlan(w, catalog, { ...FIRST_VISIT_PREFS, categories: [], polish: false }).sections,
    ).toEqual(planSoundtrack(w, catalog, { ...DEFAULT_SOUNDTRACK_PREFS, categories: [] }).sections);
  });
});
