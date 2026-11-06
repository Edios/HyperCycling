import { z } from 'zod';
import { LANGS, type Lang, type Localized } from './lang';
import { flattenWorkout } from './segments';
import type { Workout } from './workout';

export type { Localized } from './lang';

export type PlanSlot = 'progres' | 'freestyle';

export interface Plan {
  id: string;
  name: string;
  description: string;
  localized?: Partial<Record<Lang, Localized>>;
  level: 'beginner' | 'intermediate' | 'short' | 'any';
  loop: boolean;
  weeks: {
    light: boolean;
    sessions: { slot: PlanSlot; workoutId: string }[];
    progresAlt?: string;
  }[];
}

export type PlanLayout = 'progresFreestyle' | 'doubleProgres' | 'plusFreestyle';

export interface PlanSettings {
  sessionMinutes: 30 | 45 | 60;
  difficulty: -5 | 0 | 5;
  layout: PlanLayout;
  startWeek: number;
  /** Replace the week-1 FTP test with the week's no-test session (FTP already known). */
  skipFirstTest?: boolean;
  /** Optional fixed riding weekdays, 0 = Monday .. 6 = Sunday. Absent or empty = default days. */
  trainingDays?: number[];
}

export const DEFAULT_PLAN_SETTINGS: PlanSettings = {
  sessionMinutes: 45,
  difficulty: 0,
  layout: 'progresFreestyle',
  startWeek: 1,
};

export interface ProgressEntry {
  week: number /*1-based*/;
  slot: PlanSlot;
  workoutId: string;
  status: 'done' | 'skipped';
  at: string;
  /** 1-based pass through a looping plan; absent means 1. */
  cycle?: number;
}

export interface PlanProgress {
  id: string /*= planId*/;
  planId: string;
  startedAt: string;
  settings: PlanSettings;
  entries: ProgressEntry[];
}

type SlotStatus = 'open' | 'done' | 'skipped';

const SLOT_ORDER: readonly PlanSlot[] = ['progres', 'freestyle'];
const HARD_FTP_PCT = 85;

const localizedSchema = z.object({ name: z.string(), description: z.string() });

export const planSchema: z.ZodType<Plan> = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  description: z.string(),
  localized: z
    .object(Object.fromEntries(LANGS.map((l) => [l, localizedSchema.optional()])))
    .optional(),
  level: z.enum(['beginner', 'intermediate', 'short', 'any']),
  loop: z.boolean(),
  weeks: z
    .array(
      z.object({
        light: z.boolean(),
        sessions: z.array(
          z.object({ slot: z.enum(['progres', 'freestyle']), workoutId: z.string().min(1) }),
        ),
        progresAlt: z.string().min(1).optional(),
      }),
    )
    .min(1),
}) as unknown as z.ZodType<Plan>; // zod infers `| undefined` on optionals; the declared interface is authoritative

export const planSettingsSchema: z.ZodType<PlanSettings> = z.object({
  sessionMinutes: z.union([z.literal(30), z.literal(45), z.literal(60)]),
  difficulty: z.union([z.literal(-5), z.literal(0), z.literal(5)]),
  layout: z.enum(['progresFreestyle', 'doubleProgres', 'plusFreestyle']),
  startWeek: z.number().int().min(1),
  skipFirstTest: z.boolean().optional(),
  trainingDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
}) as unknown as z.ZodType<PlanSettings>; // same optional-field inference caveat as planSchema

const progressEntrySchema = z.object({
  week: z.number().int().min(1),
  slot: z.enum(['progres', 'freestyle']),
  workoutId: z.string().min(1),
  status: z.enum(['done', 'skipped']),
  at: z.iso.datetime({ offset: true }),
  cycle: z.number().int().min(1).optional(),
});

export const planProgressSchema: z.ZodType<PlanProgress> = z.object({
  id: z.string().min(1),
  planId: z.string().min(1),
  startedAt: z.iso.datetime({ offset: true }),
  settings: planSettingsSchema,
  entries: z.array(progressEntrySchema),
}) as unknown as z.ZodType<PlanProgress>; // same optional-field inference caveat as planSchema

/** Progress schema that also checks startWeek and entry weeks against the plan length. */
export function planProgressSchemaFor(plan: Plan): z.ZodType<PlanProgress> {
  const weeks = plan.weeks.length;
  return planProgressSchema.superRefine((p, ctx) => {
    if (p.settings.startWeek > weeks) {
      ctx.addIssue({
        code: 'custom',
        message: `startWeek ${p.settings.startWeek} exceeds ${weeks} weeks`,
        path: ['settings', 'startWeek'],
      });
    }
    p.entries.forEach((e, i) => {
      if (e.week > weeks) {
        ctx.addIssue({
          code: 'custom',
          message: `entry week ${e.week} exceeds ${weeks} weeks`,
          path: ['entries', i, 'week'],
        });
      }
    });
  });
}

function sessionOf(plan: Plan, week: number, slot: PlanSlot): string | undefined {
  return plan.weeks[week - 1]?.sessions.find((s) => s.slot === slot)?.workoutId;
}

/**
 * Workout served by a slot. In `doubleProgres` the `freestyle` slot is served by the week's
 * `progresAlt` (fallback: the week's progres workout), so the slot name stays 'freestyle'.
 */
