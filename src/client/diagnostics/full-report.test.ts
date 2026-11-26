import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import { collectDeviceInfo } from './device-info';
import { buildFullReport, shortUserAgent } from './full-report';

const t = (key: string, vars?: Record<string, string | number>): string => {
  let cur: unknown = en;
  for (const p of key.split('.')) cur = (cur as Record<string, unknown>)[p];
  let s = String(cur);
  for (const [k, v] of Object.entries(vars ?? {})) s = s.replace(`{${k}}`, String(v));
  return s;
};

const info = collectDeviceInfo({
  navigator: { userAgent: 'UA/1.0', platform: 'Win32' },
  screen: { width: 1920, height: 1080 },
  devicePixelRatio: 1,
  innerWidth: 1280,
  innerHeight: 720,
  createCanvas: () => ({ getContext: () => null }),
});

const base = {
  version: '2.1.0',
  date: new Date('2026-11-26T10:00:00Z'),
  screen: '#/train',
  info,
  viewport: '1280x720@1 vv720 dvh720 svh720 lvh720 safe 0/0/0/0 landscape',
  results: [],
  settings: { lang: 'en', spotify: { clientId: 'CLIENT42', accessToken: 'SECRETTOK' } },
  devices: {
    supported: true,
    trainer: { status: 'connected' as const, name: 'Flux S' },
    hr: { status: 'none' as const },
  },
  bleLog: '2026-11-26T09:59:00.000Z trainer rx 0A 1B',
  musicLog:
    '2026-11-26T09:58:00.000Z failed #0 spotify:x https://open.spotify.com/playlist/PRIVATE123',
  webglLog: '',
  errors: '10:59:01 console.error: refresh failed access_token=abc.def',
  t,
};

describe('buildFullReport', () => {
  it('has one section each for the app, viewport, settings, Bluetooth, music and errors', () => {
    const text = buildFullReport(base);
    for (const heading of [
      'HyperCycling diagnostics report',
      'App version: 2.1.0',
      'Screen: #/train',
      '== Viewport ==',
      '== Settings (no secrets) ==',
      '== Bluetooth ==',
      'Trainer: connected (Flux S)',
      'Heart-rate strap: none',
      'trainer rx 0A 1B',
      'Music: recent attempts',
      '== Errors and warnings ==',
      'refresh failed',
    ]) {
      expect(text).toContain(heading);
    }
  });

  it('masks keys, tokens and private playlist links everywhere', () => {
    const text = buildFullReport(base);
    expect(text).not.toContain('PRIVATE123');
    expect(text).not.toContain('abc.def');
    expect(text).not.toContain('CLIENT42');
    expect(text).not.toContain('SECRETTOK');
  });

  it('says plainly when a log is empty', () => {
    const text = buildFullReport({ ...base, bleLog: '', errors: '', devices: undefined });
    expect(text).toContain('No Bluetooth events.');
    expect(text).toContain('No errors recorded.');
  });
});

describe('shortUserAgent', () => {
  it('names the browser and system', () => {
    expect(
      shortUserAgent(
        'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
      ),
    ).toBe('Chrome 131 / Android');
    expect(
      shortUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari 18 / iOS');
    expect(
      shortUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
      ),
    ).toBe('Edge 131 / Windows');
    expect(
      shortUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0'),
    ).toBe('Firefox 133 / Linux');
    expect(shortUserAgent('weird')).toBe('weird');
  });
});
