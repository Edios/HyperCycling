/**
 * Soundtrack Match, part 5: the plan the rider confirmed, as it is stored (spec §5.5-5.7).
 *
 * One record per workout (`id` = the workout's id): the plan is a snapshot of catalog ids, so a
 * later catalog does not change it. It is not health data, so it may travel in the backup. The
 * record carries its own `schemaVersion`: a later change of the plan's shape adds a version and a
 * reader that knows the old one, it never edits this one.
 */
import { z } from 'zod';
import { MUSIC_CATEGORIES } from './soundtrack';
import { YOUTUBE_ID } from './experience';
import type { SoundtrackPlan } from './soundtrack-plan';

export const SOUNDTRACK_RECORD_VERSION = 1;

export interface SoundtrackPlanRecord {
  /** The workout's id: one saved plan per workout. */
  id: string;
  schemaVersion: typeof SOUNDTRACK_RECORD_VERSION;
  /** When the rider confirmed the plan (stamped on save: the planner itself has no clock). */
  createdAt: string;
  plan: SoundtrackPlan;
}

const MAX_SECTIONS = 40;
/** A cue plays its track and at most 12 more (`MAX_QUEUE`). */
const MAX_PICKS = 13;
const MAX_FALLBACK = 4;
const SEC = z.number().finite().min(0).max(86_400);

const pickSchema = z.object({
  ref: z.object({ kind: z.literal('catalog'), id: z.string().min(1).max(80) }),
  upload: z.string().regex(YOUTUBE_ID),
  startAtSec: SEC,
  atSec: SEC,
  playSec: SEC,
  fit: z.enum(['on-beat', 'close', 'half', 'double', 'off', 'nobeat']),
});

const sectionSchema = z.object({
  sectionId: z.string().min(1).max(40),
  anchor: z.object({ blockId: z.string().min(1).max(200), rep: z.number().int().min(1).max(1000) }),
  startSec: SEC,
  durationSec: SEC,
  role: z.enum(['warmup', 'steady', 'tempo', 'hard', 'peak', 'cooldown']),
  rpm: z.number().finite().min(0).max(300),
  locked: z.enum(['cooldownTrack', 'userCue']).optional(),
  picks: z.array(pickSchema).max(MAX_PICKS),
  report: z.object({
    gapSec: SEC,
    cutSec: SEC,
    relaxed: z.array(z.enum(['tolerance', 'category', 'anyCategory', 'bpm', 'polish'])).max(8),
    warn: z.array(z.enum(['none', 'bpm', 'gap', 'cut'])).max(8),
    fills: z.array(z.enum(['longer', 'reserve', 'loop', 'fallback'])).max(8),
  }),
});

const prefsSchema = z.object({
  v: z.literal(1),
  categories: z.array(z.enum(MUSIC_CATEGORIES)).max(MUSIC_CATEGORIES.length),
  includeLibrary: z.boolean(),
  continuity: z.enum(['seamless', 'gapsOk']),
  explicit: z.boolean(),
  allowHalfDouble: z.boolean(),
  seed: z
    .number()
    .int()
    .min(0)
    .max(2 ** 31),
});

export const soundtrackPlanSchema = z.object({
  v: z.literal(1),
  workoutId: z.string().min(1).max(200),
  fingerprint: z.string().regex(/^[0-9a-f]{8}$/),
  prefs: prefsSchema,
  sections: z.array(sectionSchema).max(MAX_SECTIONS),
  fallback: z.array(pickSchema).max(MAX_FALLBACK),
}) as unknown as z.ZodType<SoundtrackPlan>; // optional-field inference caveat

export const soundtrackPlanRecordSchema = z
  .object({
    id: z.string().min(1).max(200),
    schemaVersion: z.literal(SOUNDTRACK_RECORD_VERSION),
    createdAt: z.iso.datetime({ offset: true }),
    plan: soundtrackPlanSchema,
  })
  .refine((r) => r.plan.workoutId === r.id, {
    message: 'the plan is for another workout than the record',
    path: ['plan', 'workoutId'],
  }) as unknown as z.ZodType<SoundtrackPlanRecord>;

/** The record for a plan the rider just confirmed. */
export function planRecord(plan: SoundtrackPlan, now: Date): SoundtrackPlanRecord {
  return {
    id: plan.workoutId,
    schemaVersion: SOUNDTRACK_RECORD_VERSION,
    createdAt: now.toISOString(),
    plan,
  };
}