export function workoutOf(
  plan: Plan,
  week: number,
  slot: PlanSlot,
  layout: PlanLayout,
): string | undefined {
  if (slot === 'freestyle' && layout === 'doubleProgres') {
    return plan.weeks[week - 1]?.progresAlt ?? sessionOf(plan, week, 'progres');
  }
  return sessionOf(plan, week, slot);
}

function cycleOf(e: ProgressEntry): number {
  return e.cycle ?? 1;
}

function slotStatus(
  plan: Plan,
  p: PlanProgress,
  cycle: number,
  week: number,
  slot: PlanSlot,
): SlotStatus {
  if (workoutOf(plan, week, slot, p.settings.layout) === undefined) return 'skipped';
  // startWeek only shortens the first pass; later cycles of a looping plan start at week 1.
  if (cycle === 1 && week < p.settings.startWeek) return 'skipped';
  const found = p.entries.find((e) => cycleOf(e) === cycle && e.week === week && e.slot === slot);
  return found ? found.status : 'open';
}

function cycleClosed(plan: Plan, p: PlanProgress, cycle: number): boolean {
  for (let week = 1; week <= plan.weeks.length; week++) {
    for (const slot of SLOT_ORDER) {
      if (slotStatus(plan, p, cycle, week, slot) === 'open') return false;
    }
  }
  return true;
}

/** Latest cycle with entries; a looping plan whose cycle is fully closed moves on to the next. */
function activeCycle(plan: Plan, p: PlanProgress): number {
  const latest = p.entries.reduce((m, e) => Math.max(m, cycleOf(e)), 1);
  return plan.loop && cycleClosed(plan, p, latest) ? latest + 1 : latest;
}

/** Earliest week with an open slot in the active cycle, or null when the plan is finished. */
function currentWeek(plan: Plan, p: PlanProgress, cycle: number): number | null {
  for (let week = 1; week <= plan.weeks.length; week++) {
    if (SLOT_ORDER.some((slot) => slotStatus(plan, p, cycle, week, slot) === 'open')) return week;
  }
  return null;
}

export function weekStatus(
  plan: Plan,
  p: PlanProgress,
  week: number,
): Record<PlanSlot, SlotStatus> {
  const cycle = activeCycle(plan, p);
  return {
    progres: slotStatus(plan, p, cycle, week, 'progres'),
    freestyle: slotStatus(plan, p, cycle, week, 'freestyle'),
  };
}

/**
 * Next session to ride, or null when a non-looping plan is finished. `cycle` is the pass
 * through a looping plan; pass it back in `ProgressEntry.cycle` when recording the result.
 * In `doubleProgres` layout the returned slot is 'freestyle' but `workoutId` is the progres alt.
 */
export function nextSession(
  plan: Plan,
  p: PlanProgress,
): { week: number; slot: PlanSlot; workoutId: string; cycle: number } | null {
  const cycle = activeCycle(plan, p);
  const week = currentWeek(plan, p, cycle);
  if (week === null) return null;
  for (const slot of SLOT_ORDER) {
    if (slotStatus(plan, p, cycle, week, slot) !== 'open') continue;
    const workoutId = workoutOf(plan, week, slot, p.settings.layout);
    if (workoutId !== undefined) return { week, slot, workoutId, cycle };
  }
  return null;
}

/** Replaces the entry for the same cycle, week and slot. Does not mutate the input. */
export function recordEntry(p: PlanProgress, e: ProgressEntry): PlanProgress {
  const kept = p.entries.filter(
    (x) => !(cycleOf(x) === cycleOf(e) && x.week === e.week && x.slot === e.slot),
  );
  return { ...p, entries: [...kept, e] };
}

/** Drops the entry for the same cycle, week and slot (if any). Does not mutate the input. */
export function removeEntry(
  p: PlanProgress,
  key: { week: number; slot: PlanSlot; cycle?: number },
): PlanProgress {
  const cycle = key.cycle ?? 1;
  return {
    ...p,
    entries: p.entries.filter(
      (x) => !(cycleOf(x) === cycle && x.week === key.week && x.slot === key.slot),
    ),
  };
}

/** Current week if its freestyle slot is open and really freestyle (not doubleProgres). */
export function canCountFreestyle(plan: Plan, p: PlanProgress): { week: number } | null {
  if (p.settings.layout === 'doubleProgres') return null;
  const cycle = activeCycle(plan, p);
  const week = currentWeek(plan, p, cycle);
  if (week === null) return null;
  return slotStatus(plan, p, cycle, week, 'freestyle') === 'open' ? { week } : null;
}

/** `plusFreestyle` adds a third, never-blocking ride per week; it needs no progress entry. */
export function optionalExtraSlot(_plan: Plan, p: PlanProgress): boolean {
  return p.settings.layout === 'plusFreestyle';
}

/** Hard minutes (segments at or above 85 % FTP, ramps by mean) per week, 1 decimal. */
export function weeklyLoad(plan: Plan, getWorkout: (id: string) => Workout): number[] {
  return plan.weeks.map((week) => {
    let hardSec = 0;
    for (const s of week.sessions) {
      for (const seg of flattenWorkout(getWorkout(s.workoutId))) {
        if ((seg.ftpPctStart + seg.ftpPctEnd) / 2 >= HARD_FTP_PCT) hardSec += seg.durationSec;
      }
    }
    return Math.round((hardSec / 60) * 10) / 10;
  });
}

/** At least 80 % of the workout ridden. */
export function suggestCountTowardPlan(riddenSec: number, totalSec: number): boolean {
  return totalSec > 0 && riddenSec * 5 >= totalSec * 4;
}
