import { z } from 'zod';
import { DEFAULT_EFFORT_TABLE, effortTableSchema, type EffortTable } from './effort';
import { LANGS, type Lang } from './lang';

export interface Equipment {
  showsWatts: boolean;
  showsCadence: boolean;
  hideRpmTile: boolean;
}

export interface SessionConfig {
  background: 'basic' | 'hyperride' | 'youtube';
  youtubeUrl?: string;
  hud: 'solo' | 'players' | 'immersive' | 'column' | 'cockpit' | 'tunnelTime';
  playerIds: string[];
  music: boolean;
}

export interface Settings {
  lang?: Lang;
  effortTable: EffortTable;
  equipment: Equipment;
  basicTheme: 'dark' | 'light';
  sounds: boolean;
  coach: boolean;
  /** 0..1 */
  effectsIntensity: number;
  hyperrideQuality: 'high' | 'low';
  activePlanId?: string;
  lastSession?: SessionConfig;
  spotify?: { clientId: string; deviceId?: string };
  /** Max 10 entries. */
  recentYoutubeUrls: string[];
}

export const equipmentSchema: z.ZodType<Equipment> = z.object({
  showsWatts: z.boolean(),
  showsCadence: z.boolean(),
  hideRpmTile: z.boolean(),
});

export const sessionConfigSchema: z.ZodType<SessionConfig> = z.object({
  background: z.enum(['basic', 'hyperride', 'youtube']),
  youtubeUrl: z.string().optional(),
  hud: z.enum(['solo', 'players', 'immersive', 'column', 'cockpit', 'tunnelTime']),
  playerIds: z.array(z.string()),
  music: z.boolean(),
}) as unknown as z.ZodType<SessionConfig>; // optional-field inference caveat

export const settingsSchema: z.ZodType<Settings> = z.object({
  lang: z.enum(LANGS).optional(),
  effortTable: effortTableSchema,
  equipment: equipmentSchema,
  basicTheme: z.enum(['dark', 'light']),
  sounds: z.boolean(),
  coach: z.boolean(),
  effectsIntensity: z.number().min(0).max(1),
  hyperrideQuality: z.enum(['high', 'low']),
  activePlanId: z.string().optional(),
  lastSession: sessionConfigSchema.optional(),
  spotify: z.object({ clientId: z.string(), deviceId: z.string().optional() }).optional(),
  recentYoutubeUrls: z.array(z.string()).max(10),
}) as unknown as z.ZodType<Settings>; // optional-field inference caveat

export const DEFAULT_SETTINGS: Settings = {
  effortTable: DEFAULT_EFFORT_TABLE,
  equipment: { showsWatts: true, showsCadence: true, hideRpmTile: false },
  basicTheme: 'dark',
  sounds: true,
  coach: true,
  effectsIntensity: 1,
  hyperrideQuality: 'high',
  recentYoutubeUrls: [],
};
