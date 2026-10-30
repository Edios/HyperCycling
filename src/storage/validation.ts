import type { z } from 'zod';
import { exportBundleSchema, type ExportBundle } from '../domain/export-bundle';
import { planProgressSchema } from '../domain/plan';
import { playerSchema } from '../domain/player';
import { activeSessionSchema, sessionLogSchema } from '../domain/session-log';
import { settingsSchema } from '../domain/settings';
import { workoutSchema } from '../domain/workout';

export const schemas = {
  workouts: workoutSchema,
  players: playerSchema,
  planProgress: planProgressSchema,
  sessionLogs: sessionLogSchema,
  settings: settingsSchema,
  activeSession: activeSessionSchema,
} as const;

/** Parses with a domain schema and throws a readable error; the parsed value is what gets stored. */
export function validate<T>(what: string, schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) {
    const i = r.error.issues[0];
    throw new Error(`Invalid ${what}: ${i ? `${i.path.join('.')}: ${i.message}` : 'invalid'}`);
  }
  return r.data;
}

export function validateBundle(value: unknown): ExportBundle {
  return validate('export bundle', exportBundleSchema, value);
}

export const byId = (a: { id: string }, b: { id: string }): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
