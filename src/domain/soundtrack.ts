/**
 * Soundtrack Match ("Pick the music"), part 1: a workout's music sections (pure logic).
 *
 * A section is a stretch of the workout that one short queue of songs covers: consecutive blocks of
 * similar effort and cadence. Its cadence gives the wanted tempo (2 BPM = 1 RPM; half and double
 * time also fit, see `bpm-match.ts`) and its effort gives the wanted energy of the songs.
 *
 * The rules follow the soundtrack spec, §7.1 (`sectionsOf`) and §7.6 (`coverage`):
 *
 * 1. Units. A top-level block is a unit. A repeat is one unit, unless one repetition lasts at least
 *    `MIN_SECTION_SEC`; then every repetition is a unit of its own.
 * 2. Splitting. A unit longer than `SPLIT_SEC` is cut where the effort/cadence jumps most, at a
 *    segment boundary (a music cue can only start where a block starts), and only between
 *    repetitions when the unit spans several of them. Both halves keep at least `MIN_SECTION_SEC`.
 *    A single block longer than `SPLIT_SEC` stays whole: its queue simply holds more songs.
 * 3. Merging, in time order: a unit joins the open section when its mean effort is within
 *    `D_EFFORT`, its mean cadence within `D_RPM` and the section stays within `MAX_SECTION_SEC`.
 * 4. Short sections (< `MIN_SECTION_SEC`) are absorbed by the neighbour of closer effort (on a tie
 *    the harder one), shortest first; a neighbour that would grow past `SPLIT_SEC` comes last.
 * 5. More than `MAX_SECTIONS`: the most similar neighbours merge until the limit holds.
 * 6. Role: the first section is the warm-up when it stays at effort 4 or below, or starts at
 *    `scaling.warmupBlockId` with a mean effort of 5 or below (short bursts inside a warm-up); a section starting at `scaling.cooldownBlockId`, or the last one at mean
 *    effort 3 or below, is the cool-down; the rest by mean effort. Energy comes from the effort.
 * 7. Profile (music energy spec §2a): a section of short hard efforts with rests in between
 *    (`intervalProfile`) is `intervals`; its energy, role and cadence come from the work phase,
 *    not the mean (a warm-up or cool-down stays as it is). Everything else is `steady`.
 *    Locked sections (the workout's cooldown track, or a cue
 *    the author or user already placed) are kept whole and never merged with anything.
 *
 * Deterministic, never mutates its input, no I/O, no clock, no randomness. Runs before a ride
 * (wizard, editor), never inside the session engine's `update()`.
 */
import { BPM_CLOSE, matchBpm } from './bpm-match';
import { DEFAULT_EFFORT_TABLE, type EffortTable } from './effort';
import { flattenWorkout, type Segment } from './segments';
import { compileSongCues, cooldownBlockOf, type Workout } from './workout';

// ---------------------------------------------------------------------------------------------
// Music categories (what the rider picks)
// ---------------------------------------------------------------------------------------------

/** Taste labels of the catalog (a song may carry several). Not tempo genres: see `GENRES`. */
export const MUSIC_CATEGORIES = [
  'electronic',
  'house',
  'pop',
  'rock',
  'hiphop',
  'lofi',
  'latino',
  'classics',
] as const;
export type MusicCategoryId = (typeof MUSIC_CATEGORIES)[number];

/**
 * Typical tempo ranges of each category (BPM, inclusive). Informational only (dimming a chip,
 * one-line hints); the planner always uses each song's own BPM.
 */
export const CATEGORY_TEMPO: Readonly<
  Record<MusicCategoryId, readonly (readonly [number, number])[]>
> = {
  electronic: [[100, 175]],
  house: [[118, 130]],
  pop: [[90, 130]],
  rock: [[100, 180]],
  hiphop: [
    [80, 100],
    [130, 150],
  ],
  lofi: [[70, 90]],
  latino: [[90, 105]],
  classics: [[100, 140]],
};

