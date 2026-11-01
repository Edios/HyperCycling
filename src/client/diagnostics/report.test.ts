import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import { collectDeviceInfo } from './device-info';
import type { TestResult } from './recommendation';
import { buildReport } from './report';

const t = (key: string, vars?: Record<string, string | number>): string => {
  let cur: unknown = en;
  for (const p of key.split('.')) cur = (cur as Record<string, unknown>)[p];
  let s = String(cur);
  for (const [k, v] of Object.entries(vars ?? {})) s = s.replace(`{${k}}`, String(v));
  return s;
};

const info = collectDeviceInfo({
  navigator: { userAgent: 'UA/1.0', platform: 'Win32', hardwareConcurrency: 8 },
  screen: { width: 1920, height: 1080 },
  devicePixelRatio: 1,
  innerWidth: 1280,
  innerHeight: 720,
  createCanvas: () => ({ getContext: () => null }),
});

const result: TestResult = {
  world: 'road',
  quality: 'low',
  avgFps: 59.94,
  p5Fps: 48.2,
  slowPct: 1.234,
  width: 1280,
  height: 720,
};

describe('buildReport', () => {
  it('includes version, date and device info', () => {
    const text = buildReport({
      version: '2.0.0',
      date: new Date('2026-10-31T10:00:00Z'),
      info,
      results: [],
      t,
    });
    expect(text).toContain('2.0.0');
    expect(text).toContain('2026-10-31T10:00:00.000Z');
    expect(text).toContain('UA/1.0');
    expect(text).toContain('1920 x 1080');
    expect(text).toContain(en.diagnostics.report.noResults);
  });

  it('lists the last test results, one line each', () => {
    const text = buildReport({ version: '2.0.0', date: new Date(0), info, results: [result], t });
    expect(text).toContain('road');
    expect(text).toContain('59.9');
    expect(text).toContain('48.2');
    expect(text).toContain('1.2%');
    expect(text).toContain('1280x720');
    expect(text).not.toContain(en.diagnostics.report.noResults);
  });
});
