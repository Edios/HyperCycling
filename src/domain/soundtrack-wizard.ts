/**
 * Soundtrack Match ("Pick the music"), the wizard's logic (pure, no I/O; spec §4, §5.3, §7.6).
 * The screens only show what these functions return: which category chips to dim, what the plan
 * adds up to, and the plan after "Shuffle" or "Replace" with the locked parts kept.
 */
import {
  bestCategories,
  coverage,
  MUSIC_CATEGORIES,
  isMusicCategory,
  type CategoryCoverage,
  type MusicCategoryId,
  type MusicSection,
} from './soundtrack';
import type { CatalogTrack } from './soundtrack-catalog';
import type { OwnTrackRecord } from './soundtrack-own';
import {
  DEFAULT_SOUNDTRACK_PREFS,
  OWN_SHARES,
  planSoundtrack,
  type PlannedSection,
  type SoundtrackPlan,
  type SoundtrackPrefs,
} from './soundtrack-plan';
import type { Workout } from './workout';

// ---------------------------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------------------------

/**
 * What a first visit starts with (spec §4, step 1): Electronic and Pop, "no gaps", and the
 * "Polish" chip on (the owner's mix always had Polish songs; open question, 2026-11-24).
 */
export const FIRST_VISIT_PREFS: SoundtrackPrefs = {
  ...DEFAULT_SOUNDTRACK_PREFS,
  categories: ['electronic', 'pop'],
  polish: true,
  ownShare: 'half',
};

/** A workout shorter than this has nothing to plan (spec §7.7). */
export const MIN_WIZARD_SEC = 5 * 60;

/**
 * Preferences read from storage: anything missing or wrong falls back to the first-visit value,
 * so a damaged or older entry never breaks the wizard. At least one category stays.
 */
export function parseSoundtrackPrefs(raw: unknown): SoundtrackPrefs {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const cats = Array.isArray(o.categories)
    ? [...new Set(o.categories.filter(isMusicCategory))]
    : [];
  const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
  const seed =
    typeof o.seed === 'number' && Number.isInteger(o.seed) && o.seed >= 0 && o.seed < 2 ** 31
      ? o.seed
      : FIRST_VISIT_PREFS.seed;
  return {
    v: 1,
    categories: cats.length > 0 ? cats : [...FIRST_VISIT_PREFS.categories],
    includeLibrary: bool(o.includeLibrary, false),
    continuity: o.continuity === 'gapsOk' ? 'gapsOk' : 'seamless',
    explicit: bool(o.explicit, FIRST_VISIT_PREFS.explicit),
    allowHalfDouble: bool(o.allowHalfDouble, FIRST_VISIT_PREFS.allowHalfDouble),
    seed,
    polish: bool(o.polish, FIRST_VISIT_PREFS.polish === true),
    ownShare: OWN_SHARES.find((x) => x === o.ownShare) ?? 'half',
  };
}

/** The categories after a chip was pressed: the last one chosen cannot be switched off. */
export function toggleCategory(
  chosen: readonly MusicCategoryId[],
  category: MusicCategoryId,
): MusicCategoryId[] {
  if (!chosen.includes(category)) {
    return MUSIC_CATEGORIES.filter((c) => c === category || chosen.includes(c));
  }
  return chosen.length > 1 ? chosen.filter((c) => c !== category) : [...chosen];
}

/** Another seed for "Shuffle": a hash step, so neighbouring seeds do not shuffle alike. */
export function nextSeed(seed: number): number {
  return (Math.imul(seed >>> 0, 1664525) + 1013904223) & 0x7fffffff;
}

// ---------------------------------------------------------------------------------------------
// Step 1: chips and the hint
// ---------------------------------------------------------------------------------------------

export interface CategoryChip {
  category: MusicCategoryId;
  /** Songs of the category that fit the workout's tempo for at least half of it. */
  tracks: number;
  /** No such songs at this tempo: the chip is dimmed, never blocked. */
  dimmed: boolean;
}

/**
 * The chips of step 1. A chip is dimmed when its category has no song for this workout's tempo,
 * but never when that is true for every category: a workout that changes cadence a lot (climbs
 * and flats) must not grey out the whole row (owner, 2026-11-22).
 */
export function categoryChips(
  sections: readonly MusicSection[],
  catalog: readonly CatalogTrack[],
): { chips: CategoryChip[]; best: MusicCategoryId[] } {
  const cov: CategoryCoverage[] = coverage(
    sections,
    catalog.filter((t): t is CatalogTrack & { bpm: number } => t.bpm !== undefined),
  );
  const any = cov.some((c) => c.tracks > 0);
  return {
    chips: cov.map((c) => ({
      category: c.category,
      tracks: c.tracks,
      dimmed: any && c.tracks === 0,
    })),
    best: bestCategories(cov),
  };
}

// ---------------------------------------------------------------------------------------------
// Step 2 and 3: what the plan adds up to
// ---------------------------------------------------------------------------------------------

/** A part's songs came from other categories than the chosen ones. */
export function isStretched(s: PlannedSection): boolean {
  return s.report.relaxed.some((r) => r === 'category' || r === 'anyCategory' || r === 'polish');
}

/** A part's songs are off its tempo ("tempo does not fit"). */
export function isOffTempo(s: PlannedSection): boolean {
  return s.report.warn.includes('bpm');
}

