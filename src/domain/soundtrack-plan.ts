/**
 * Soundtrack Match ("Pick the music"), part 3: the planner (pure logic, soundtrack spec §7.2-7.4).
 *
 * For every open section of a workout (`sectionsOf`) the planner picks a short queue of catalog
 * songs that fits the section's cadence (2 BPM = 1 RPM; half and double time too), effort and
 * role, in the categories the rider chose, and that fills the section's time:
 *
 * 1. Candidates (`scoreTrack`): tempo fit, energy fit, role fit, category fit. Hard rules: a song
 *    without a beat only in the cool-down; a sprint song (ridden at 105 rpm or faster) only in hard
 *    and peak sections; nothing explicit in the cool-down, nor anywhere unless the rider allows it;
 *    no song twice in a ride; no energy 5 in the warm-up, nothing 3 steps calmer than a hard part
 *    asks for or 3 steps stronger than a calm one, nothing light (energy 1-2) on a climb (music
 *    energy spec §2b). Songs of the last rides cost a little (`history`, spec §3a), and a small
 *    seeded jitter reorders near-equal songs ("Shuffle").
 * 2. Relaxation ladder, when the songs cannot fill a section (too few, or no queue that ends
 *    within the tolerances): a wider tempo window, the neighbour categories, any category (the
 *    owner accepts stretching the categories for a mixed cadence), and at last any tempo (with a
 *    warning). Each step taken costs a little and is reported.
 * 3. Queue (`buildQueue`): a beam search for the songs whose time-weighted fit is best and whose
 *    length ends closest to the end of the section (the last song may be cut by up to 45 s),
 *    repaired by an exact length search when the beam misses. A long section simply gets more
 *    songs (a block is never split). Synthwave and drum and bass are an add-on: one per section
 *    at most, and each one in the ride makes the next one less likely.
 * 4. Polish songs are a chip of their own ("Polish", `prefs.polish`): with it on, a Polish song of
 *    another kind of music fits like a neighbour category (`NEIGHBOUR_FIT`), so it joins the mix
 *    without pushing the chosen kinds out (the old rule of one Polish song in every ride is gone,
 *    owner's decision of 2026-11-22).
 * 5. Gaps (`fillSlotGap`, rules R1-R4): a longer upload, a reserve song, the instrumental ending
 *    again, then the long fallback songs (only with "no gaps").
 *
 * Deterministic for (workout sections, catalog, prefs): no clock, no `Math.random`, ties broken by
 * the song id (the catalog's order does not matter). Runs before a ride (wizard, editor), never
 * inside the session engine; about 1-4 ms per workout on the shipped catalog.
 */
import {
  BAND_HIGH,
  BAND_LOW,
  BPM_CLOSE,
  BPM_RELAXED,
  matchBpm,
  nearestKind,
  type MatchKind,
} from './bpm-match';
import { zoneForEffort } from './hr-zones';
import { youtubeTrack } from './music-chain';
import { fillSlotGap, MAX_CUT_SEC, type GapRule } from './music-gaps';
import { flattenWorkout } from './segments';
import { SLOT_TOLERANCE_SEC, songKey } from './slot-plan';
import {
  MUSIC_CATEGORIES,
  sectionsOf,
  trendEnergyAt,
  type SectionTrend,
  type BlockRef,
  type MusicCategoryId,
  type MusicSection,
  type SectionLock,
  type SectionRole,
} from './soundtrack';
import {
  catalogRpm,
  ROLE_SPRINT_RPM,
  type CatalogTrack,
  type TrackMood,
  type TrackRole,
} from './soundtrack-catalog';
import { MAX_QUEUE, type TrackRef, type Workout } from './workout';

// ---------------------------------------------------------------------------------------------
// Preferences and plan
// ---------------------------------------------------------------------------------------------

/** What the rider picks in the wizard (spec §5.3). */
export interface SoundtrackPrefs {
  v: 1;
  /** Kinds of music; empty = any. */
  categories: MusicCategoryId[];
  /** The rider's own songs too (library, PR 6); not used by the catalog planner yet. */
  includeLibrary: boolean;
  /** 'seamless' = no silence: gaps are filled down to the fallback; 'gapsOk' = short gaps stay. */
  continuity: 'seamless' | 'gapsOk';
  /** Explicit versions allowed (never in the cool-down). */
  explicit: boolean;
  /** Songs at half or double the tempo count. */
  allowHalfDouble: boolean;
  /** "Shuffle": another seed gives another order of near-equal songs. */
  seed: number;
  /**
   * The "Polish" chip: a Polish song of a kind of music that was not chosen fits like a neighbour
   * category (`NEIGHBOUR_FIT`), from the first step of the ladder. Absent = off (plans saved
   * before the chip).
   */
  polish?: boolean;
  /**
   * "How many of my songs" next to "Use my songs" (owner's decision of 2026-11-26): how strongly
   * an own song is preferred where its tempo fits (`OWN_SHARE_BONUS`). Absent = 'half', the bonus
   * own songs always had.
   */
  ownShare?: OwnShare;
}

/** The levels of "How many of my songs": few, half and half, mostly mine. */
export const OWN_SHARES = ['few', 'half', 'most'] as const;
export type OwnShare = (typeof OWN_SHARES)[number];

export const DEFAULT_SOUNDTRACK_PREFS: SoundtrackPrefs = {
  v: 1,
  categories: [],
  includeLibrary: false,
  continuity: 'seamless',
  explicit: false,
  allowHalfDouble: true,
  seed: 1,
};

/** How a picked song relates to its section's cadence. */
export type PickFit = 'on-beat' | 'close' | 'half' | 'double' | 'off' | 'nobeat';

/** One song of a section's queue. */
export interface PlanPick {
  /** 'own' = a song the rider added (PR 6); its id starts with `own-`. */
  ref: { kind: 'catalog' | 'own'; id: string };
  /** The YouTube upload to play first (the others stay its backups). */
  upload: string;
  /** Where playback starts in the song, seconds (above 0 only for a repeated ending, rule R3). */
  startAtSec: number;
  /** When the song starts, seconds from the start of its section. */
  atSec: number;
  /** How long it plays in the section, seconds (the last one may be cut at the boundary). */
  playSec: number;
  fit: PickFit;
}

/**
 * A step of the relaxation ladder. 'polish' (a Polish song outside the categories) is no longer
 * planned; it stays readable in plans saved before the "Polish" chip.
 */
export type Relaxation = 'tolerance' | 'category' | 'anyCategory' | 'bpm' | 'polish';

/** 'none' = no song at all; 'bpm' = songs off the tempo; 'gap' = silence left; 'cut' = cut > 45 s. */
export type SectionWarning = 'none' | 'bpm' | 'gap' | 'cut';

export interface SectionReport {
  /** Time the songs leave free after the gap rules (the fallback plays there when it can). */
  gapSec: number;
  /** How much of the last song the boundary cuts off. */
  cutSec: number;
  relaxed: Relaxation[];
  warn: SectionWarning[];
  /** Gap rules that were applied, in order. */
  fills: GapRule[];
}

export interface PlannedSection {
  sectionId: string;
  anchor: BlockRef;
  startSec: number;
  durationSec: number;
  role: SectionRole;
  rpm: number;
  /** Locked sections keep their music: no picks. */
  locked?: SectionLock;
  picks: PlanPick[];
  report: SectionReport;
}

/** The plan the rider confirms (a snapshot: a later catalog does not change it, spec §5.5). */
export interface SoundtrackPlan {
  v: 1;
  workoutId: string;
  /** Short hash of the workout's blocks (ids, repetitions, lengths): a changed workout differs. */
  fingerprint: string;
  prefs: SoundtrackPrefs;
  sections: PlannedSection[];
  /** Long, calm songs that play wherever the queues leave silence (rule R4); 'seamless' only. */
  fallback: PlanPick[];
}

