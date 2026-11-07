import { effortToFtpPct } from './effort';
import {
  totalDurationSec,
  workoutSchema,
  type Intensity,
  type RepeatBlock,
  type Workout,
} from './workout';

const STEP_SEC = 30;
const WARMUP_RANGE_SEC = [5 * 60, 15 * 60] as const;
const COOLDOWN_RANGE_SEC = [3 * 60, 10 * 60] as const;
const MIN_REPEAT_TIMES = 2;
const MIN_FTP_PCT = 20;
const MAX_FTP_PCT = 200;

function scaleIntensity(i: Intensity, difficultyPct: number): Intensity {
  const base = i.ftpPct ?? (i.effort === undefined ? undefined : effortToFtpPct(i.effort));
  if (base === undefined) return i;
  const pct = Math.round((base * (100 + difficultyPct)) / 100);
  return { ftpPct: Math.min(MAX_FTP_PCT, Math.max(MIN_FTP_PCT, pct)) };
}

/**
 * Shift `durationSec` of a block by whole 30 s steps toward `deltaSec`, staying within
 * [min, max]. A block already outside the range is never pushed further out.
 * Returns the seconds actually added (may be negative).
 */
function stretch(current: number, deltaSec: number, range: readonly [number, number]): number {
  const lowSteps = Math.min(0, Math.ceil((range[0] - current) / STEP_SEC));
  const highSteps = Math.max(0, Math.floor((range[1] - current) / STEP_SEC));
  const steps = Math.min(highSteps, Math.max(lowSteps, Math.round(deltaSec / STEP_SEC)));
  return steps * STEP_SEC;
}

/**
 * Scales a workout to a target length and difficulty. Returns a new workout.
 *
 * 1. Difficulty multiplies every intensity (except warm-up/cool-down when `scaling` exists)
 *    and stores the result as ftpPct (effort-only intensities go through the default table).
 * 2. Without `scaling` nothing else changes.
 * 3. Otherwise the flex repeat's `times` moves within [minTimes, maxTimes] (defaults: 2 and
 *    the current count) to land closest to the target, then the warm-up (5-15 min) and
 *    cool-down (3-10 min) absorb the rest in 30 s steps, warm-up first.
 * A music cue on a removed repetition moves to the new last one unless that
 * block already has a cue there (then it is dropped).
 */
export function scaleWorkout(
  w: Workout,
  opts: { targetMinutes: 30 | 45 | 60; difficultyPct: -5 | 0 | 5 },
): Workout {
  const out = structuredClone(w);
  const sc = out.scaling;

  if (opts.difficultyPct !== 0) {
    for (const b of out.blocks) {
      if (sc && (b.id === sc.warmupBlockId || b.id === sc.cooldownBlockId)) continue;
      const children = b.kind === 'repeat' ? b.blocks : [b];
      for (const c of children) {
        if (c.kind === 'steady') c.intensity = scaleIntensity(c.intensity, opts.difficultyPct);
        else {
          c.from = scaleIntensity(c.from, opts.difficultyPct);
          c.to = scaleIntensity(c.to, opts.difficultyPct);
        }
      }
    }
  }

  // Class-format workouts keep their song lengths: stretching the warm-up would distort the slots.
  if (sc && out.format !== 'songs') {
    const targetSec = opts.targetMinutes * 60;
    const repeat = out.blocks.find(
      (b): b is RepeatBlock => b.kind === 'repeat' && b.id === sc.flexRepeatId,
    );

    if (repeat) {
      const perRep = repeat.blocks.reduce((s, c) => s + c.durationSec, 0);
      const base = totalDurationSec(out) - repeat.times * perRep;
      const min = sc.minTimes ?? MIN_REPEAT_TIMES;
      const max = Math.max(min, sc.maxTimes ?? repeat.times);
      let best = min;
      for (let t = min; t <= max; t++) {
        if (Math.abs(base + t * perRep - targetSec) < Math.abs(base + best * perRep - targetSec)) {
          best = t;
        }
      }
      repeat.times = best;
      const childIds = new Set(repeat.blocks.map((child) => child.id));
      const taken = new Set(
        out.musicCues
          .filter((c) => childIds.has(c.blockId) && c.rep === best)
          .map((c) => c.blockId),
      );
      out.musicCues = out.musicCues.flatMap((c) => {
        if (!childIds.has(c.blockId) || c.rep <= best) return [c];
        if (taken.has(c.blockId)) return [];
        taken.add(c.blockId);
        return [{ ...c, rep: best }];
      });
    }

    const warmup = out.blocks.find((b) => b.id === sc.warmupBlockId);
    if (warmup && warmup.kind !== 'repeat') {
      warmup.durationSec += stretch(
        warmup.durationSec,
        targetSec - totalDurationSec(out),
        WARMUP_RANGE_SEC,
      );
    }
    const cooldown = out.blocks.find((b) => b.id === sc.cooldownBlockId);
    if (cooldown && cooldown.kind !== 'repeat') {
      cooldown.durationSec += stretch(
        cooldown.durationSec,
        targetSec - totalDurationSec(out),
        COOLDOWN_RANGE_SEC,
      );
    }
  }

  return workoutSchema.parse(out);
}

/** Plan session length and difficulty applied to a workout. Tests (tag `test`) are never scaled. */
export function scaleForPlan(
  w: Workout,
  settings: { sessionMinutes: 30 | 45 | 60; difficulty: -5 | 0 | 5 },
): Workout {
  if (w.tags.includes('test')) return w;
  return scaleWorkout(w, {
    targetMinutes: settings.sessionMinutes,
    difficultyPct: settings.difficulty,
  });
}
