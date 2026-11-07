import { DEFAULT_EFFORT_TABLE, type EffortTable } from './effort';
import { flattenWorkout, type Segment } from './segments';
import { totalDurationSec, type Workout } from './workout';

/**
 * Dosing rules for a workout (cadence, standing, sprints, rest, warm-up, cool-down), written as one
 * pure function. The editor, the class card and the content tests all call it, so the rule set has
 * a single source of truth. Warnings never block saving: they are advice for the author.
 * Sources: docs research-a §5 and the instructor panel (M3).
 */

/** `standard` = a regular rider; `gentle` = the lighter variant (beginners, comeback, light weeks). */
export type DoseLevel = 'standard' | 'gentle';

export type DoseCode =
  | 'rpm-low'
  | 'rpm-high'
  | 'standing-rpm'
  | 'standing-light'
  | 'standing-bout'
  | 'standing-total'
  | 'sprint-long'
  | 'rest-short'
  | 'warmup-short'
  | 'cooldown-short';

export type DoseSeverity = 'info' | 'warn';

export interface DoseWarning {
  code: DoseCode;
  /** `warn` = against the rule; `info` = worth a look (deliberate in some formats, e.g. HIIT). */
  level: DoseSeverity;
  /** Leaf block that triggers it (first one when several do); absent for whole-workout rules. */
  blockId?: string;
  /** Workout time range the warning points at, seconds. */
  fromSec: number;
  toSec: number;
  /** Values for the i18n message `dose.<code>`. */
  params: Record<string, number>;
}

export interface DoseThresholds {
  rpmMin: number;
  rpmMax: number;
  /** Above this cadence only short bursts are fine. */
  rpmFast: number;
  rpmFastMaxSec: number;
  standingRpmMax: number;
  /** Standing below this %FTP is "standing without load". */
  standingMinFtpPct: number;
  standingBoutSec: number;
  standingTotalSec: number;
  sprintFtpPct: number;
  sprintMaxSec: number;
  /** Mean %FTP from which an effort counts as a hard work interval (effort 9). */
  hardFtpPct: number;
  /** Mean %FTP below which a stretch counts as rest. */
  restFtpPct: number;
  warmupMinSec: number;
  cooldownMinSec: number;
}

export const DOSE_THRESHOLDS: Record<DoseLevel, DoseThresholds> = {
  standard: {
    rpmMin: 60,
    rpmMax: 115,
    rpmFast: 110,
    rpmFastMaxSec: 30,
    standingRpmMax: 75,
    standingMinFtpPct: 55,
    standingBoutSec: 60,
    standingTotalSec: 7 * 60,
    sprintFtpPct: 140,
    sprintMaxSec: 30,
    hardFtpPct: 112,
    restFtpPct: 85,
    warmupMinSec: 5 * 60,
    cooldownMinSec: 4 * 60,
  },
  gentle: {
    rpmMin: 60,
    rpmMax: 110,
    rpmFast: 105,
    rpmFastMaxSec: 20,
    standingRpmMax: 70,
    standingMinFtpPct: 60,
    standingBoutSec: 30,
    standingTotalSec: 5 * 60,
    sprintFtpPct: 140,
    sprintMaxSec: 15,
    hardFtpPct: 112,
    restFtpPct: 85,
    warmupMinSec: 8 * 60,
    cooldownMinSec: 5 * 60,
  },
};

export interface DoseOptions {
  level?: DoseLevel;
  table?: EffortTable;
}

const mean = (s: Segment): number => (s.ftpPctStart + s.ftpPctEnd) / 2;
const peak = (s: Segment): number => Math.max(s.ftpPctStart, s.ftpPctEnd);

/** Whole-workout rules (warm-up, cool-down) are a hint, not a rule, for these. */
const isTest = (w: Workout): boolean => w.tags.includes('test');
const isHiit = (w: Workout): boolean => w.tags.includes('hiit') || w.tags.includes('sprint');