// ---------------------------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------------------------

/**
 * Weights of the fit (spec §7.2 plus the role, which the catalog has since PR 2). Tests hold the
 * order of preference, not these numbers.
 */
export const WEIGHTS = {
  bpm: 0.4,
  energy: 0.3,
  role: 0.15,
  category: 0.1,
  trust: 0.05,
} as const;

/**
 * In short hard intervals and at the peak the song's energy counts more than its tempo (spec §9 A,
 * D): the work phases are too short to lock the cadence to the beat (literature #10, #13), while
 * energetic music lifts power from the first repetition. A soft shift of `DRIVE_SHIFT` from the
 * tempo to the energy weight; the sum stays 1.
 */
export const DRIVE_SHIFT = 0.1;

/** Tempo and energy weights of a part: `WEIGHTS`, shifted towards energy in intervals and peaks. */
export function fitWeights(s: Pick<MusicSection, 'profile' | 'role'>): {
  bpm: number;
  energy: number;
} {
  const drive = s.profile === 'intervals' || s.role === 'peak' ? DRIVE_SHIFT : 0;
  return { bpm: WEIGHTS.bpm - drive, energy: WEIGHTS.energy + drive };
}

/**
 * Added to an own song's score (PR 6): the rider picked it, so where it fits as well as a catalog
 * song it wins. It never makes a song fit that does not (the hard rules and the tempo stay).
 */
export const OWN_BONUS = 0.1;
/**
 * The own-song bonus of each "How many of my songs" level. Measured with ten own songs at tempos
 * of 86-94 rpm on the 116 built-in workouts (first-visit kinds of music), as the share of the
 * picks where an own song not yet played fits the tempo: 'few' about 13%, 'half' (today's bonus)
 * about 54%, 'most' about 77% (one play per song and ride caps it near 78%). A negative bonus only
 * lets a catalog song win the near-ties: an own song still plays where the catalog has nothing
 * as good.
 */
export const OWN_SHARE_BONUS: Readonly<Record<OwnShare, number>> = {
  few: -0.2,
  half: OWN_BONUS,
  most: 0.5,
};

/** The bonus an own song gets with these preferences. */
export function ownBonus(prefs: Pick<SoundtrackPrefs, 'ownShare'>): number {
  return OWN_SHARE_BONUS[prefs.ownShare ?? 'half'];
}

/** Category fit of a song from a neighbour category, and from any category (relaxed). */
export const NEIGHBOUR_FIT = 0.7;
export const ANY_CATEGORY_FIT = 0.5;
/**
 * Seeded jitter added to every score: reorders near-equal songs, never a clearly better one (small
 * enough not to cover one step of energy, spec §2b).
 */
export const SHUFFLE_JITTER = 0.08;
/**
 * In a part of short hard intervals, a song without the intervals role or with a long intro (the
 * drop must come with the first repetition) costs this much (spec §2a).
 */
export const INTERVAL_MISFIT = 0.3;
/**
 * Energy fit per step of difference (song minus section, spec §2b). A hard part: a calmer song
 * costs `ENERGY_STEP_WRONG` a step, a stronger one `ENERGY_STEP_RIGHT`; a calm part the other way
 * round; any other part `ENERGY_STEP` either way, with no free window.
 */
export const ENERGY_STEP_WRONG = 0.35;
export const ENERGY_STEP_RIGHT = 0.1;
export const ENERGY_STEP = 0.2;
/** A section is a climb when its cadence is this low (a slow, heavy gear). */
export const CLIMB_RPM = 75;
/**
 * A light song (energy 1-2) in the work costs this much (literature, spec §9 C: slow music is
 * preferred at no intensity). A penalty, not a ban: with today's catalog a ban pushed the few
 * energetic songs at 85-100 rpm (Maanam, Margaret) into most rides; the history can still rotate
 * a light song in when the strong ones were just played.
 */
export const SLOW_WORK_PENALTY = 0.3;

/**
 * Comfort band of song tempos (literature, spec §9 B): 120-140 BPM; work in zone 4 and up
 * tolerates up to 160, a climb up to 150 (§9 E). A song inside it gets `BAND_BONUS`, and the
 * relation (2x, 1:1 or 4x the cadence) whose tempo is nearest it is the one scored in full.
 */
export const BAND_HIGH_HARD = 160;
export const BAND_HIGH_CLIMB = 150;
export { BAND_HIGH, BAND_LOW };
export const BAND_BONUS = 0.05;
/** Work from this HR zone up tolerates the faster band. */
const BAND_HARD_ZONE = 4;
/** A ladder step needs at least this many candidates to stop the walk (spec §7.2: "< 3"). */
export const MIN_CANDIDATES = 3;
/** Most songs the beam compares per step (the best ones). */
const BEAM_POOL = 40;
const BEAM_WIDTH = 6;
/** A section's cue plays its track plus a queue of at most `MAX_QUEUE`. */
export const MAX_PICKS = MAX_QUEUE + 1;
/** Seam between two songs of a section: a jump of the ridden cadence above this share costs. */
const SEAM_JUMP = 0.08;
/** "Short gaps are fine": a gap up to this long stays (with a warning only past `SLOT_TOLERANCE_SEC`). */
export const GAPS_OK_SEC = 30;

/** Categories close enough to stand in for each other (spec §7.2 ladder, step 3). */
export const NEIGHBOUR_CATEGORIES: Readonly<Record<MusicCategoryId, readonly MusicCategoryId[]>> = {
  electronic: ['house'],
  house: ['electronic'],
  pop: ['classics', 'latino'],
  classics: ['pop', 'rock'],
  rock: ['classics'],
  hiphop: ['lofi'],
  lofi: ['hiphop'],
  latino: ['pop'],
};

type RoleRow = Readonly<Record<TrackRole, number>>;

/**
 * How well a song's role suits a section (rows: what the section is). `finisher` is a mark on top
 * of the real roles and is not read yet (0 everywhere, so it never changes the best role).
 */
const ROLE_FIT: Readonly<Record<SectionRole | 'climb', RoleRow>> = {
  warmup: { warmup: 1, steady: 0.8, cooldown: 0.6, climb: 0.5, intervals: 0.3, finisher: 0 },
  steady: { steady: 1, warmup: 0.8, climb: 0.8, intervals: 0.4, cooldown: 0.4, finisher: 0 },
  climb: { climb: 1, steady: 0.8, intervals: 0.6, warmup: 0.4, cooldown: 0.2, finisher: 0 },
  tempo: { steady: 1, intervals: 0.8, climb: 0.7, warmup: 0.5, cooldown: 0.2, finisher: 0 },
  hard: { intervals: 1, steady: 0.7, climb: 0.7, warmup: 0.3, cooldown: 0.1, finisher: 0 },
  peak: { intervals: 1, steady: 0.5, climb: 0.5, warmup: 0.2, cooldown: 0, finisher: 0 },
  cooldown: { cooldown: 1, warmup: 0.6, steady: 0.3, climb: 0.2, intervals: 0, finisher: 0 },
};

/**
 * Soft weights of the groove and mood tags (spec §8-9). Both are centred: a song without the tag,
 * or one at the neutral value, scores as before. Small on purpose: under one step of energy
 * (`ENERGY_STEP` x `WEIGHTS.energy` = 0.06) and about the size of the shuffle jitter.
 */
export const GROOVE_WEIGHT = 0.06;
export const MOOD_WEIGHT = 0.04;

