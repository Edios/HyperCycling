import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  musicPlayerShown,
  sessionConfigSchema,
  settingsSchema,
} from './settings';

describe('DEFAULT_SETTINGS', () => {
  it('has no watts (a plain knob bike), cadence on, RPM tile shown', () => {
    expect(DEFAULT_SETTINGS.equipment).toEqual({
      showsWatts: false,
      showsCadence: true,
      hideRpmTile: false,
    });
  });
  it('passes its own schema', () => {
    expect(settingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
  });
});

describe('settingsSchema', () => {
  it('loads settings saved with the removed knobSteps field and drops it, keeping the rest', () => {
    for (const knobSteps of [[2, 4, 6, 8, 10], [1, 2], 'junk', null]) {
      const r = settingsSchema.safeParse({
        ...DEFAULT_SETTINGS,
        resistanceMode: 'knob',
        bikeSetupDone: true,
        knobSteps,
      });
      expect(r.success).toBe(true);
      if (!r.success) return;
      expect('knobSteps' in r.data).toBe(false);
      expect(r.data.resistanceMode).toBe('knob');
      expect(r.data.bikeSetupDone).toBe(true);
      expect(r.data.equipment).toEqual(DEFAULT_SETTINGS.equipment);
    }
  });
  it('rejects effectsIntensity out of range', () => {
    expect(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, effectsIntensity: 1.5 }).success).toBe(
      false,
    );
    expect(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, effectsIntensity: -0.1 }).success).toBe(
      false,
    );
  });
  it('rejects more than 10 recent urls', () => {
    const urls = Array.from({ length: 11 }, (_, i) => `u${i}`);
    expect(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, recentYoutubeUrls: urls }).success).toBe(
      false,
    );
  });
  it('rejects a non increasing effort table', () => {
    const table = DEFAULT_SETTINGS.effortTable.map((r) => ({ ...r, ftpPct: 50 }));
    expect(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, effortTable: table }).success).toBe(
      false,
    );
  });
  it('accepts optional fields', () => {
    const r = settingsSchema.safeParse({
      ...DEFAULT_SETTINGS,
      lang: 'pl',
      activePlanId: 'x',
      spotify: { clientId: 'c', deviceId: 'd' },
      lastSession: { background: 'basic', hud: 'solo', playerIds: [], music: false },
    });
    expect(r.success).toBe(true);
  });
});

describe('the music player setting', () => {
  it('is shown unless the rider turned it off', () => {
    expect(DEFAULT_SETTINGS.showMusicPlayer).toBeUndefined();
    expect(musicPlayerShown(DEFAULT_SETTINGS)).toBe(true);
    expect(musicPlayerShown({ showMusicPlayer: true })).toBe(true);
    expect(musicPlayerShown({ showMusicPlayer: false })).toBe(false);
  });

  it("on a mobile device it starts off, and the rider's own choice wins everywhere", () => {
    expect(musicPlayerShown({}, false)).toBe(true);
    expect(musicPlayerShown({}, true)).toBe(false);
    // Saved values keep their meaning on both kinds of device.
    expect(musicPlayerShown({ showMusicPlayer: true }, true)).toBe(true);
    expect(musicPlayerShown({ showMusicPlayer: false }, true)).toBe(false);
    expect(musicPlayerShown({ showMusicPlayer: true }, false)).toBe(true);
    expect(musicPlayerShown({ showMusicPlayer: false }, false)).toBe(false);
  });

  it('is stored as a boolean and loads from settings saved before it existed', () => {
    expect(settingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
    const off = settingsSchema.parse({ ...DEFAULT_SETTINGS, showMusicPlayer: false });
    expect(off.showMusicPlayer).toBe(false);
    expect(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, showMusicPlayer: 'no' }).success).toBe(
      false,
    );
  });
});

describe('sessionConfigSchema', () => {
  it('rejects unknown hud', () => {
    expect(
      sessionConfigSchema.safeParse({
        background: 'basic',
        hud: 'nope',
        playerIds: [],
        music: false,
      }).success,
    ).toBe(false);
  });
});

describe('settingsSchema hyperrideWorld', () => {
  const withoutWorld: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  delete withoutWorld.hyperrideWorld;
  it('defaults to the neon tunnel when the field is missing', () => {
    const r = settingsSchema.safeParse(withoutWorld);
    expect(r.success && r.data.hyperrideWorld).toBe('neon-tunnel');
  });
  it('falls back to the neon tunnel for an unknown world id', () => {
    const r = settingsSchema.safeParse({ ...withoutWorld, hyperrideWorld: 'mars' });
    expect(r.success && r.data.hyperrideWorld).toBe('neon-tunnel');
  });
  it('keeps a known world id', () => {
    const r = settingsSchema.safeParse({ ...withoutWorld, hyperrideWorld: 'road' });
    expect(r.success && r.data.hyperrideWorld).toBe('road');
  });
  it('keeps the scenes world', () => {
    const r = settingsSchema.safeParse({ ...withoutWorld, hyperrideWorld: 'scenes' });
    expect(r.success && r.data.hyperrideWorld).toBe('scenes');
  });
});

describe('settingsSchema diagnostics and automatic quality', () => {
  it('stays valid without the diagnostics field and keeps it off by default', () => {
    expect(DEFAULT_SETTINGS.diagnostics).toBeUndefined();
    expect(settingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
  });
  it('accepts diagnostics true/false and rejects other types', () => {
    expect(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, diagnostics: true }).success).toBe(true);
    expect(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, diagnostics: 'yes' }).success).toBe(
      false,
    );
  });
  it('accepts the automatic quality value; the default stays high', () => {
    expect(DEFAULT_SETTINGS.hyperrideQuality).toBe('high');
    const r = settingsSchema.safeParse({ ...DEFAULT_SETTINGS, hyperrideQuality: 'auto' });
    expect(r.success && r.data.hyperrideQuality).toBe('auto');
    expect(
      settingsSchema.safeParse({ ...DEFAULT_SETTINGS, hyperrideQuality: 'ultra' }).success,
    ).toBe(false);
  });
});

describe('settingsSchema showHrZones', () => {
  it('parses without showHrZones and with a boolean', () => {
    expect(settingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
    expect(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, showHrZones: false }).success).toBe(
      true,
    );
    expect(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, showHrZones: 'x' }).success).toBe(false);
  });
});

describe('trainer settings', () => {
  it('default to sprint mode on and the cadence guard off; bad data falls back', async () => {
    const { resolveTrainerSettings, settingsSchema, DEFAULT_SETTINGS } = await import('./settings');
    expect(resolveTrainerSettings({})).toEqual({ sprintMode: true, cadenceGuard: false });
    expect(resolveTrainerSettings({ trainer: { sprintMode: false, cadenceGuard: true } })).toEqual({
      sprintMode: false,
      cadenceGuard: true,
    });
    const parsed = settingsSchema.parse({ ...DEFAULT_SETTINGS, trainer: { sprintMode: 'yes' } });
    expect(parsed.trainer).toBeUndefined();
  });
});
