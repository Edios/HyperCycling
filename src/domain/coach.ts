import { stepAt, type Segment } from './segments';

export type CoachCue =
  | { kind: 'custom'; text: string }
  | { kind: 'attack' }
  | { kind: 'standUp' }
  | { kind: 'sitDown' }
  | { kind: 'cadence'; rpm: number }
  | { kind: 'cadenceUp' }
  | { kind: 'cadenceDown' }
  /** Pre-cue for the next step of a stepped ramp; wording is by target, never by knob turns. */
  | { kind: 'addResistance'; effort: number; rpm?: number; inSec: number }
  | { kind: 'reduceResistance'; effort: number; rpm?: number; inSec: number }
  /** Announcement (M2) of the command that follows in `inSec` seconds. */
  | { kind: 'pre'; change: PreChange; inSec: number }
  | { kind: 'preCadence'; rpm: number; inSec: number }
  /** Closing after a change: `effort` for an attack or cadence, `position` after standing up. */
  | { kind: 'closing'; after: 'effort' | 'position' }
  /** The music goes quiet in `inSec` seconds (the closing silence of the class). */
  | { kind: 'silenceAhead'; inSec: number; quietSec: number };

export type PreChange = 'attack' | 'standUp' | 'sitDown' | 'cadenceUp' | 'cadenceDown';

export interface CueOptions {
  /** When false, cadence changes yield cadenceUp/cadenceDown instead of a number. Default true. */
  numericCadence?: boolean;
}

const ATTACK_EFFORT_JUMP = 3;
const CADENCE_DELTA = 15;

/**
 * Cue to announce when moving from `prev` into `next`.
 * Priority: custom cue > attack > position change > cadence change.
 * Inside a repeat only the first rep announces anything.
 */
export function cueForTransition(
  prev: Segment | undefined,
  next: Segment,
  opts: CueOptions = {},
): CoachCue | null {
  if (next.reps > 1 && next.rep > 1) return null;
  if (next.cue !== undefined) return { kind: 'custom', text: next.cue };
  if (!prev) return null;

  if (next.effortStart - prev.effortEnd >= ATTACK_EFFORT_JUMP) return { kind: 'attack' };

  if (
    prev.position !== undefined &&
    next.position !== undefined &&
    prev.position !== next.position
  ) {
    return next.position === 'standing' ? { kind: 'standUp' } : { kind: 'sitDown' };
  }

  if (prev.rpm !== undefined && next.rpm !== undefined) {
    const diff = next.rpm - prev.rpm;
    if (Math.abs(diff) >= CADENCE_DELTA) {
      if (opts.numericCadence ?? true) return { kind: 'cadence', rpm: next.rpm };
      return diff > 0 ? { kind: 'cadenceUp' } : { kind: 'cadenceDown' };
    }
  }
  return null;
}

/** Seconds before a step boundary at which the resistance cue is shown. */
export const PRE_CUE_SEC = 5;
/** A step change smaller than this (in %FTP) and on the same effort level is not worth a cue. */
const MIN_CUE_JUMP_PCT = 3;

/**
 * Pre-cue for the next step of a stepped ramp. Returns null outside the lead window, on the
 * last step, for changes below the minimum jump and for segments without steps. `key` is stable
 * for the whole window so the caller announces each step once (steps are at least minStep apart,
 * so this is at most one cue per minStep).
 */
export function stepPreCue(
  seg: Segment,
  segElapsedSec: number,
): { key: string; cue: CoachCue } | null {
  const steps = seg.steps;
  if (!steps || steps.length < 2) return null;
  const { index, nextInSec } = stepAt(seg, segElapsedSec);
  if (nextInSec === null || nextInSec <= 0 || nextInSec > PRE_CUE_SEC) return null;
  const cur = steps[index];
  const next = steps[index + 1];
  if (!cur || !next) return null;
  if (next.effort === cur.effort && Math.abs(next.ftpPct - cur.ftpPct) < MIN_CUE_JUMP_PCT) {
    return null;
  }
  const kind = next.ftpPct >= cur.ftpPct ? 'addResistance' : 'reduceResistance';
  return {
    key: `${seg.index}:${index + 1}`,
    cue: {
      kind,
      effort: next.effort,
      ...(seg.rpm !== undefined ? { rpm: seg.rpm } : {}),
      inSec: PRE_CUE_SEC,
    },
  };
}