/** The groove (1 loose - 3 locked beat) a part wants: locked in the work, loose in the calm ends. */
function wantedGroove(s: MusicSection): 1 | 2 | 3 {
  if (s.role === 'warmup' || s.role === 'cooldown') return 1;
  return workPart(s) || climbPart(s) || hardPart(s) ? 3 : 2;
}

/** Groove term -GROOVE_WEIGHT/2..+GROOVE_WEIGHT/2; 0 for a song without groove or at the middle. */
function grooveTerm(t: CatalogTrack, s: MusicSection): number {
  if (t.groove === undefined) return 0;
  const fit = 1 - Math.abs(t.groove - wantedGroove(s)) / 2; // 0..1
  const centre = 1 - Math.abs(2 - wantedGroove(s)) / 2; // the fit of a middle groove
  return GROOVE_WEIGHT * (fit - centre);
}

/** How well a mood suits a kind of part, 0..1 (rows: part; spec §9 gives no research, taste only). */
const MOOD_FIT: Readonly<Record<SectionRole | 'climb', Readonly<Record<TrackMood, number>>>> = {
  warmup: { mellow: 1, warm: 1, playful: 0.7, euphoric: 0.4, dark: 0.3, aggressive: 0 },
  steady: { warm: 1, playful: 0.8, euphoric: 0.8, dark: 0.6, aggressive: 0.5, mellow: 0.4 },
  tempo: { warm: 1, euphoric: 0.9, playful: 0.7, dark: 0.7, aggressive: 0.6, mellow: 0.3 },
  climb: { dark: 1, euphoric: 0.8, aggressive: 0.7, warm: 0.6, playful: 0.4, mellow: 0.2 },
  hard: { aggressive: 1, euphoric: 1, dark: 0.8, playful: 0.5, warm: 0.4, mellow: 0 },
  peak: { aggressive: 1, euphoric: 1, dark: 0.8, playful: 0.5, warm: 0.4, mellow: 0 },
  cooldown: { mellow: 1, warm: 0.9, playful: 0.5, euphoric: 0.3, dark: 0.3, aggressive: 0 },
};

/** Mood term, centred on 0.6 (a typical fit); 0 for a song without mood. */
function moodTerm(t: CatalogTrack, s: MusicSection): number {
  if (t.mood === undefined) return 0;
  const row = climbPart(s) ? 'climb' : s.role;
  return MOOD_WEIGHT * (MOOD_FIT[row][t.mood] - 0.6);
}

export interface ScoreOptions {
  /** Tempo window (default `BPM_CLOSE`). */
  tolerance?: number;
  /** Half/double time counts (default true). */
  halfDouble?: boolean;
  /** Any tempo counts, at no tempo score (last step of the ladder). */
  ignoreBpm?: boolean;
  /** Category fit, 0..1 (default 1: one of the chosen categories). */
  categoryFit?: number;
}

export interface TrackScore {
  /** 0..1 (before the shuffle jitter). */
  score: number;
  fit: PickFit;
  /** Cadence the song is ridden at in this section (its BPM over the match), when on a beat. */
  rideRpm?: number;
}

const MULTIPLIER = { exact: 2, half: 1, double: 4 } as const;

function roleFit(t: CatalogTrack, s: MusicSection): number {
  const row = ROLE_FIT[s.role];
  const climbs = s.role !== 'warmup' && s.role !== 'cooldown' && s.rpmMean <= CLIMB_RPM;
  let best = 0;
  for (const r of t.roles) {
    const v = climbs ? Math.max(row[r], ROLE_FIT.climb[r]) : row[r];
    if (v > best) best = v;
  }
  return best;
}

/** A sprint song (owner's rule): ridden at `ROLE_SPRINT_RPM` or faster. */
function sprintSong(t: CatalogTrack): boolean {
  return t.bpm !== undefined && catalogRpm(t.bpm) >= ROLE_SPRINT_RPM;
}

/** A part that wants drive: short hard intervals, a hard or a peak part. */
function hardPart(s: MusicSection): boolean {
  return s.profile === 'intervals' || s.role === 'hard' || s.role === 'peak';
}

/** A part that wants calm: the warm-up, the cool-down, or a part asking for energy 1-2. */
function calmPart(s: MusicSection): boolean {
  return s.role === 'warmup' || s.role === 'cooldown' || s.energy <= 2;
}

/** A seated or standing climb: a slow, heavy cadence at a real effort (not the warm-up). */
function climbPart(s: MusicSection): boolean {
  return !calmPart(s) && s.rpmMean <= CLIMB_RPM && s.workEffort >= 5;
}

/** A part of the work: not the warm-up or the cool-down, and asking for energy 3 or more. */
function workPart(s: MusicSection): boolean {
  return s.role !== 'warmup' && s.role !== 'cooldown' && s.energy >= 3;
}

/** The song tempos comfortable in a part (spec §9 B, E). */
export function comfortBand(s: MusicSection): [number, number] {
  if (hardPart(s) || zoneForEffort(s.workEffort) >= BAND_HARD_ZONE)
    return [BAND_LOW, BAND_HIGH_HARD];
  if (climbPart(s)) return [BAND_LOW, BAND_HIGH_CLIMB];
  return [BAND_LOW, BAND_HIGH];
}

/**
 * The relation of song tempo to cadence nearest the comfort band (2x first on a tie) in a work
 * part: 1:1 at an easy 90 rpm (90 BPM is nearer 120-140 than 180), 2x on a 60-75 rpm climb
 * (120-150) and in hard work (180 BPM is nearer 120-160 than 90).
 */
export function preferredKind(s: MusicSection): MatchKind {
  // Only in the work: the warm-up and the cool-down keep 2x (no research there, spec §9 H; with
  // 1:1 at 90 rpm the few calm 85-95 BPM songs crowded every warm-up).
  if (!workPart(s)) return 'exact';
  return nearestKind(s.rpmMean, comfortBand(s));
}

/**
 * The relation the planner plays in the part holding `blockId` (a leaf or a repeat), so the editor
 * judges songs by the same rule: 2x in the warm-up and the cool-down, the comfort band's choice in
 * the work. Undefined when the block is not in the workout.
 */
export function preferredKindAt(w: Workout, blockId: string): MatchKind | undefined {
  const ids = new Set<string>();
  const collect = (blocks: Workout['blocks'], inside: boolean): void => {
    for (const b of blocks) {
      const hit = inside || b.id === blockId;
      if (hit) ids.add(b.id);
      if (b.kind === 'repeat') collect(b.blocks, hit);
    }
  };
  collect(w.blocks, false);
  if (ids.size === 0) return undefined;
  const s = sectionsOf(w).find((x) => x.blockRefs.some((r) => ids.has(r.blockId)));
  return s ? preferredKind(s) : undefined;
}

/**
 * Energy fit 0..1 of a song for a part, or undefined when the song may not play there (spec §2b):
 * a hard part never takes a song 3 steps calmer, a calm part never one 3 steps stronger, the
 * warm-up never an energy 5 song and a climb never a light one (energy 1-2); elsewhere in the
 * work a light song costs `SLOW_WORK_PENALTY` in `scoreTrack`.
 */
export function energyFit(t: Pick<CatalogTrack, 'energy'>, s: MusicSection): number | undefined {
  const d = t.energy - s.energy;
  if (hardPart(s)) {
    // Short hard intervals take sprint songs only: at most one step calmer (spec §2a).
    if (d <= -3 || (s.profile === 'intervals' && d <= -2)) return undefined;
    return Math.max(0, 1 - (d < 0 ? -d * ENERGY_STEP_WRONG : d * ENERGY_STEP_RIGHT));
  }
  if (calmPart(s)) {
    if (d >= 3 || (s.role === 'warmup' && t.energy === 5)) return undefined;
    return Math.max(0, 1 - (d > 0 ? d * ENERGY_STEP_WRONG : -d * ENERGY_STEP_RIGHT));
  }
  if (climbPart(s) && t.energy <= 2) return undefined;
  return Math.max(0, 1 - Math.abs(d) * ENERGY_STEP);
}