export function isMusicCategory(v: unknown): v is MusicCategoryId {
  return typeof v === 'string' && (MUSIC_CATEGORIES as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------------------------

/** A shorter section is absorbed by a neighbour. */
export const MIN_SECTION_SEC = 150;
/** Merging never makes a section longer than this (absorbing a short one may, up to SPLIT_SEC). */
export const MAX_SECTION_SEC = 600;
/** A unit longer than this is split where the effort or cadence jumps most. */
export const SPLIT_SEC = 900;
/** At most this many sections; beyond it the most similar neighbours merge. */
export const MAX_SECTIONS = 12;
/** Units merge when their mean effort differs by at most this (effort scale 1-10)... */
export const D_EFFORT = 1;
/** ...and their mean cadence by at most this many RPM. */
export const D_RPM = 8;
/** Cadence assumed for a section whose blocks carry no RPM at all (`rpmKnown: false`). */
export const DEFAULT_RPM = 90;

export type SectionRole = 'warmup' | 'steady' | 'tempo' | 'hard' | 'peak' | 'cooldown';
export type SectionEnergy = 1 | 2 | 3 | 4 | 5;
export type SectionProfile = 'steady' | 'intervals';

/** An `intervals` section crosses the middle of its effort range at least this many times... */
export const INTERVAL_MIN_CROSSINGS = 3;
/** ...spans at least this much effort (max - min)... */
export const INTERVAL_MIN_RANGE = 4;
/** ...and its work phases (above the middle) last less than this on average, seconds. */
export const INTERVAL_MAX_WORK_SEC = 60;
/** Why a section keeps the music it already has: the cooldown track, or a cue already placed. */
export type SectionLock = 'cooldownTrack' | 'userCue';

/**
 * A part whose effort rises, falls, or rises and falls (a ramp, a pyramid, climbing steps): the
 * songs follow it (music energy spec section 8). Soft: the planner only prefers songs on the curve.
 */
export type TrendKind = 'up' | 'down' | 'pyramid';

export interface SectionTrend {
  kind: TrendKind;
  /** Effort 1-10 of `TREND_SLICES` equal slices of the part's time, in order. */
  curve: number[];
}

/** Slices of a part the trend curve is read at. */
export const TREND_SLICES = 12;
/** A part shorter than this holds too few songs to follow a trend. */
export const TREND_MIN_SEC = 360;
/** The effort a trend must rise or fall by (the ends of the part against its top). */
export const TREND_MIN_EFFORT = 1.5;

export interface BlockRef {
  blockId: string;
  rep: number;
}

export interface MusicSection {
  /** `s1`..`sN` in time order; stable for the same workout. */
  id: string;
  /** Where the section's cue starts: its first segment (a `MusicCue` uses the same pair). */
  anchor: BlockRef;
  startSec: number;
  durationSec: number;
  /** Every block/repetition the section covers, in order. */
  blockRefs: BlockRef[];
  role: SectionRole;
  /** Effort 1-10: min/max over the blocks, mean weighted by time (a ramp counts as its mid-point). */
  effort: { min: number; max: number; mean: number };
  /**
   * Cadence the music follows: weighted by time over the blocks that set one, `DEFAULT_RPM` when
   * none does. For an `intervals` section, the cadence of the work phase (the rest takes what plays);
   * the whole section's when the work phase sets none.
   */
  rpmMean: number;
  /**
   * False when no block of the section sets a cadence (the tempo is then a guess, shown as an
   * estimated tempo). Such a section is compared on effort alone: merging, the limit of sections
   * and splitting all ignore the cadence difference when either side's cadence is unknown.
   */
  rpmKnown: boolean;
  /** Wanted song tempo on the beat: 2 x `rpmMean` (half/double via `targetBpms`). */
  targetBpm: number;
  /**
   * Energy 1-5 wanted from the songs: `energyOf(workEffort)` (see `profile`); one step less for an
   * `intervals` part with under `INTERVAL_MIN_WORK_SHARE` of work (`intervalEnergy`).
   */
  energy: SectionEnergy;
  /**
   * 'intervals' = short hard efforts with rests in between (see `intervalProfile`): the music
   * follows the work phase, not the mean, so a sprint is not read as a medium ride.
   */
  profile: SectionProfile;
  /**
   * Effort the music follows: the time-weighted mean of the work phase (segments above the middle
   * of the effort range) for an `intervals` section, `effort.mean` otherwise.
   */
  workEffort: number;
  /** Present when the effort rises and/or falls inside the part (`detectTrend`). */
  trend?: SectionTrend;
  locked?: SectionLock;
}

export interface SectionOptions {
  /** The rider's effort table (blocks set in %FTP map to effort through it). */
  table?: EffortTable;
}

/** A run of consecutive segments, inclusive indices. */
interface Piece {
  first: number;
  last: number;
  /** Several repetitions of one repeat: only cut between repetitions. */
  multiRep: boolean;
  locked?: SectionLock;
}

interface Stats {
  startSec: number;
  durationSec: number;
  effortMin: number;
  effortMax: number;
  effortMean: number;
  rpmMean: number;
  rpmKnown: boolean;
}

function segEffortMean(s: Segment): number {
  return (s.effortStart + s.effortEnd) / 2;
}

function statsOf(segments: readonly Segment[], first: number, last: number): Stats {
  let dur = 0;
  let effortSum = 0;
  let effortMin = Infinity;
  let effortMax = -Infinity;
  let rpmSum = 0;
  let rpmSec = 0;
  for (let i = first; i <= last; i++) {
    const s = segments[i] as Segment;
    dur += s.durationSec;
    effortSum += segEffortMean(s) * s.durationSec;
    effortMin = Math.min(effortMin, s.effortStart, s.effortEnd);
    effortMax = Math.max(effortMax, s.effortStart, s.effortEnd);
    if (s.rpm !== undefined && Number.isFinite(s.rpm) && s.rpm > 0) {
      rpmSum += s.rpm * s.durationSec;
      rpmSec += s.durationSec;
    }
  }
  const start = (segments[first] as Segment).startSec;
  return {
    startSec: start,
    durationSec: dur,
    effortMin,
    effortMax,
    // A zero-length run cannot happen in valid workouts (blocks last >= 1 s); guard anyway.
    effortMean: dur > 0 ? effortSum / dur : (effortMin + effortMax) / 2,
    rpmMean: rpmSec > 0 ? rpmSum / rpmSec : DEFAULT_RPM,
    rpmKnown: rpmSec > 0,
  };
}

/** Distance between two runs, used for the limit and for splitting: effort + cadence/10. */
function distance(a: Stats, b: Stats): number {
  const dRpm = a.rpmKnown && b.rpmKnown ? Math.abs(a.rpmMean - b.rpmMean) : 0;
  return Math.abs(a.effortMean - b.effortMean) + dRpm / 10;
}

/** Step 1: units, with the lock each one carries. */
function unitsOf(w: Workout, segments: readonly Segment[]): Piece[] {
  const cueKeys = new Set<string>();
  for (const c of w.musicCues ?? []) cueKeys.add(`${c.blockId}#${c.rep}`);
  if (w.format === 'songs')
    for (const c of compileSongCues(w)) cueKeys.add(`${c.blockId}#${c.rep}`);
  const cooldownId = w.cooldownTrack ? cooldownBlockOf(w)?.id : undefined;

  const units: Piece[] = [];
  let idx = 0;
  const add = (first: number, last: number, multiRep: boolean, topId: string): void => {
    if (last < first) return;
    const piece: Piece = { first, last, multiRep };
    if (topId === cooldownId) piece.locked = 'cooldownTrack';
    else {
      for (let i = first; i <= last; i++) {
        const s = segments[i] as Segment;
        if (cueKeys.has(`${s.blockId}#${s.rep}`)) {
          piece.locked = 'userCue';
          break;
        }
      }
    }
    units.push(piece);
  };

  for (const b of w.blocks) {
    if (b.kind !== 'repeat') {
      add(idx, idx, false, b.id);
      idx += 1;
      continue;
    }
    const perRep = b.blocks.length;
    const repSec = b.blocks.reduce((sum, c) => sum + c.durationSec, 0);
    if (repSec >= MIN_SECTION_SEC) {
      for (let rep = 0; rep < b.times; rep++) {
        add(idx, idx + perRep - 1, false, b.id);
        idx += perRep;
      }
    } else {
      add(idx, idx + perRep * b.times - 1, b.times > 1, b.id);
      idx += perRep * b.times;
    }
  }
  return units;
}

/** Step 2: cut a unit longer than SPLIT_SEC where it jumps most (recursively). */
function splitUnit(segments: readonly Segment[], u: Piece, out: Piece[]): void {
  const total = statsOf(segments, u.first, u.last).durationSec;
  if (total <= SPLIT_SEC || u.first === u.last) {
    out.push(u);
    return;
  }
  let best = -1;
  let bestJump = -Infinity;
  let bestBalance = Infinity;
  let left = 0;
  for (let k = u.first + 1; k <= u.last; k++) {
    const prev = segments[k - 1] as Segment;
    const next = segments[k] as Segment;
    left += prev.durationSec;
    const right = total - left;
    if (left < MIN_SECTION_SEC || right < MIN_SECTION_SEC) continue;
    if (u.multiRep && next.rep === prev.rep) continue;
    const dRpm =
      prev.rpm !== undefined && next.rpm !== undefined ? Math.abs(next.rpm - prev.rpm) : 0;
    const jump = Math.abs(next.effortStart - prev.effortEnd) + dRpm / 10;
    const balance = Math.abs(left - right);
    if (jump > bestJump || (jump === bestJump && balance < bestBalance)) {
      best = k;
      bestJump = jump;
      bestBalance = balance;
    }
  }
  if (best < 0) {
    out.push(u);
    return;
  }
  const a: Piece = { first: u.first, last: best - 1, multiRep: u.multiRep };
  const b: Piece = { first: best, last: u.last, multiRep: u.multiRep };
  if (u.locked) {
    a.locked = u.locked;
    b.locked = u.locked;
  }
  splitUnit(segments, a, out);
  splitUnit(segments, b, out);
}

function join(a: Piece, b: Piece): Piece {
  return { first: a.first, last: b.last, multiRep: a.multiRep || b.multiRep };
}

/** Step 3: greedy merge in time order. */
function mergeUnits(segments: readonly Segment[], units: readonly Piece[]): Piece[] {
  const out: Piece[] = [];
  for (const u of units) {
    const open = out[out.length - 1];
    if (open && !open.locked && !u.locked) {
      const so = statsOf(segments, open.first, open.last);
      const su = statsOf(segments, u.first, u.last);
      const rpmOk = !so.rpmKnown || !su.rpmKnown || Math.abs(so.rpmMean - su.rpmMean) <= D_RPM;
      if (
        Math.abs(so.effortMean - su.effortMean) <= D_EFFORT &&
        rpmOk &&
        so.durationSec + su.durationSec <= MAX_SECTION_SEC
      ) {
        out[out.length - 1] = join(open, u);
        continue;
      }
    }
    out.push(u);
  }
  return out;
}

/** Step 4: absorb sections shorter than MIN_SECTION_SEC into a neighbour, shortest first. */
function absorbShort(segments: readonly Segment[], pieces: Piece[]): Piece[] {
  const list = pieces.slice();
  for (;;) {
    let pick = -1;
    let pickDur = Infinity;
    for (let i = 0; i < list.length; i++) {
      const p = list[i] as Piece;
      if (p.locked) continue;
      const dur = statsOf(segments, p.first, p.last).durationSec;
      if (dur >= MIN_SECTION_SEC || dur >= pickDur) continue;
      const prev = list[i - 1];
      const next = list[i + 1];
      if ((prev && !prev.locked) || (next && !next.locked)) {
        pick = i;
        pickDur = dur;
      }
    }
    if (pick < 0) return list;

    const self = list[pick] as Piece;
    const s = statsOf(segments, self.first, self.last);
    const options: { side: -1 | 1; dEffort: number; effort: number; fits: boolean }[] = [];
    for (const side of [-1, 1] as const) {
      const n = list[pick + side];
      if (!n || n.locked) continue;
      const sn = statsOf(segments, n.first, n.last);
      options.push({
        side,
        dEffort: Math.abs(sn.effortMean - s.effortMean),
        effort: sn.effortMean,
        fits: sn.durationSec + s.durationSec <= SPLIT_SEC,
      });
    }
    // Prefer a neighbour that stays within SPLIT_SEC (MAX_SECTION_SEC only caps step 3: a short
    // piece of work belongs with the work next to it, not with the cool-down that happens to have
    // room), then the closer effort, then the harder one (high effort has priority when songs are
    // picked), then the earlier one.
    options.sort(
      (a, b) =>
        Number(b.fits) - Number(a.fits) ||
        a.dEffort - b.dEffort ||
        b.effort - a.effort ||
        a.side - b.side,
    );
    const side = (options[0] as (typeof options)[number]).side;
    if (side === -1) list.splice(pick - 1, 2, join(list[pick - 1] as Piece, self));
    else list.splice(pick, 2, join(self, list[pick + 1] as Piece));
  }
}

/** Step 5: merge the most similar neighbours until there are at most MAX_SECTIONS. */
function enforceLimit(segments: readonly Segment[], pieces: Piece[]): Piece[] {
  const list = pieces.slice();
  while (list.length > MAX_SECTIONS) {
    let pick = -1;
    let pickD = Infinity;
    let pickDur = Infinity;
    for (let i = 0; i + 1 < list.length; i++) {
      const a = list[i] as Piece;
      const b = list[i + 1] as Piece;
      if (a.locked || b.locked) continue;
      const sa = statsOf(segments, a.first, a.last);
      const sb = statsOf(segments, b.first, b.last);
      const d = distance(sa, sb);
      const dur = sa.durationSec + sb.durationSec;
      if (d < pickD || (d === pickD && dur < pickDur)) {
        pick = i;
        pickD = d;
        pickDur = dur;
      }
    }
    if (pick < 0) break; // only locked sections left to merge: keep them
    list.splice(pick, 2, join(list[pick] as Piece, list[pick + 1] as Piece));
  }
  return list;
}

/** Energy 1-5 wanted from songs for a mean effort 1-10 (spec §7.1, step 8). */
export function energyOf(effortMean: number): SectionEnergy {
  const e = Math.min(10, Math.max(1, Math.round(effortMean)));
  if (e <= 3) return 1;
  if (e === 4) return 2;
  if (e <= 6) return 3;
  if (e <= 8) return 4;
  return 5;
}

/** Role by mean effort for a section that is neither the warm-up nor the cool-down. */
export function roleOfEffort(effortMean: number): Exclude<SectionRole, 'warmup' | 'cooldown'> {
  if (effortMean <= 5) return 'steady';
  if (effortMean <= 6.5) return 'tempo';
  if (effortMean <= 8.5) return 'hard';
  return 'peak';
}

/** Role of an `intervals` section by the effort of its work phase (music energy spec §2a). */
export function roleOfWork(workEffort: number): Exclude<SectionRole, 'warmup' | 'cooldown'> {
  if (workEffort >= 9) return 'peak';
  if (workEffort >= 7) return 'hard';
  return roleOfEffort(workEffort);
}

/** What the music of a run of segments follows: its profile, work effort and cadence. */
interface IntervalProfile {
  profile: SectionProfile;
  workEffort: number;
  rpm: number;
  /** Share of the run's time in the work phase, 0..1 (1 for a steady run). */
  workShare: number;
}

/**
 * Below this share of work in an `intervals` part (a few short sprints in long rests), the music
 * asks for one step less energy than the work phase: a peak song for 5 minutes of mostly rest is
 * too much (review of #133, owner's default 2026-11-22).
 */
export const INTERVAL_MIN_WORK_SHARE = 0.2;

/** Energy an `intervals` part asks for: the work phase's, one step less when the work is short. */
export function intervalEnergy(workEffort: number, workShare: number, mean: number): SectionEnergy {
  const work = energyOf(workEffort);
  if (workShare >= INTERVAL_MIN_WORK_SHARE) return work;
  return Math.max(energyOf(mean), work - 1) as SectionEnergy;
}

/**
 * A run is `intervals` when it crosses the middle of its effort range ((min + max) / 2) at least
 * `INTERVAL_MIN_CROSSINGS` times, spans at least `INTERVAL_MIN_RANGE` and its work phases (runs of
 * segments above the middle, a ramp counted at its mid-point) last under `INTERVAL_MAX_WORK_SEC` on
 * average, and one work + rest cycle (the run's length / its work phases) is shorter than
 * `MIN_SECTION_SEC` (longer intervals are a section per repetition already). The music then
 * follows the work phase: its time-weighted effort and cadence (the
 * whole run's cadence when the work phase sets none). Otherwise the run's mean and cadence.
 */
function intervalProfile(segments: readonly Segment[], p: Piece, st: Stats): IntervalProfile {
  const steadyProfile: IntervalProfile = {
    profile: 'steady',
    workEffort: st.effortMean,
    rpm: st.rpmMean,
    workShare: 1,
  };
  if (st.effortMax - st.effortMin < INTERVAL_MIN_RANGE) return steadyProfile;
  const mid = (st.effortMin + st.effortMax) / 2;
  let crossings = 0;
  let phases = 0;
  let workSec = 0;
  let workEffortSum = 0;
  let rpmSum = 0;
  let rpmSec = 0;
  let wasAbove = false;
  for (let i = p.first; i <= p.last; i++) {
    const s = segments[i] as Segment;
    const above = segEffortMean(s) > mid;
    if (i > p.first && above !== wasAbove) crossings += 1;
    if (above) {
      if (!wasAbove) phases += 1; // wasAbove starts false: the first segment opens a phase
      workSec += s.durationSec;
      workEffortSum += segEffortMean(s) * s.durationSec;
      if (s.rpm !== undefined && Number.isFinite(s.rpm) && s.rpm > 0) {
        rpmSum += s.rpm * s.durationSec;
        rpmSec += s.durationSec;
      }
    }
    wasAbove = above;
  }
  if (crossings < INTERVAL_MIN_CROSSINGS || phases === 0 || workSec <= 0) return steadyProfile;
  if (workSec / phases >= INTERVAL_MAX_WORK_SEC) return steadyProfile;
  // Long intervals (a work + rest cycle of MIN_SECTION_SEC or more) keep their sections as they
  // are, also when merging joined two of their repetitions (spec §2a).
  if (st.durationSec / phases >= MIN_SECTION_SEC) return steadyProfile;
  return {
    profile: 'intervals',
    workEffort: workEffortSum / workSec,
    rpm: rpmSec > 0 ? rpmSum / rpmSec : st.rpmMean,
    workShare: workSec / st.durationSec,
  };
}

/** Effort at `frac` (0..1) of a run of segments lasting `total` seconds, ramps interpolated. */
function effortAtFrac(segments: readonly Segment[], p: Piece, total: number, frac: number): number {
  let t = frac * total;
  for (let i = p.first; i <= p.last; i++) {
    const s = segments[i] as Segment;
    if (t <= s.durationSec || i === p.last) {
      const x = Math.min(1, Math.max(0, t / s.durationSec));
      return s.effortStart + (s.effortEnd - s.effortStart) * x;
    }
    t -= s.durationSec;
  }
  return 0;
}

/**
 * The effort trend of a run: its effort in `TREND_SLICES` slices, read as 'up' (the end is
 * `TREND_MIN_EFFORT` above the start, the top near the end), 'down' (the mirror) or 'pyramid' (the
 * middle is that far above both ends). Undefined for a flat run, a run too short for two songs, or
 * a trend that does not change the energy asked for by at least one step.
 */
function detectTrend(segments: readonly Segment[], p: Piece, st: Stats): SectionTrend | undefined {
  if (st.durationSec < TREND_MIN_SEC || st.effortMax - st.effortMin < TREND_MIN_EFFORT)
    return undefined;
  const curve: number[] = [];
  for (let i = 0; i < TREND_SLICES; i++) {
    let sum = 0;
    for (let k = 0; k < 4; k++)
      sum += effortAtFrac(segments, p, st.durationSec, (i + (k + 0.5) / 4) / TREND_SLICES);
    curve.push(sum / 4);
  }
  const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;
  const first = mean(curve.slice(0, 2));
  const last = mean(curve.slice(-2));
  const top = Math.max(...curve);
  const peakAt = curve.indexOf(top);
  let kind: TrendKind | undefined;
  if (
    top - first >= TREND_MIN_EFFORT &&
    top - last >= TREND_MIN_EFFORT &&
    peakAt >= 3 &&
    peakAt <= 8
  )
    kind = 'pyramid';
  else if (last - first >= TREND_MIN_EFFORT && top - last < TREND_MIN_EFFORT) kind = 'up';
  else if (first - last >= TREND_MIN_EFFORT && top - first < TREND_MIN_EFFORT) kind = 'down';
  if (!kind) return undefined;
  const energies = curve.map(energyOf);
  if (Math.max(...energies) - Math.min(...energies) < 1) return undefined;
  return { kind, curve };
}

/** The energy a trend asks for between `from` and `to` (fractions 0..1 of the part). */
export function trendEnergyAt(trend: SectionTrend, from: number, to: number): SectionEnergy {
  const n = trend.curve.length;
  const a = Math.min(1, Math.max(0, from)) * n;
  const b = Math.max(a + 1e-9, Math.min(1, Math.max(0, to)) * n);
  let sum = 0;
  let w = 0;
  for (let i = Math.floor(a); i < Math.min(n, Math.ceil(b)); i++) {
    const overlap = Math.min(b, i + 1) - Math.max(a, i);
    if (overlap <= 0) continue;
    sum += (trend.curve[i] as number) * overlap;
    w += overlap;
  }
  return energyOf(w > 0 ? sum / w : (trend.curve[n - 1] as number));
}

/**
 * The workout's music sections, in time order, covering the whole workout without gaps.
 * Empty for a workout without blocks.
 */
export function sectionsOf(w: Workout, opts: SectionOptions = {}): MusicSection[] {
  const table = opts.table ?? DEFAULT_EFFORT_TABLE;
  // Continuous ramps: the grouping must not depend on the rider's resistance mode.
  const segments = flattenWorkout(w, table, 'smart');
  if (segments.length === 0) return [];

  const split: Piece[] = [];
  for (const u of unitsOf(w, segments)) splitUnit(segments, u, split);
  const pieces = enforceLimit(segments, absorbShort(segments, mergeUnits(segments, split)));

  const warmupId = w.scaling?.warmupBlockId;
  const cooldownId = w.scaling?.cooldownBlockId;
  const topOf = topLevelIds(w);
  return pieces.map((p, i): MusicSection => {
    const st = statsOf(segments, p.first, p.last);
    const firstSeg = segments[p.first] as Segment;
    const blockRefs: BlockRef[] = [];
    for (let k = p.first; k <= p.last; k++) {
      const s = segments[k] as Segment;
      blockRefs.push({ blockId: s.blockId, rep: s.rep });
    }
    const isLast = i === pieces.length - 1;
    const top = topOf.get(firstSeg.blockId);
    const startsAtCooldown = cooldownId !== undefined && top === cooldownId;
    const startsAtWarmup = warmupId !== undefined && top === warmupId;
    let role: SectionRole;
    if (startsAtCooldown) role = 'cooldown';
    else if (i === 0 && ((startsAtWarmup && st.effortMean <= 5) || st.effortMax <= 4))
      role = 'warmup';
    else if (isLast && st.effortMean <= 3) role = 'cooldown';
    else role = roleOfEffort(st.effortMean);

    // A warm-up or cool-down with short bursts in it stays calm music: the profile only changes
    // how the music reads the work in between (music energy spec §2a).
    const calm = role === 'warmup' || role === 'cooldown';
    const prof = calm
      ? { profile: 'steady' as const, workEffort: st.effortMean, rpm: st.rpmMean, workShare: 1 }
      : intervalProfile(segments, p, st);
    if (prof.profile === 'intervals') role = roleOfWork(prof.workEffort);

    const section: MusicSection = {
      id: `s${i + 1}`,
      anchor: { blockId: firstSeg.blockId, rep: firstSeg.rep },
      startSec: st.startSec,
      durationSec: st.durationSec,
      blockRefs,
      role,
      effort: { min: st.effortMin, max: st.effortMax, mean: st.effortMean },
      rpmMean: prof.rpm,
      rpmKnown: st.rpmKnown,
      targetBpm: 2 * prof.rpm,
      energy:
        prof.profile === 'intervals'
          ? intervalEnergy(prof.workEffort, prof.workShare, st.effortMean)
          : energyOf(prof.workEffort),
      profile: prof.profile,
      workEffort: prof.workEffort,
    };
    if (!calm && prof.profile === 'steady') {
      const trend = detectTrend(segments, p, st);
      if (trend) section.trend = trend;
    }
    if (p.locked) section.locked = p.locked;
    return section;
  });
}

/** Segment block id -> the id of the top-level block it belongs to (itself, or its repeat). */
function topLevelIds(w: Workout): Map<string, string> {
  const map = new Map<string, string>();
  for (const b of w.blocks) {
    if (b.kind === 'repeat') for (const c of b.blocks) map.set(c.id, b.id);
    else map.set(b.id, b.id);
  }
  return map;
}

// ---------------------------------------------------------------------------------------------
// Coverage (step 1 of the wizard: which categories suit this workout)
// ---------------------------------------------------------------------------------------------

/**
 * A song counts for a category when it fits the sections of at least this share of the time. Half,
 * not most: a workout that alternates climbs (~65 rpm) and flats (~87 rpm) has no song that fits
 * 60% of it, and the wizard would dim every category although the planner fills each part well.
 */
export const COVERAGE_SHARE = 0.5;

/** What `coverage` needs of a song (a catalog track or a library song with categories). */
export interface CoverageTrack {
  /** Undefined = no clear beat: such a song fits the cool-down only. */
  bpm?: number;
  categories: readonly MusicCategoryId[];
}

export interface CoverageOptions {
  /** Tempo window for a fit (default `BPM_CLOSE`). */
  tolerance?: number;
  /** False = only songs on the beat at full speed count (no half/double time). Default true. */
  halfDouble?: boolean;
  /** Share of the (unlocked) time a song must fit; default `COVERAGE_SHARE`. */
  share?: number;
}

export interface CategoryCoverage {
  category: MusicCategoryId;
  /** Songs of the category that fit sections covering at least `share` of the time. */
  tracks: number;
}

/**
 * For each category (in the given order), how many songs fit the workout's tempo for at least
 * `share` of it (default `COVERAGE_SHARE`, half the time).
 * Locked sections are left out (their music is set); a cool-down fits any song (no beat needed).
 * Only dims chips and words a hint; never builds a queue.
 */
export function coverage(
  sections: readonly MusicSection[],
  tracks: readonly CoverageTrack[],
  categories: readonly MusicCategoryId[] = MUSIC_CATEGORIES,
  opts: CoverageOptions = {},
): CategoryCoverage[] {
  const tolerance = opts.tolerance ?? BPM_CLOSE;
  const halfDouble = opts.halfDouble ?? true;
  const share = opts.share ?? COVERAGE_SHARE;
  const open = sections.filter((s) => !s.locked);
  const total = open.reduce((sum, s) => sum + s.durationSec, 0);
  const counts = new Map<MusicCategoryId, number>();
  for (const c of categories) counts.set(c, 0);
  if (total > 0) {
    for (const t of tracks) {
      let fitSec = 0;
      for (const s of open) {
        if (s.role === 'cooldown') {
          fitSec += s.durationSec;
          continue;
        }
        if (t.bpm === undefined) continue; // no beat to match a cadence
        const m = matchBpm(t.bpm, s.rpmMean, { tolerance });
        if (m && (halfDouble || m.kind === 'exact')) fitSec += s.durationSec;
      }
      if (fitSec < share * total) continue;
      const cats = t.categories;
      for (let i = 0; i < cats.length; i++) {
        const c = cats[i] as MusicCategoryId;
        if (cats.indexOf(c) !== i) continue; // a category listed twice counts once
        const n = counts.get(c);
        if (n !== undefined) counts.set(c, n + 1);
      }
    }
  }
  return categories.map((category) => ({ category, tracks: counts.get(category) ?? 0 }));
}

/** The categories with the most fitting songs, best first (at most `limit`, none without songs). */
export function bestCategories(cov: readonly CategoryCoverage[], limit = 2): MusicCategoryId[] {
  return cov
    .map((c, i) => ({ c, i }))
    .filter((x) => x.c.tracks > 0)
    .sort((a, b) => b.c.tracks - a.c.tracks || a.i - b.i)
    .slice(0, Math.max(0, limit))
    .map((x) => x.c.category);
}
