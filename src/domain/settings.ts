import { z } from 'zod';
import { DEFAULT_EFFORT_TABLE, effortTableSchema, type EffortTable } from './effort';
import { LANGS, type Lang } from './lang';

/** World worlds the rider can pick; the client registry (worlds/index.ts) implements them. */
export const WORLD_SETTING_IDS = ['neon-tunnel', 'road', 'scenes'] as const;
export type WorldSettingId = (typeof WORLD_SETTING_IDS)[number];
export const DEFAULT_WORLD_SETTING: WorldSettingId = 'neon-tunnel';

/** How ramps are ridden: stepped for a manual knob, stepped with a power hint, or continuous. */
export const RESISTANCE_MODES = ['knob', 'knobPower', 'smart'] as const;
export type ResistanceMode = (typeof RESISTANCE_MODES)[number];

export interface Equipment {
  showsWatts: boolean;
  showsCadence: boolean;
  hideRpmTile: boolean;
}

export interface SessionConfig {
  /** 'hyperride' is the stored id of the World background (kept so saved data keeps loading). */
  background: 'basic' | 'hyperride' | 'youtube';
  youtubeUrl?: string;
  hud: 'solo' | 'players' | 'immersive' | 'column' | 'cockpit' | 'tunnelTime' | 'focus';
  /** Riders panel on or off; undefined = on whenever riders are selected (older saved sessions). */
  showRiders?: boolean;
  playerIds: string[];
  music: boolean;
}

export interface SpotifySettings {
  clientId: string;
  deviceId?: string;
  /** OAuth tokens; stored locally only and removed from export bundles (see stripSecrets). */
  accessToken?: string;
  refreshToken?: string;
  /** Epoch milliseconds at which `accessToken` expires. */
  expiresAt?: number;
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
  /** Stored key names (hyperride*) are kept for saved data; the feature is called World. */
  hyperrideQuality: 'high' | 'low' | 'auto';
  hyperrideWorld: WorldSettingId;
  /**
   * Absent in settings stored before stepped effort existed: those riders keep smooth ramps
   * (resolveResistanceMode gives 'smart'); fresh profiles start with 'knob'.
   */
  resistanceMode?: ResistanceMode;
  /** True once the "your bike" step was finished or skipped; it is not offered again. */
  bikeSetupDone?: boolean;
  /** Knob positions the rider uses for S1..S5 (five ascending whole numbers); see domain/bike. */
  knobSteps?: number[];
  /** Diagnostics mode: live FPS overlay while training, device info and performance test. */
  diagnostics?: boolean;
  /** Show heart-rate zones; undefined = on when the "me" player has an HRmax. */
  showHrZones?: boolean;
  activePlanId?: string;
  lastSession?: SessionConfig;
  spotify?: SpotifySettings;
  /** GetSongBPM API key for the BPM lookup; a credential: never logged, left out of exports. */
  getSongBpmKey?: string;
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
  hud: z.enum(['solo', 'players', 'immersive', 'column', 'cockpit', 'tunnelTime', 'focus']),
  showRiders: z.boolean().optional(),
  playerIds: z.array(z.string()).max(10),
  music: z.boolean(),
}) as unknown as z.ZodType<SessionConfig>; // optional-field inference caveat

export const spotifySettingsSchema: z.ZodType<SpotifySettings> = z.object({
  clientId: z.string(),
  deviceId: z.string().optional(),
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  expiresAt: z.number().optional(),
}) as unknown as z.ZodType<SpotifySettings>; // optional-field inference caveat

export const settingsSchema: z.ZodType<Settings> = z.object({
  lang: z.enum(LANGS).optional(),
  effortTable: effortTableSchema,
  equipment: equipmentSchema,
  basicTheme: z.enum(['dark', 'light']),
  sounds: z.boolean(),
  coach: z.boolean(),
  effectsIntensity: z.number().min(0).max(1),
  hyperrideQuality: z.enum(['high', 'low', 'auto']),
  hyperrideWorld: z.enum(WORLD_SETTING_IDS).catch(DEFAULT_WORLD_SETTING),
  resistanceMode: z.enum(RESISTANCE_MODES).optional().catch(undefined),
  bikeSetupDone: z.boolean().optional(),
  knobSteps: z.array(z.number().int().min(1).max(99)).length(5).optional().catch(undefined),
  diagnostics: z.boolean().optional(),
  showHrZones: z.boolean().optional(),
  activePlanId: z.string().optional(),
  lastSession: sessionConfigSchema.optional(),
  spotify: spotifySettingsSchema.optional(),
  getSongBpmKey: z.string().optional(),
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
  hyperrideWorld: DEFAULT_WORLD_SETTING,
  resistanceMode: 'knob',
  recentYoutubeUrls: [],
};

/** The effective mode: a stored object without the field is an existing rider and stays smooth. */
export function resolveResistanceMode(s: Pick<Settings, 'resistanceMode'>): ResistanceMode {
  return RESISTANCE_MODES.find((m) => m === s.resistanceMode) ?? 'smart';
}

/** A stored world id when this build knows it, else the default (missing or from a newer build). */
export function parseWorldSetting(value: unknown): WorldSettingId {
  return WORLD_SETTING_IDS.find((id) => id === value) ?? DEFAULT_WORLD_SETTING;
}