/**
 * How well a catalog song suits a section, or undefined when it may not play there at all (see the
 * hard rules at the top). Explicit songs are filtered by the caller (a preference), except in the
 * cool-down, where they never play.
 */
export function scoreTrack(
  t: CatalogTrack,
  s: MusicSection,
  opts: ScoreOptions = {},
): TrackScore | undefined {
  const cooldown = s.role === 'cooldown';
  if (t.beat === 'none' && !cooldown) return undefined;
  if (cooldown && !t.clean) return undefined;
  if (sprintSong(t) && s.role !== 'hard' && s.role !== 'peak') return undefined;
  const eFit = energyFit(t, s);
  if (eFit === undefined) return undefined;
  let bpmFit: number;
  let fit: PickFit;
  let rideRpm: number | undefined;
  const m =
    t.bpm === undefined
      ? undefined
      : matchBpm(t.bpm, s.rpmMean, {
          tolerance: opts.tolerance ?? BPM_CLOSE,
          // Without half/double time only 2x plays, so it is scored in full.
          prefer: (opts.halfDouble ?? true) ? preferredKind(s) : 'exact',
        });
  const usable = m !== undefined && ((opts.halfDouble ?? true) || m.kind === 'exact');
  if (usable && t.bpm !== undefined) rideRpm = t.bpm / MULTIPLIER[m.kind];
  if (cooldown) {
    // No beat needed: a beatless or slow song is what the cool-down wants.
    bpmFit = t.beat === 'none' ? 1 : 0.7;
    fit = t.beat === 'none' ? 'nobeat' : usable ? (m.kind === 'exact' ? m.fit : m.kind) : 'off';
  } else if (usable) {
    bpmFit = m.score;
    fit = m.kind === 'exact' ? m.fit : m.kind;
  } else if (opts.ignoreBpm) {
    bpmFit = 0;
    fit = 'off';
  } else return undefined;
  const misfit =
    s.profile === 'intervals' &&
    (!t.roles.includes('intervals') || t.traits?.includes('long-intro') === true)
      ? INTERVAL_MISFIT
      : 0;
  const [bandLo, bandHi] = comfortBand(s);
  const band =
    !cooldown && usable && t.bpm !== undefined && t.bpm >= bandLo && t.bpm <= bandHi
      ? BAND_BONUS
      : 0;
  const slowWork = workPart(s) && t.energy <= 2 ? SLOW_WORK_PENALTY : 0;
  const w = fitWeights(s);
  const score =
    band -
    slowWork +
    grooveTerm(t, s) +
    moodTerm(t, s) +
    w.bpm * bpmFit +
    w.energy * eFit +
    WEIGHTS.role * roleFit(t, s) +
    WEIGHTS.category * (opts.categoryFit ?? 1) +
    WEIGHTS.trust -
    misfit;
  return rideRpm === undefined ? { score, fit } : { score, fit, rideRpm };
}

// ---------------------------------------------------------------------------------------------
// Seeded jitter and fingerprint
// ---------------------------------------------------------------------------------------------

