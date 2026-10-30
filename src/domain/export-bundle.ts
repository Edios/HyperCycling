import { z } from 'zod';
import { planProgressSchema, type PlanProgress } from './plan';
import { playerSchema, type Player } from './player';
import { sessionLogSchema, type SessionLog } from './session-log';
import { settingsSchema, type Settings } from './settings';
import { workoutSchema, type Workout } from './workout';

export interface ExportBundle {
  app: 'spinning-tutor';
  schemaVersion: 1;
  exportedAt: string;
  workouts: Workout[];
  players: Player[];
  planProgress: PlanProgress[];
  sessionLogs: SessionLog[];
  settings: Settings | null;
}

export type ParseExportResult =
  | { ok: true; bundle: ExportBundle }
  | {
      ok: false;
      reason: 'notJson' | 'wrongApp' | 'unsupportedVersion' | 'invalid';
      details?: string;
    };

export const exportBundleSchema: z.ZodType<ExportBundle> = z
  .object({
    app: z.literal('spinning-tutor'),
    schemaVersion: z.literal(1),
    exportedAt: z.string(),
    workouts: z.array(workoutSchema),
    players: z.array(playerSchema),
    planProgress: z.array(planProgressSchema),
    sessionLogs: z.array(sessionLogSchema),
    settings: settingsSchema.nullable(),
  })
  .superRefine((b, ctx) => {
    if (b.players.filter((p) => p.isMe).length > 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'at most one player can be marked isMe',
        path: ['players'],
      });
    }
  }) as unknown as z.ZodType<ExportBundle>;

export function parseExportBundle(json: unknown): ParseExportResult {
  let data: unknown = json;
  if (typeof json === 'string') {
    try {
      data = JSON.parse(json);
    } catch {
      return { ok: false, reason: 'notJson' };
    }
  }
  if (typeof data !== 'object' || data === null) return { ok: false, reason: 'wrongApp' };
  const rec = data as Record<string, unknown>;
  if (rec.app !== 'spinning-tutor') return { ok: false, reason: 'wrongApp' };
  if (rec.schemaVersion !== 1) return { ok: false, reason: 'unsupportedVersion' };
  const r = exportBundleSchema.safeParse(data);
  if (!r.success) {
    const i = r.error.issues[0];
    return {
      ok: false,
      reason: 'invalid',
      details: i ? `${i.path.join('.')}: ${i.message}` : 'invalid',
    };
  }
  return { ok: true, bundle: r.data };
}
