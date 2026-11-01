import { z } from 'zod';
import type { PlanSlot } from './plan';
import type { EngineSnapshot } from './session-engine';
import { sessionConfigSchema, type SessionConfig } from './settings';
import { workoutSchema, type Workout } from './workout';

export interface SessionLog {
  id: string;
  workoutId: string;
  startedAt: string;
  endedAt: string;
  riddenSec: number;
  completed: boolean;
  playerIds: string[];
  config: SessionConfig;
}

export interface ActiveSession {
  workoutId: string;
  config: SessionConfig;
  snapshot: EngineSnapshot;
  savedAt: string;
  plan?: { planId: string; week: number; slot: PlanSlot; cycle?: number };
  /** The exact (scaled) workout that was ridden, so a resume never depends on current settings. */
  workout?: Workout;
}

export const sessionLogSchema: z.ZodType<SessionLog> = z.object({
  id: z.string().min(1),
  workoutId: z.string().min(1),
  startedAt: z.iso.datetime({ offset: true }),
  endedAt: z.iso.datetime({ offset: true }),
  riddenSec: z.number().min(0),
  completed: z.boolean(),
  playerIds: z.array(z.string()),
  config: sessionConfigSchema,
});

export const activeSessionSchema: z.ZodType<ActiveSession> = z.object({
  workoutId: z.string().min(1),
  config: sessionConfigSchema,
  snapshot: z.object({
    segmentIndex: z.number().int().min(0),
    workoutElapsedSec: z.number().min(0),
    status: z.enum(['paused', 'running']),
  }),
  savedAt: z.iso.datetime({ offset: true }),
  plan: z
    .object({
      planId: z.string().min(1),
      week: z.number().int().min(1),
      slot: z.enum(['progres', 'freestyle']),
      cycle: z.number().int().min(1).optional(),
    })
    .optional(),
  workout: workoutSchema.optional(),
}) as unknown as z.ZodType<ActiveSession>; // optional-field inference caveat

/** True when the saved session is at most `maxAgeMs` old; unparsable dates count as stale. */
export function isActiveSessionFresh(
  s: ActiveSession,
  nowIso: string,
  maxAgeMs = 2 * 3600_000,
): boolean {
  const saved = Date.parse(s.savedAt);
  const now = Date.parse(nowIso);
  if (Number.isNaN(saved) || Number.isNaN(now)) return false;
  return now - saved <= maxAgeMs;
}