/** Lead of the announcement before a command (M2: announce, command, closing). */
export const PRE_LEAD_SEC = 10;
/** A block that cannot hold at least this much lead gets no announcement. */
const MIN_LEAD_SEC = 3;
/** Entries closer than this are one change too many; the announcement wins. */
const MIN_CUE_GAP_SEC = 5;
/** A closing needs a block at least this long. */
const MIN_CLOSING_BLOCK_SEC = 40;
const CLOSING_AFTER_SEC = 20;
/** A plan entry is live this long after its time, then it is stale (seek, throttled tab). */
const PLAN_WINDOW_SEC = 1.5;

export interface PlannedCue {
  /** Workout-clock second at which the cue is shown. */
  atSec: number;
  key: string;
  cue: CoachCue;
}

export interface CuePlanOptions extends CueOptions {
  /** Seconds of closing silence in the music; adds the announcement 10 s before it starts. */
  silenceLastSec?: number;
}

const priority = (c: CoachCue): number =>
  c.kind === 'pre' || c.kind === 'preCadence' ? 3 : c.kind === 'silenceAhead' ? 2 : 1;

function preFor(change: CoachCue, inSec: number): CoachCue | null {
  switch (change.kind) {
    case 'attack':
    case 'standUp':
    case 'sitDown':
    case 'cadenceUp':
    case 'cadenceDown':
      return { kind: 'pre', change: change.kind, inSec };
    case 'cadence':
      return { kind: 'preCadence', rpm: change.rpm, inSec };
    default:
      return null;
  }
}

/**
 * The whole coaching script of a ride, built once: announcement 10 s before each command (shorter
 * in a short block), a closing after a longer effort, and the closing-silence notice. Entries are
 * on the workout clock, ascending and at least 5 s apart. Authored (custom) cues and repeat reps
 * get no announcement. Reading it per tick (`cuePlanAt`) allocates nothing.
 */
export function buildCuePlan(segments: Segment[], opts: CuePlanOptions = {}): PlannedCue[] {
  const raw: PlannedCue[] = [];
  let total = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i] as Segment;
    total = Math.max(total, seg.startSec + seg.durationSec);
    const end = seg.startSec + seg.durationSec;
    const next = segments[i + 1];
    if (next) {
      const change = cueForTransition(seg, next, opts);
      const lead = Math.min(PRE_LEAD_SEC, Math.floor(seg.durationSec / 2));
      if (change && change.kind !== 'custom' && lead >= MIN_LEAD_SEC) {
        const cue = preFor(change, lead);
        if (cue) raw.push({ atSec: end - lead, key: `pre:${i}`, cue });
      }
    }
    // Closing: the entry cue of this block was an effort/position change and the block is long.
    if (seg.durationSec >= MIN_CLOSING_BLOCK_SEC) {
      const entry = cueForTransition(segments[i - 1], seg, opts);
      if (
        entry &&
        (entry.kind === 'attack' ||
          entry.kind === 'standUp' ||
          entry.kind === 'cadence' ||
          entry.kind === 'cadenceUp')
      ) {
        raw.push({
          atSec: seg.startSec + CLOSING_AFTER_SEC,
          key: `close:${i}`,
          cue: { kind: 'closing', after: entry.kind === 'standUp' ? 'position' : 'effort' },
        });
      }
    }
  }
  const quiet = opts.silenceLastSec ?? 0;
  if (quiet > 0 && total - quiet - PRE_LEAD_SEC >= 0) {
    raw.push({
      atSec: total - quiet - PRE_LEAD_SEC,
      key: 'silence',
      cue: { kind: 'silenceAhead', inSec: PRE_LEAD_SEC, quietSec: quiet },
    });
  }
  raw.sort((a, b) => a.atSec - b.atSec);
  const out: PlannedCue[] = [];
  for (const e of raw) {
    const last = out[out.length - 1];
    if (last && e.atSec - last.atSec < MIN_CUE_GAP_SEC) {
      if (priority(e.cue) > priority(last.cue)) out[out.length - 1] = e;
      continue;
    }
    out.push(e);
  }
  return out;
}

/** The entry live at workout-clock second `t`, if any. No allocation. */
export function cuePlanAt(plan: PlannedCue[], t: number): PlannedCue | null {
  for (let i = 0; i < plan.length; i++) {
    const e = plan[i] as PlannedCue;
    if (e.atSec > t) return null;
    if (t < e.atSec + PLAN_WINDOW_SEC) return e;
  }
  return null;
}
