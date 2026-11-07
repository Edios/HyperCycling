import { z } from 'zod';
import { planProgressSchema, type PlanProgress } from './plan';
import { atMostOneMe, playerSchema, type Player } from './player';
import { sessionLogSchema, type SessionLog } from './session-log';
import { settingsSchema, type Settings } from './settings';
import { workoutSchema, type Workout } from './workout';

/** Id written into new exports. */
export const APP_ID = 'hypercycling';
/** Ids accepted on import: the current one and the pre-rebrand one. */
export const ACCEPTED_APP_IDS = ['hypercycling', 'spinning-tutor'] as const;
export type AppId = (typeof ACCEPTED_APP_IDS)[number];

export interface ExportBundle {
  app: AppId;
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
    app: z.enum(ACCEPTED_APP_IDS),
    schemaVersion: z.literal(1),
    exportedAt: z.iso.datetime({ offset: true }),
    workouts: z.array(workoutSchema),
    players: z.array(playerSchema),
    planProgress: z.array(planProgressSchema),
    sessionLogs: z.array(sessionLogSchema),
    settings: settingsSchema.nullable(),
  })
  .superRefine((b, ctx) => {
    if (!atMostOneMe(b.players)) {
      ctx.addIssue({
        code: 'custom',
        message: 'at most one player can be marked isMe',
        path: ['players'],
      });
    }
    for (const key of ['workouts', 'players', 'planProgress', 'sessionLogs'] as const) {
      const seen = new Set<string>();
      b[key].forEach((item, i) => {
        if (seen.has(item.id)) {
          ctx.addIssue({
            code: 'custom',
            message: `duplicate id "${item.id}" in ${key}`,
            path: [key, i, 'id'],
          });
        }
        seen.add(item.id);
      });
    }
  }) as unknown as z.ZodType<ExportBundle>;

/**
 * Returns the bundle without credentials: Spotify tokens and the GetSongBPM key must never leave the device inside a
 * shareable file. The client ID and device choice are not secret and stay.
 */
export function stripSecrets(bundle: ExportBundle): ExportBundle {
  if (!bundle.settings) return bundle;
  if (bundle.settings.getSongBpmKey === undefined && !bundle.settings.spotify) return bundle;
  const settings = { ...bundle.settings };
  delete settings.getSongBpmKey;
  const spotify = settings.spotify;
  if (spotify) {
    const safe = { ...spotify };
    delete safe.accessToken;
    delete safe.refreshToken;
    delete safe.expiresAt;
    settings.spotify = safe;
  }
  return { ...bundle, settings };
}

/**
 * Validates an already-parsed bundle. Strings are refused: a server route must never be tricked
 * into running `JSON.parse` on a body it did not expect (use `parseExportBundle` for file text).
 */
export function parseExportBundleObject(data: unknown): ParseExportResult {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, reason: 'wrongApp' };
  }
  const rec = data as Record<string, unknown>;
  if (!ACCEPTED_APP_IDS.includes(rec.app as AppId)) return { ok: false, reason: 'wrongApp' };
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
  // A file must never plant credentials: tokens exist only in the local settings.
  return { ok: true, bundle: stripSecrets(r.data) };
}

/** Parses the text of an export file (client side); a non-string is validated as is. */
export function parseExportBundle(json: unknown): ParseExportResult {
  if (typeof json !== 'string') return parseExportBundleObject(json);
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { ok: false, reason: 'notJson' };
  }
  return parseExportBundleObject(data);
}