/** Warnings for one workout, in time order. Pure; the same input gives the same output. */
export function doseWarnings(w: Workout, opts: DoseOptions = {}): DoseWarning[] {
  const th = DOSE_THRESHOLDS[opts.level ?? 'standard'];
  const segs = flattenWorkout(w, opts.table ?? DEFAULT_EFFORT_TABLE);
  const out: DoseWarning[] = [];
  const seen = new Set<string>();
  const add = (x: DoseWarning): void => {
    // A repeated block raises the same warning every rep: report it once.
    const key = `${x.code}|${x.blockId ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(x);
  };
  const at = (s: Segment) => ({
    blockId: s.blockId,
    fromSec: s.startSec,
    toSec: s.startSec + s.durationSec,
  });

  let standingSec = 0;
  for (const s of segs) {
    if (s.rpm !== undefined) {
      if (s.rpm < th.rpmMin)
        add({ code: 'rpm-low', level: 'warn', ...at(s), params: { rpm: s.rpm, min: th.rpmMin } });
      else if (s.rpm > th.rpmMax || (s.rpm > th.rpmFast && s.durationSec > th.rpmFastMaxSec)) {
        add({
          code: 'rpm-high',
          level: 'warn',
          ...at(s),
          params: { rpm: s.rpm, max: th.rpmFast, sec: th.rpmFastMaxSec },
        });
      }
    }
    if (s.position === 'standing') {
      standingSec += s.durationSec;
      if (s.rpm !== undefined && s.rpm > th.standingRpmMax) {
        add({
          code: 'standing-rpm',
          level: 'warn',
          ...at(s),
          params: { rpm: s.rpm, max: th.standingRpmMax },
        });
      }
      if (peak(s) < th.standingMinFtpPct) {
        add({
          code: 'standing-light',
          level: 'warn',
          ...at(s),
          params: { pct: Math.round(peak(s)) },
        });
      }
      if (s.durationSec > th.standingBoutSec) {
        add({
          code: 'standing-bout',
          level: 'warn',
          ...at(s),
          params: { sec: s.durationSec, max: th.standingBoutSec },
        });
      }
    }
    if (!isTest(w) && s.ftpPctStart >= th.sprintFtpPct && s.durationSec > th.sprintMaxSec) {
      add({
        code: 'sprint-long',
        level: 'warn',
        ...at(s),
        params: { sec: s.durationSec, max: th.sprintMaxSec },
      });
    }
  }
  if (standingSec > th.standingTotalSec) {
    add({
      code: 'standing-total',
      level: 'warn',
      fromSec: 0,
      toSec: totalDurationSec(w),
      params: { min: Math.round(standingSec / 60), max: Math.round(th.standingTotalSec / 60) },
    });
  }

  // Rest after hard work: for every run of hard segments, the easy stretch after it should be at
  // least as long as the work (sprints: a rule; other hard efforts: advice; HIIT formats: advice).
  let i = 0;
  while (i < segs.length) {
    const first = segs[i]!;
    if (mean(first) < th.hardFtpPct) {
      i++;
      continue;
    }
    let j = i;
    let work = 0;
    let sprint = false;
    while (j < segs.length && mean(segs[j]!) >= th.hardFtpPct) {
      work += segs[j]!.durationSec;
      if (segs[j]!.ftpPctStart >= th.sprintFtpPct) sprint = true;
      j++;
    }
    let k = j;
    let rest = 0;
    while (k < segs.length && mean(segs[k]!) < th.restFtpPct) {
      rest += segs[k]!.durationSec;
      k++;
    }
    // No rest after the last effort is the cool-down rule's business; no easy stretch = not a rest case.
    if (j < segs.length && rest > 0 && rest < work) {
      const last = segs[k - 1]!;
      add({
        code: 'rest-short',
        level: sprint && !isHiit(w) && !isTest(w) ? 'warn' : 'info',
        blockId: segs[j]!.blockId,
        fromSec: first.startSec,
        toSec: last.startSec + last.durationSec,
        params: { work, rest },
      });
    }
    i = k > j ? k : j;
  }

  // Warm-up: no hard effort before the warm-up minimum.
  const firstHard = segs.find((s) => mean(s) >= th.hardFtpPct);
  if (firstHard && firstHard.startSec < th.warmupMinSec) {
    add({
      code: 'warmup-short',
      level: isTest(w) ? 'info' : 'warn',
      blockId: firstHard.blockId,
      fromSec: 0,
      toSec: firstHard.startSec,
      params: { have: Math.floor(firstHard.startSec / 60), min: th.warmupMinSec / 60 },
    });
  }

  // Cool-down: the easy stretch that closes the workout should last long enough (only matters if
  // there was real work). It may span several blocks, e.g. the last song of a class.
  if (segs.some((s) => mean(s) >= th.restFtpPct)) {
    let n = segs.length;
    let sec = 0;
    while (n > 0 && mean(segs[n - 1]!) < th.restFtpPct) {
      n--;
      sec += segs[n]!.durationSec;
    }
    const total = totalDurationSec(w);
    if (sec > 0 && sec < th.cooldownMinSec) {
      add({
        code: 'cooldown-short',
        level: 'warn',
        blockId: segs[n]?.blockId ?? segs[0]?.blockId,
        fromSec: total - sec,
        toSec: total,
        params: { have: Math.floor(sec / 60), min: th.cooldownMinSec / 60 },
      });
    }
  }

  return out.sort((a, b) => a.fromSec - b.fromSec);
}