/** FNV-1a, 32 bit. */
function fnv(text: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Deterministic value in [0, 1) for (seed, song): mulberry32 seeded with a hash of both. */
export function shuffleValue(seed: number, id: string): number {
  let t = (fnv(id, seed >>> 0) + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Short hash of what the songs were chosen for, 8 hex digits: block ids, repetitions, lengths,
 * cadence and effort. A workout changed in any of these gets another one (a plan made before is
 * then "stale"); the name, the description and the music cues are not part of it.
 */
export function soundtrackFingerprint(w: Workout): string {
  let h = 0x811c9dc5;
  for (const s of flattenWorkout(w)) {
    h = fnv(
      `${s.blockId}#${s.rep}:${s.durationSec}:${s.rpm ?? '-'}:${s.effortStart}-${s.effortEnd};`,
      h,
    );
  }
  return h.toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------------------------

/** A song that may play in a section, scored (with the jitter and the ride's penalties). */
export interface Candidate {
  track: CatalogTrack;
  key: string;
  score: number;
  fit: PickFit;
  rideRpm: number | undefined;
  /** Playable length of the main upload from the song's start offset, seconds. */
  lenSec: number;
  /**
   * Rotation cost of the song (history of the last rides), already taken off `score`. The queue
   * charges a song shorter than `ROTATION_REF_SEC` the rest of it (see there).
   */
  rotation?: number;
}

/** Playable length of a song from its start offset (main upload), seconds. */
function lengthOf(t: CatalogTrack): number {
  const main = t.youtube[0];
  return Math.max(0, (main?.durationSec ?? t.durationSec) - (t.startOffsetSec ?? 0));
}

/** Per-ride state shared by the sections: songs used and how often each artist played. */
interface RideState {
  /** Add-on songs (synthwave, drum and bass) used so far. */
  supplements: number;
  used: Set<string>;
  artists: Map<string, number>;
}

/** Penalty per earlier song of the same artist in the ride (spreads big catalogs of one artist). */
const ARTIST_REPEAT_PENALTY = 0.1;
/**
 * Rotation between rides (spec §3a): a song played in the k-th most recent ride costs
 * `HISTORY_SONG_PENALTY` x `HISTORY_DECAY`^(k-1) (0.30, 0.21, 0.15...); an artist costs
 * `HISTORY_ARTIST_PENALTY` for each of their songs in the last `HISTORY_ARTIST_RIDES` rides, at most
 * `HISTORY_ARTIST_MAX`.
 */
export const HISTORY_SONG_PENALTY = 0.3;
export const HISTORY_DECAY = 0.7;
export const HISTORY_ARTIST_PENALTY = 0.08;
export const HISTORY_ARTIST_RIDES = 3;
export const HISTORY_ARTIST_MAX = 0.2;
/**
 * A queue weighs a song's score by the seconds it plays, so a short song paid its rotation cost
 * only for its own length: a 2:35 song of the last ride cost a 17-minute part half of what a 4:00
 * one did, and stayed the handy filler of every ride (R1f: Flume in 464 of 580 rides). A song
 * shorter than this pays its rotation cost as if it lasted this long; fit and length rules as
 * before.
 */
export const ROTATION_REF_SEC = 240;
/**
 * An add-on style (synthwave, drum and bass) is a supplement, never the backbone: each such song
 * costs this much, plus as much again for every one already in the ride.
 */
export const SUPPLEMENT_PENALTY = 0.08;

interface LadderStep {
  relax?: Relaxation;
  tolerance: number;
  neighbours: boolean;
  any: boolean;
  ignoreBpm: boolean;
}

const LADDER: readonly LadderStep[] = [
  { tolerance: BPM_CLOSE, neighbours: false, any: false, ignoreBpm: false },
  { relax: 'tolerance', tolerance: BPM_RELAXED, neighbours: false, any: false, ignoreBpm: false },
  { relax: 'category', tolerance: BPM_RELAXED, neighbours: true, any: false, ignoreBpm: false },
  { relax: 'anyCategory', tolerance: BPM_RELAXED, neighbours: true, any: true, ignoreBpm: false },
  { relax: 'bpm', tolerance: BPM_RELAXED, neighbours: true, any: true, ignoreBpm: true },
];

/** Category fit of a song for the chosen categories at one ladder step; undefined = not allowed. */
function categoryFit(
  t: CatalogTrack,
  chosen: ReadonlySet<MusicCategoryId>,
  near: ReadonlySet<MusicCategoryId>,
  step: LadderStep,
  polish: boolean,
): number | undefined {
  // The rider's own songs have no category: asking for them is asking for any of them.
  if (chosen.size === 0 || t.own === true) return 1;
  let fit: number | undefined;
  for (const c of t.categories) {
    if (chosen.has(c)) return 1;
    if (step.neighbours && near.has(c)) fit = NEIGHBOUR_FIT;
  }
  // The "Polish" chip: a Polish song of another kind is a neighbour, never a full fit (a few
  // Polish songs fit many tempos and would otherwise be in most plans).
  if (polish && t.pl === true && step.neighbours) fit = NEIGHBOUR_FIT;
  return fit ?? (step.any ? ANY_CATEGORY_FIT : undefined);
}

function neighboursOf(chosen: ReadonlySet<MusicCategoryId>): Set<MusicCategoryId> {
  const near = new Set<MusicCategoryId>();
  for (const c of chosen) for (const n of NEIGHBOUR_CATEGORIES[c]) if (!chosen.has(n)) near.add(n);
  return near;
}

interface PlanContext {
  catalog: readonly CatalogTrack[];
  keys: readonly string[];
  prefs: SoundtrackPrefs;
  chosen: ReadonlySet<MusicCategoryId>;
  near: ReadonlySet<MusicCategoryId>;
  /** What the last rides cost a song (by song key) and an artist (`historyPenalties`). */
  historySong: ReadonlyMap<string, number>;
  historyArtist: ReadonlyMap<string, number>;
  /**
   * Mixed into the shuffle with the seed: the workout id, so one seed breaks the near-ties of
   * every workout its own way (R1f: with one seed for all, a song was in nearly every first-visit
   * plan or in few, depending on a few seconds of another song).
   */
  shuffleSalt: string;
}

/** The rotation penalties of the last rides (newest first, catalog ids; unknown ids are skipped). */
function historyPenalties(
  history: readonly (readonly string[])[],
  byId: ReadonlyMap<string, CatalogTrack>,
): { song: Map<string, number>; artist: Map<string, number> } {
  const song = new Map<string, number>();
  const artist = new Map<string, number>();
  history.forEach((ride, k) => {
    for (const id of new Set(ride)) {
      const t = byId.get(id);
      if (!t) continue;
      const key = songKey(t);
      if (!song.has(key)) song.set(key, HISTORY_SONG_PENALTY * HISTORY_DECAY ** k);
      if (k < HISTORY_ARTIST_RIDES) {
        const p = (artist.get(t.artist) ?? 0) + HISTORY_ARTIST_PENALTY;
        artist.set(t.artist, Math.min(HISTORY_ARTIST_MAX, p));
      }
    }
  });
  return { song, artist };
}

function scoredAt(
  ctx: PlanContext,
  s: MusicSection,
  step: LadderStep,
  ride: RideState,
): Candidate[] {
  const out: Candidate[] = [];
  const { catalog, keys, prefs } = ctx;
  const bonus = ownBonus(prefs);
  for (let i = 0; i < catalog.length; i++) {
    const t = catalog[i] as CatalogTrack;
    const key = keys[i] as string;
    if (ride.used.has(key)) continue;
    if (t.own === true && !prefs.includeLibrary) continue;
    if (!t.clean && !prefs.explicit) continue;
    const cat = categoryFit(t, ctx.chosen, ctx.near, step, prefs.polish === true);
    if (cat === undefined) continue;
    const sc = scoreTrack(t, s, {
      tolerance: step.tolerance,
      halfDouble: prefs.allowHalfDouble,
      ignoreBpm: step.ignoreBpm,
      categoryFit: cat,
    });
    if (!sc) continue;
    const lenSec = lengthOf(t);
    if (lenSec <= 0) continue;
    const plays = ride.artists.get(t.artist) ?? 0;
    const addOn = t.supplement ? SUPPLEMENT_PENALTY * (1 + ride.supplements) : 0;
    const rotation = (ctx.historySong.get(key) ?? 0) + (ctx.historyArtist.get(t.artist) ?? 0);
    const score =
      sc.score +
      SHUFFLE_JITTER * shuffleValue(prefs.seed, ctx.shuffleSalt + t.id) -
      ARTIST_REPEAT_PENALTY * plays +
      (t.own === true ? bonus : 0) -
      addOn -
      rotation;
    out.push({ track: t, key, score, fit: sc.fit, rideRpm: sc.rideRpm, lenSec, rotation });
  }
  // Best first; ties by catalog id (deterministic whatever the catalog order).
  out.sort((a, b) => b.score - a.score || (a.track.id < b.track.id ? -1 : 1));
  return out;
}

// ---------------------------------------------------------------------------------------------
// Queue of one section (beam search)
// ---------------------------------------------------------------------------------------------

export interface QueueResult {
  /** Indices into the candidates, in play order. */
  picks: number[];
  /** Total playable length of the picks, seconds. */
  sec: number;
  gapSec: number;
  cutSec: number;
  objective: number;
}

interface BeamState {
  picks: number[];
  sec: number;
  /** Sum of score x seconds played. */
  weighted: number;
  /** Seam and artist penalties so far. */
  penalty: number;
  supplement: boolean;
  lastArtist: string | undefined;
  lastRpm: number | undefined;
}

export interface QueueOptions {
  /** The part's effort trend: a song whose energy is off the curve at its place scores less. */
  trend?: SectionTrend;
  /** The lowest energy the trend may ask for (3 in the work: a falling trend never asks for a slow song). */
  trendFloor?: number;
  /** Artist of the song before the section (no artist twice in a row across the boundary). */
  prevArtist?: string;
}

/**
 * Penalties of the objective, per minute of gap/cut beyond the tolerances. Spec §7.3 gives 0.5
 * and 0.3 against a sum of song scores; here the fit is an average over the section's time, and a
 * cut past 45 s (a song faded well before its end) must lose against any queue that avoids it.
 */
const GAP_COST = 0.5;
const CUT_COST = 1.5;
/** A small cost for any cut, so a song ending at the boundary wins over a cut one. */
const ANY_CUT_COST = 0.02;
const SEAM_COST = 0.15;
/** Trend (spec section 8): per step a song's energy is off the curve at its place, score x time. */
export const TREND_STEP_COST = 0.15;

/**
 * The rotation cost a short song's length hides, in score x seconds: its rotation cost for the
 * seconds it falls short of `ROTATION_REF_SEC`.
 */
function rotationShortfall(cand: Candidate): number {
  return (cand.rotation ?? 0) * Math.max(0, ROTATION_REF_SEC - cand.lenSec);
}

/** A song's score at its place in a part with a trend (the plain score without one). */
function placedScore(
  cand: Candidate,
  atSec: number,
  durationSec: number,
  trend: SectionTrend | undefined,
  floor = 1,
): number {
  if (!trend || durationSec <= 0) return cand.score;
  const want = Math.max(
    floor,
    trendEnergyAt(trend, atSec / durationSec, (atSec + cand.lenSec) / durationSec),
  );
  return cand.score - TREND_STEP_COST * Math.abs(cand.track.energy - want);
}
const SAME_ARTIST_COST = 0.25;

function objective(sec: number, weighted: number, penalty: number, durationSec: number): number {
  const gap = Math.max(0, durationSec - sec);
  const cut = Math.max(0, sec - durationSec);
  return (
    weighted / durationSec -
    penalty -
    (GAP_COST * Math.max(0, gap - SLOT_TOLERANCE_SEC)) / 60 -
    (CUT_COST * Math.max(0, cut - MAX_CUT_SEC)) / 60 -
    (ANY_CUT_COST * Math.min(cut, MAX_CUT_SEC)) / 60
  );
}

/** Penalty of adding `cand` after the queue `st`: same artist twice in a row, a jump of cadence. */
function addPenalty(st: BeamState, cand: Candidate): number {
  let penalty = st.penalty;

  if (st.lastArtist === cand.track.artist) penalty += SAME_ARTIST_COST;
  if (
    st.lastRpm !== undefined &&
    cand.rideRpm !== undefined &&
    Math.abs(st.lastRpm - cand.rideRpm) / st.lastRpm > SEAM_JUMP
  ) {
    penalty += SEAM_COST;
  }
  return penalty;
}

function grow(
  st: BeamState,
  c: number,
  cand: Candidate,
  durationSec: number,
  trend?: SectionTrend,
  floor?: number,
): BeamState {
  const played = Math.min(cand.lenSec, Math.max(0, durationSec - st.sec));
  return {
    picks: [...st.picks, c],
    sec: st.sec + cand.lenSec,
    weighted:
      st.weighted +
      placedScore(cand, st.sec, durationSec, trend, floor) * played -
      rotationShortfall(cand),
    penalty: addPenalty(st, cand),
    supplement: st.supplement || cand.track.supplement === true,
    lastArtist: cand.track.artist,
    lastRpm: cand.rideRpm ?? st.lastRpm,
  };
}

/** True when queue `a` plus song `ac` holds the same songs as queue `b` plus song `bc`. */
function sameSongs(a: readonly number[], ac: number, b: readonly number[], bc: number): boolean {
  if (a.length !== b.length) return false;
  if (ac !== bc && !b.includes(ac)) return false;
  for (const x of a) if (x !== bc && !b.includes(x)) return false;
  return true;
}

/**
 * The queue of one section: the beam search of spec §7.3 over the best `BEAM_POOL` candidates
 * (which must be sorted best first). A queue is complete once it reaches the end of the section
 * within `SLOT_TOLERANCE_SEC`; the complete queue with the best objective wins (time-weighted fit
 * minus seam/artist penalties, gap beyond 10 s and cut beyond 45 s). With no complete queue (too
 * little music), the longest one is returned and the gap rules take over.
 *
 * Expansions are scored on plain numbers; a state is only allocated for the `BEAM_WIDTH`
 * survivors of a step and for a new best complete queue.
 */
export function buildQueue(
  candidates: readonly Candidate[],
  durationSec: number,
  opts: QueueOptions = {},
): QueueResult {
  const n = Math.min(candidates.length, BEAM_POOL);
  const empty: BeamState = {
    picks: [],
    sec: 0,
    weighted: 0,
    penalty: 0,
    supplement: false,
    lastArtist: opts.prevArtist,
    lastRpm: undefined,
  };
  let beam: BeamState[] = [empty];
  let best: BeamState = empty;
  let bestObjective = objective(0, 0, 0, durationSec);
  let bestComplete = false;
  // Survivors of one step as (parent, song, rank), best first.
  const parents: number[] = [];
  const adds: number[] = [];
  const ranks: number[] = [];
  for (let depth = 0; depth < MAX_PICKS && beam.length > 0; depth++) {
    parents.length = 0;
    adds.length = 0;
    ranks.length = 0;
    for (let p = 0; p < beam.length; p++) {
      const st = beam[p] as BeamState;
      const left = durationSec - st.sec;
      for (let c = 0; c < n; c++) {
        if (st.picks.includes(c)) continue;
        const cand = candidates[c] as Candidate;
        if (cand.track.supplement === true && st.supplement) continue; // one add-on per section
        const played = Math.min(cand.lenSec, left);
        const sec = st.sec + cand.lenSec;
        const weighted =
          st.weighted +
          placedScore(cand, st.sec, durationSec, opts.trend, opts.trendFloor) * played -
          rotationShortfall(cand);
        const penalty = addPenalty(st, cand);
        if (sec >= durationSec - SLOT_TOLERANCE_SEC) {
          const obj = objective(sec, weighted, penalty, durationSec);
          if (!bestComplete || obj > bestObjective) {
            best = grow(st, c, cand, durationSec, opts.trend, opts.trendFloor);
            bestObjective = obj;
            bestComplete = true;
          }
          continue;
        }
        // An open queue ranks by its average fit so far minus its penalties.
        const rank = weighted / sec - penalty;
        let same = -1;
        for (let k = 0; k < ranks.length; k++) {
          const other = beam[parents[k] as number] as BeamState;
          if (sameSongs(st.picks, c, other.picks, adds[k] as number)) {
            same = k;
            break;
          }
        }
        if (same >= 0) {
          if (rank <= (ranks[same] as number)) continue;
          ranks.splice(same, 1);
          parents.splice(same, 1);
          adds.splice(same, 1);
        }
        let at = ranks.length;
        while (at > 0 && rank > (ranks[at - 1] as number)) at--;
        if (at >= BEAM_WIDTH) continue;
        ranks.splice(at, 0, rank);
        parents.splice(at, 0, p);
        adds.splice(at, 0, c);
        if (ranks.length > BEAM_WIDTH) {
          ranks.length = BEAM_WIDTH;
          parents.length = BEAM_WIDTH;
          adds.length = BEAM_WIDTH;
        }
      }
    }
    const next: BeamState[] = [];
    for (let k = 0; k < ranks.length; k++) {
      const c = adds[k] as number;
      const grown = grow(
        beam[parents[k] as number] as BeamState,
        c,
        candidates[c] as Candidate,
        durationSec,
        opts.trend,
        opts.trendFloor,
      );
      next.push(grown);
      if (!bestComplete && grown.sec > best.sec) {
        best = grown;
        bestObjective = objective(grown.sec, grown.weighted, grown.penalty, durationSec);
      }
    }
    beam = next;
  }
  const result: QueueResult = {
    picks: best.picks,
    sec: best.sec,
    gapSec: Math.max(0, durationSec - best.sec),
    cutSec: Math.max(0, best.sec - durationSec),
    objective: bestObjective,
  };
  return withinTolerance(result) ? result : repairQueue(result, candidates, n, durationSec, opts);
}

function withinTolerance(q: QueueResult): boolean {
  return q.gapSec <= SLOT_TOLERANCE_SEC && q.cutSec <= MAX_CUT_SEC;
}

/** A queue scored from scratch (same objective as the beam). */
function evaluate(
  picks: readonly number[],
  candidates: readonly Candidate[],
  durationSec: number,
  opts: QueueOptions,
): QueueResult {
  let st: BeamState = {
    picks: [],
    sec: 0,
    weighted: 0,
    penalty: 0,
    supplement: false,
    lastArtist: opts.prevArtist,
    lastRpm: undefined,
  };
  for (const c of picks)
    st = grow(st, c, candidates[c] as Candidate, durationSec, opts.trend, opts.trendFloor);
  return {
    picks: st.picks,
    sec: st.sec,
    gapSec: Math.max(0, durationSec - st.sec),
    cutSec: Math.max(0, st.sec - durationSec),
    objective: objective(st.sec, st.weighted, st.penalty, durationSec),
  };
}

/**
 * The songs whose lengths add up to the section within the tolerances (cut at most `MAX_CUT_SEC`,
 * gap at most `SLOT_TOLERANCE_SEC`) with the most fit x time: a 0/1 knapsack over whole seconds,
 * so it finds such a set whenever one exists among the first `n` candidates. Undefined = none.
 * Played in candidate order (best first); a version with the longest song last is also tried
 * by the caller, since only the last one is cut.
 */
function knapsackFill(
  candidates: readonly Candidate[],
  n: number,
  durationSec: number,
): number[] | undefined {
  const lo = Math.max(1, Math.ceil(durationSec - SLOT_TOLERANCE_SEC));
  const hi = Math.floor(durationSec + MAX_CUT_SEC);
  const width = hi + 1;
  const best = new Float64Array(width).fill(-1);
  best[0] = 0;
  const take = new Uint8Array(n * width);
  const lens: number[] = [];
  for (let i = 0; i < n; i++) {
    const cand = candidates[i] as Candidate;
    const len = Math.max(1, Math.round(cand.lenSec));
    lens.push(len);
    const w = cand.score * Math.min(cand.lenSec, durationSec) - rotationShortfall(cand);
    for (let sec = hi; sec >= len; sec--) {
      const from = best[sec - len] as number;
      if (from < 0) continue;
      if (from + w > (best[sec] as number)) {
        best[sec] = from + w;
        take[i * width + sec] = 1;
      }
    }
  }
  let at = -1;
  for (let sec = lo; sec <= hi; sec++) {
    // Most fit, then the smallest cut.
    if ((best[sec] as number) >= 0 && (at < 0 || (best[sec] as number) > (best[at] as number))) {
      at = sec;
    }
  }
  if (at < 0) return undefined;
  const picks: number[] = [];
  for (let i = n - 1; i >= 0 && at > 0; i--) {
    if (take[i * width + at] === 1) {
      picks.push(i);
      at -= lens[i] as number;
    }
  }
  return picks.reverse();
}

/**
 * Repair when the beam's queue misses the tolerances (the beam ranks open queues by fit, so it can
 * miss the one combination of lengths that ends right). Tries, and keeps the best by the objective
 * among the queues within the tolerances:
 * - the knapsack set (`knapsackFill`), as it is and with its longest song last;
 * - for every prefix of the beam's queue, one or two unused songs that end the section.
 * If none is within the tolerances, the beam's queue stays. Only runs on a miss.
 */
function repairQueue(
  start: QueueResult,
  candidates: readonly Candidate[],
  n: number,
  durationSec: number,
  opts: QueueOptions,
): QueueResult {
  let best: QueueResult | undefined;
  const lenOf = (c: number): number => (candidates[c] as Candidate).lenSec;
  const consider = (picks: number[]): void => {
    if (picks.length === 0 || picks.length > MAX_PICKS) return;
    let addOns = 0;
    for (const c of picks) if ((candidates[c] as Candidate).track.supplement) addOns++;
    if (addOns > 1) return;
    const q = evaluate(picks, candidates, durationSec, opts);
    if (withinTolerance(q) && (!best || q.objective > best.objective)) best = q;
  };
  const set = knapsackFill(candidates, n, durationSec);
  if (set) {
    consider(set);
    let longest = 0;
    for (let i = 1; i < set.length; i++) {
      if (lenOf(set[i] as number) > lenOf(set[longest] as number)) longest = i;
    }
    if (longest !== set.length - 1) {
      consider([...set.filter((_, i) => i !== longest), set[longest] as number]);
    }
  }
  for (let k = start.picks.length; k >= 0; k--) {
    const prefix = start.picks.slice(0, k);
    let sec = 0;
    for (const c of prefix) sec += lenOf(c);
    const lo = durationSec - SLOT_TOLERANCE_SEC - sec;
    const hi = durationSec + MAX_CUT_SEC - sec;
    if (hi < 0) continue;
    if (lo <= 0) consider(prefix);
    for (let a = 0; a < n; a++) {
      if (prefix.includes(a)) continue;
      const la = lenOf(a);
      if (la >= lo && la <= hi) consider([...prefix, a]);
      if (la >= hi) continue;
      for (let b = a + 1; b < n; b++) {
        if (prefix.includes(b)) continue;
        const sum = la + lenOf(b);
        if (sum < lo || sum > hi) continue;
        consider([...prefix, a, b]);
        consider([...prefix, b, a]);
      }
    }
  }
  return best ?? start;
}

/** Each ladder step taken costs this much of the objective: the chosen categories come first. */
const RELAX_COST = 0.05;

interface SectionQueue {
  candidates: Candidate[];
  relaxed: Relaxation[];
  queue: QueueResult;
}

/**
 * Walks the relaxation ladder for one section: each step's candidates get a queue, and the walk
 * stops at the first queue that fills the section (gap at most `SLOT_TOLERANCE_SEC`, cut at most
 * `MAX_CUT_SEC`) from at least `MIN_CANDIDATES` songs. Otherwise the best queue wins, each step
 * costing `RELAX_COST`. Any tempo (the last step) only when no step had a single song.
 */
function planSection(
  ctx: PlanContext,
  s: MusicSection,
  ride: RideState,
  prevArtist: string | undefined,
): SectionQueue {
  let best: SectionQueue | undefined;
  let bestValue = -Infinity;
  const opts: QueueOptions = {
    ...(prevArtist !== undefined ? { prevArtist } : {}),
    ...(s.trend ? { trend: s.trend, trendFloor: workPart(s) ? 3 : 1 } : {}),
  };
  for (let i = 0; i < LADDER.length; i++) {
    const step = LADDER[i] as LadderStep;
    if (step.ignoreBpm && best) break;
    const candidates = scoredAt(ctx, s, step, ride);
    if (candidates.length === 0) continue;
    const queue = buildQueue(candidates, s.durationSec, opts);
    const value = queue.objective - RELAX_COST * i;
    if (!best || value > bestValue) {
      const relaxed: Relaxation[] = [];
      for (let k = 1; k <= i; k++) {
        const r = (LADDER[k] as LadderStep).relax;
        if (r) relaxed.push(r);
      }
      best = { candidates, relaxed, queue };
      bestValue = value;
    }
    if (withinTolerance(queue) && candidates.length >= MIN_CANDIDATES) break;
  }
  return (
    best ?? {
      candidates: [],
      relaxed: [],
      queue: { picks: [], sec: 0, gapSec: s.durationSec, cutSec: 0, objective: 0 },
    }
  );
}

// ---------------------------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------------------------

interface Draft {
  section: MusicSection;
  /** The rider locked this section: its planned songs are kept as they are. */
  kept?: PlannedSection;
  candidates: Candidate[];
  relaxed: Relaxation[];
  /** Picked candidates in play order. */
  queue: Candidate[];
}

export interface PlanOptions {
  /** Sections to plan (default `sectionsOf(workout)`); the wizard passes the ones it showed. */
  sections?: readonly MusicSection[];
  /** Catalog ids of songs the rider threw out ("Replace"): they are never planned again. */
  exclude?: ReadonlySet<string>;
  /**
   * Sections the rider locked, by section id: they keep their songs and the rest of the plan is
   * built around them (a locked song is not played twice). A lock whose section changed in length,
   * or whose songs are no longer in the catalog, is ignored.
   */
  keep?: ReadonlyMap<string, PlannedSection>;
  /**
   * Catalog ids played in the last rides, newest ride first (spec §3a): a song of a recent ride
   * and an artist played often lately cost a little, so the plans rotate between rides.
   */
  history?: readonly (readonly string[])[];
}

/** The locked section as it was planned, when it still fits this section and the catalog. */
function keptSection(
  s: MusicSection,
  kept: PlannedSection | undefined,
  byId: ReadonlyMap<string, CatalogTrack>,
): PlannedSection | undefined {
  if (!kept || kept.sectionId !== s.id || kept.durationSec !== s.durationSec) return undefined;
  if (kept.picks.length === 0 || kept.picks.some((p) => !byId.has(p.ref.id))) return undefined;
  return kept;
}

/** The TrackRef of a candidate (main upload first, the others as its backups). */
function asTrackRef(c: Candidate): TrackRef {
  const [main, ...rest] = c.track.youtube.map((u) => youtubeTrack(c.track, u));
  const first = main as TrackRef;
  return rest.length > 0 ? { ...first, alternates: rest } : first;
}

/** Plans the music of a workout (see the file comment). Never mutates its inputs. */
export function planSoundtrack(
  workout: Workout,
  catalog: readonly CatalogTrack[],
  prefs: SoundtrackPrefs = DEFAULT_SOUNDTRACK_PREFS,
  opts: PlanOptions = {},
): SoundtrackPlan {
  const sections = opts.sections ?? sectionsOf(workout);
  const chosen = new Set(prefs.categories.filter((c) => MUSIC_CATEGORIES.includes(c)));
  const catalogById = new Map(catalog.map((t) => [t.id, t]));
  const past = historyPenalties(opts.history ?? [], catalogById);
  const ctx: PlanContext = {
    catalog,
    keys: catalog.map((t) => songKey(t)),
    prefs,
    chosen,
    near: neighboursOf(chosen),
    historySong: past.song,
    historyArtist: past.artist,
    shuffleSalt: `${workout.id}/`,
  };
  const ride: RideState = { used: new Set(), artists: new Map(), supplements: 0 };
  for (const id of opts.exclude ?? []) {
    const t = catalogById.get(id);
    if (t) ride.used.add(songKey(t));
  }
  const seamless = prefs.continuity === 'seamless';
  const fallbackTracks = seamless
    ? catalog.filter((t) => t.traits?.includes('fallback') && t.clean)
    : [];
  for (const t of fallbackTracks) ride.used.add(songKey(t));

  // 1-3. Candidates and queues, section by section (the ride's songs are never repeated).
  const drafts: Draft[] = [];
  let prevArtist: string | undefined;
  // Locked sections come first: their songs are taken before any other section picks, so a section
  // planned earlier in the ride never repeats a song a later locked one keeps.
  const keptFor = new Map<string, PlannedSection>();
  for (const s of sections) {
    const kept = s.locked ? undefined : keptSection(s, opts.keep?.get(s.id), catalogById);
    if (!kept) continue;
    keptFor.set(s.id, kept);
    for (const p of kept.picks) {
      const t = catalogById.get(p.ref.id) as CatalogTrack;
      ride.used.add(songKey(t));
      ride.artists.set(t.artist, (ride.artists.get(t.artist) ?? 0) + 1);
      if (t.supplement) ride.supplements += 1;
    }
  }
  for (const s of sections) {
    if (s.locked) {
      drafts.push({ section: s, candidates: [], relaxed: [], queue: [] });
      prevArtist = undefined;
      continue;
    }
    const kept = keptFor.get(s.id);
    if (kept) {
      prevArtist = catalogById.get(kept.picks[kept.picks.length - 1]?.ref.id ?? '')?.artist;
      drafts.push({ section: s, kept, candidates: [], relaxed: [], queue: [] });
      continue;
    }
    const { candidates, relaxed, queue: q } = planSection(ctx, s, ride, prevArtist);
    const queue = q.picks.map((i) => candidates[i] as Candidate);
    for (const c of queue) {
      ride.used.add(c.key);
      ride.artists.set(c.track.artist, (ride.artists.get(c.track.artist) ?? 0) + 1);
      if (c.track.supplement) ride.supplements += 1;
    }
    prevArtist = queue[queue.length - 1]?.track.artist ?? prevArtist;
    drafts.push({ section: s, candidates, relaxed, queue });
  }

  // 5. Gaps, and the picks on the section's clock.
  const fallbackSec = fallbackTracks.reduce((sum, t) => sum + lengthOf(t), 0);
  const byUpload = new Map<string, CatalogTrack>();
  for (const t of catalog) for (const u of t.youtube) byUpload.set(u.id, t);
  const planned: PlannedSection[] = drafts.map((d) => {
    const s = d.section;
    const base = {
      sectionId: s.id,
      anchor: s.anchor,
      startSec: s.startSec,
      durationSec: s.durationSec,
      role: s.role,
      rpm: s.rpmMean,
    };
    if (d.kept) return d.kept;
    if (s.locked) {
      return {
        ...base,
        locked: s.locked,
        picks: [],
        report: { gapSec: 0, cutSec: 0, relaxed: [], warn: [], fills: [] },
      };
    }
    let refs = d.queue.map(asTrackRef);
    const gapLimit = seamless ? SLOT_TOLERANCE_SEC : GAPS_OK_SEC;
    const total = d.queue.reduce((sum, c) => sum + c.lenSec, 0);
    let fills: GapRule[] = [];
    let silenceSec = Math.max(0, s.durationSec - total);
    if (refs.length > 0 && s.durationSec - total > gapLimit) {
      // A full cue (track + `MAX_QUEUE`) takes no more songs: only a longer upload or the fallback.
      const full = refs.length >= MAX_PICKS;
      const reserve = full ? [] : d.candidates.filter((c) => !ride.used.has(c.key)).map(asTrackRef);
      const loopable = new Set(
        full
          ? []
          : d.queue
              .filter((c) => c.track.traits?.some((x) => x === 'loopable' || x === 'instrumental'))
              .map((c) => c.key),
      );
      const filled = fillSlotGap(refs, s.durationSec, reserve, {
        used: ride.used,
        ...(s.role === 'cooldown' ? {} : { bpm: s.targetBpm }),
        loopable,
        fallbackSec,
      });
      refs = filled.queue;
      fills = filled.rules;
      silenceSec = filled.silenceSec;
      for (const k of filled.added) ride.used.add(k);
    } else if (refs.length === 0 && seamless && fallbackSec >= s.durationSec) {
      fills = ['fallback'];
      silenceSec = 0;
    }
    const picks: PlanPick[] = [];
    let at = 0;
    for (const ref of refs) {
      if (at >= s.durationSec || picks.length >= MAX_PICKS) break;
      const track = byUpload.get(ref.id) as CatalogTrack;
      const len = Math.max(0, (ref.durationSec ?? track.durationSec) - ref.startAtSec);
      const fit =
        d.queue.find((c) => c.track === track)?.fit ??
        scoreTrack(track, s, { tolerance: BPM_RELAXED, ignoreBpm: true })?.fit ??
        'off';
      picks.push({
        ref: { kind: track.own === true ? 'own' : 'catalog', id: track.id },
        upload: ref.id,
        startAtSec: ref.startAtSec,
        atSec: at,
        playSec: Math.min(len, s.durationSec - at),
        fit,
      });
      at += len;
    }
    const gapSec = Math.max(0, s.durationSec - at);
    const cutSec = Math.max(0, at - s.durationSec);
    const warn: SectionWarning[] = [];
    if (picks.length === 0) warn.push('none');
    if (d.relaxed.includes('bpm')) warn.push('bpm');
    if (gapSec > gapLimit && silenceSec > 0) warn.push('gap');
    if (cutSec > MAX_CUT_SEC) warn.push('cut');
    return { ...base, picks, report: { gapSec, cutSec, relaxed: d.relaxed, warn, fills } };
  });

  const fallback: PlanPick[] = [];
  let fallbackAt = 0;
  for (const t of fallbackTracks) {
    const upload = t.youtube[0];
    if (!upload) continue;
    const len = lengthOf(t);
    fallback.push({
      ref: { kind: 'catalog', id: t.id },
      upload: upload.id,
      startAtSec: t.startOffsetSec ?? 0,
      atSec: fallbackAt,
      playSec: len,
      fit: t.beat === 'none' ? 'nobeat' : 'off',
    });
    fallbackAt += len;
  }

  return {
    v: 1,
    workoutId: workout.id,
    fingerprint: soundtrackFingerprint(workout),
    prefs: { ...prefs, categories: [...prefs.categories] },
    sections: planned,
    fallback,
  };
}