export interface PlanSummary {
  /** Parts the planner worked on (locked ones with their own music are not counted). */
  parts: number;
  songs: number;
  /** Length of the whole workout, seconds. */
  durationSec: number;
  /** Silence the plan leaves, seconds: gaps longer than the seam, with nothing to fill them. */
  silenceSec: number;
  /** Parts with silence, with no songs, with songs from other categories, with off-tempo songs. */
  gapParts: number;
  emptyParts: number;
  stretchedParts: number;
  offTempoParts: number;
}

export function planSummary(plan: SoundtrackPlan): PlanSummary {
  let parts = 0;
  let songs = 0;
  let durationSec = 0;
  let silenceSec = 0;
  let gapParts = 0;
  let emptyParts = 0;
  let stretchedParts = 0;
  let offTempoParts = 0;
  for (const s of plan.sections) {
    durationSec += s.durationSec;
    if (s.locked) continue;
    parts++;
    songs += s.picks.length;
    if (s.report.warn.includes('none')) emptyParts++;
    if (s.report.warn.includes('gap')) {
      gapParts++;
      silenceSec += s.report.gapSec;
    }
    if (isStretched(s)) stretchedParts++;
    if (isOffTempo(s)) offTempoParts++;
  }
  return {
    parts,
    songs,
    durationSec,
    silenceSec,
    gapParts,
    emptyParts,
    stretchedParts,
    offTempoParts,
  };
}

// ---------------------------------------------------------------------------------------------
// Planning with the rider's choices
// ---------------------------------------------------------------------------------------------

/** What the rider decided on top of the preferences. */
export interface WizardChoices {
  /** Section ids that keep their songs when the plan is made again. */
  locked: ReadonlySet<string>;
  /** Songs the rider threw out ("Replace"): catalog ids. */
  excluded: ReadonlySet<string>;
}

export const NO_CHOICES: WizardChoices = { locked: new Set(), excluded: new Set() };

function lockedSections(plan: SoundtrackPlan | undefined, locked: ReadonlySet<string>) {
  const keep = new Map<string, PlannedSection>();
  if (!plan) return keep;
  for (const s of plan.sections) if (locked.has(s.sectionId)) keep.set(s.sectionId, s);
  return keep;
}

/**
 * The plan for the preferences and the choices: locked parts of `previous` keep their songs, the
 * rest is planned again.
 */
export function makePlan(
  workout: Workout,
  catalog: readonly CatalogTrack[],
  prefs: SoundtrackPrefs,
  choices: WizardChoices = NO_CHOICES,
  previous?: SoundtrackPlan,
  sections?: readonly MusicSection[],
  history?: readonly (readonly string[])[],
): SoundtrackPlan {
  return planSoundtrack(workout, catalog, prefs, {
    ...(sections ? { sections } : {}),
    ...(history ? { history } : {}),
    exclude: choices.excluded,
    keep: lockedSections(previous, choices.locked),
  });
}

/**
 * "Shuffle": another seed, and the songs of the plan on screen count as the newest ride before
 * the remembered ones (`history`, spec §3a), so the unlocked parts get other songs while each
 * still asks for its energy. A small seeded jitter alone rarely changes a plan whose songs fit
 * clearly better than the rest.
 */
export function shufflePlan(
  workout: Workout,
  catalog: readonly CatalogTrack[],
  prefs: SoundtrackPrefs,
  choices: WizardChoices,
  plan: SoundtrackPlan,
  sections?: readonly MusicSection[],
  history: readonly (readonly string[])[] = [],
): { plan: SoundtrackPlan; prefs: SoundtrackPrefs } {
  const next = { ...prefs, seed: nextSeed(prefs.seed) };
  const shown = plan.sections
    .filter((s) => !choices.locked.has(s.sectionId))
    .flatMap((s) => s.picks.map((p) => p.ref.id));
  return {
    plan: makePlan(workout, catalog, next, choices, plan, sections, [shown, ...history]),
    prefs: next,
  };
}

/**
 * "Replace": the song goes to the excluded list and only its part is planned again; every other
 * part keeps what it has. Returns the new plan and the new excluded list.
 */
export function replaceSong(
  workout: Workout,
  catalog: readonly CatalogTrack[],
  prefs: SoundtrackPrefs,
  choices: WizardChoices,
  plan: SoundtrackPlan,
  sectionId: string,
  songId: string,
  sections?: readonly MusicSection[],
  history?: readonly (readonly string[])[],
): { plan: SoundtrackPlan; excluded: Set<string> } {
  const excluded = new Set(choices.excluded).add(songId);
  const keepAllButOne = new Set(
    plan.sections.filter((s) => s.sectionId !== sectionId).map((s) => s.sectionId),
  );
  const next = makePlan(
    workout,
    catalog,
    prefs,
    { locked: keepAllButOne, excluded },
    plan,
    sections,
    history,
  );
  return { plan: next, excluded };
}

/**
 * What the plan on screen was made for: another key in step 1 plans again. The own songs count by
 * what the planner reads of them (video, tempo, energy, length, start), so a song removed and added
 * again with a corrected tempo gives a new plan even though the count stays (#153 B1). They count
 * only while "use my songs" is on and there are some.
 */
export function wizardPlanKey(prefs: SoundtrackPrefs, own: readonly OwnTrackRecord[]): string {
  const mine =
    prefs.includeLibrary && own.length > 0
      ? own
          .map(
            (t) =>
              `${t.youtubeId}:${t.bpm}:${t.energy ?? ''}:${t.durationSec ?? ''}:${t.startSec ?? ''}`,
          )
          .join(',')
      : '';
  const share = mine === '' ? '' : (prefs.ownShare ?? 'half');
  return `${prefs.categories.join(',')}|${prefs.polish === true ? 'pl' : ''}|${prefs.continuity}|${share}|${mine}`;
}
