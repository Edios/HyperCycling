import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sessionConfigSchema, settingsSchema } from './settings';

describe('DEFAULT_SETTINGS', () => {
  it('has watts on, cadence on, RPM tile shown', () => {
    expect(DEFAULT_SETTINGS.equipment).toEqual({
      showsWatts: true,
      showsCadence: true,
      hideRpmTile: false,
    });
  });
  it('passes its own schema', () => {
    expect(settingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
  });
});

describe('settingsSchema', () => {
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
