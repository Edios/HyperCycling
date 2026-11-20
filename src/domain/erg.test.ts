import { describe, expect, it } from 'vitest';
import {
  clampBias,
  controlModeFor,
  DEFAULT_POWER_RANGE,
  ergTargetWatts,
  GUARD_IDLE,
  guardFactor,
  isSprint,
  rampValue,
  sanePowerRange,
  shouldWrite,
  startRamp,
  stepGuard,
  type GuardState,
} from './erg';

describe('ergTargetWatts', () => {
  it('is FTP × %FTP, rounded', () => {
    expect(ergTargetWatts({ ftp: 250, ftpPct: 80 })).toBe(200);
    expect(ergTargetWatts({ ftp: 237, ftpPct: 55 })).toBe(130);
  });

  it('applies the ±% bias, clamped to ±50 %', () => {
    expect(ergTargetWatts({ ftp: 200, ftpPct: 100, biasPct: 5 })).toBe(210);
    expect(ergTargetWatts({ ftp: 200, ftpPct: 100, biasPct: -10 })).toBe(180);
    expect(ergTargetWatts({ ftp: 200, ftpPct: 100, biasPct: 90 })).toBe(300);
    expect(clampBias(-70.4)).toBe(-50);
  });

  it('caps at 200 % FTP and clamps to the trainer range and step', () => {
    expect(ergTargetWatts({ ftp: 300, ftpPct: 250 })).toBe(600);
    const range = { min: 50, max: 400, step: 5 };
    expect(ergTargetWatts({ ftp: 200, ftpPct: 10, range })).toBe(50);
    expect(ergTargetWatts({ ftp: 300, ftpPct: 180, range })).toBe(400);
    expect(ergTargetWatts({ ftp: 203, ftpPct: 100, range })).toBe(205);
    expect(ergTargetWatts({ ftp: 202, ftpPct: 100, range })).toBe(200);
  });
});

describe('sanePowerRange', () => {
  it('keeps a sensible range and replaces a broken one', () => {
    const good = { min: 0, max: 1500, step: 1 };
    expect(sanePowerRange(good)).toBe(good);
    expect(sanePowerRange(null)).toBe(DEFAULT_POWER_RANGE);
    expect(sanePowerRange(undefined)).toBe(DEFAULT_POWER_RANGE);
    // Byte order swapped in the trainer (oss-trainer-pitfalls #3): max 256 W << 8.
    expect(sanePowerRange({ min: 0, max: 65535, step: 256 })).toBe(DEFAULT_POWER_RANGE);
    expect(sanePowerRange({ min: 500, max: 100, step: 1 })).toBe(DEFAULT_POWER_RANGE);
    expect(sanePowerRange({ min: 0, max: 50, step: 1 })).toBe(DEFAULT_POWER_RANGE);
    expect(sanePowerRange({ min: -10, max: 1000, step: 1 })).toBe(DEFAULT_POWER_RANGE);
    expect(sanePowerRange({ min: 0, max: 1000, step: 0 })).toBe(DEFAULT_POWER_RANGE);
    expect(sanePowerRange({ min: 0, max: Number.NaN, step: 1 })).toBe(DEFAULT_POWER_RANGE);
  });
});

describe('sprint mode', () => {
  const seg = (durationSec: number, effortStart: number, effortEnd = effortStart) =>
    ({ durationSec, effortStart, effortEnd }) as Parameters<typeof isSprint>[0];

  it('short or very hard blocks are sprints', () => {
    expect(isSprint(seg(20, 7))).toBe(true);
    expect(isSprint(seg(60, 9))).toBe(true);
    expect(isSprint(seg(120, 3, 9))).toBe(true);
    expect(isSprint(seg(30, 8))).toBe(false);
  });

  it('switches to resistance only while sprint mode is on', () => {
    expect(controlModeFor(seg(20, 10), true)).toBe('resistance');
    expect(controlModeFor(seg(20, 10), false)).toBe('erg');
    expect(controlModeFor(seg(300, 5), true)).toBe('erg');
  });
});

describe('ramp-in', () => {
  it('ramps jumps above 30 % FTP over 3 s, sends small ones at once', () => {
    expect(startRamp(null, 300, 200, 0)).toBeNull();
    expect(startRamp(150, 200, 200, 0)).toBeNull();
    const ramp = startRamp(100, 300, 200, 1000)!;
    expect(rampValue(ramp, 1000)).toBe(100);
    expect(rampValue(ramp, 2500)).toBe(200);
    expect(rampValue(ramp, 4000)).toBe(300);
    expect(rampValue(ramp, 9000)).toBe(300);
    expect(rampValue(ramp, 0)).toBe(100);
  });
});

describe('shouldWrite', () => {
  const base = { lastW: 200, lastAtMs: 0, nextW: 200, nowMs: 2000, ftp: 250, boundary: false };
  it('writes the first target and at every block boundary', () => {
    expect(shouldWrite({ ...base, lastW: null })).toBe(true);
    expect(shouldWrite({ ...base, lastAtMs: null })).toBe(true);
    expect(shouldWrite({ ...base, boundary: true, nowMs: 100 })).toBe(true);
  });
  it('waits 1 s between writes and ignores changes under max(3 W, 1 % FTP)', () => {
    expect(shouldWrite({ ...base, nextW: 230, nowMs: 900 })).toBe(false);
    expect(shouldWrite({ ...base, nextW: 202 })).toBe(false);
    expect(shouldWrite({ ...base, nextW: 203 })).toBe(true);
    expect(shouldWrite({ ...base, ftp: 500, nextW: 204 })).toBe(false);
    expect(shouldWrite({ ...base, ftp: 500, nextW: 195 })).toBe(true);
  });
});

describe('cadence guard', () => {
  it('kicks in after 3 s under 55 rpm and recovers over 5 s above 70 rpm', () => {
    let s: GuardState = GUARD_IDLE;
    s = stepGuard(s, 90, 0);
    expect(s).toBe(GUARD_IDLE);
    s = stepGuard(s, 50, 1000);
    expect(s).toEqual({ phase: 'low', sinceMs: 1000 });
    s = stepGuard(s, 52, 3000);
    expect(s.phase).toBe('low');
    expect(guardFactor(s, 3000)).toBe(1);
    s = stepGuard(s, 52, 4000);
    expect(s).toEqual({ phase: 'active' });
    expect(guardFactor(s, 4000)).toBe(0.5);
    s = stepGuard(s, 65, 5000);
    expect(s.phase).toBe('active');
    s = stepGuard(s, 75, 6000);
    expect(s).toEqual({ phase: 'recovering', sinceMs: 6000 });
    expect(guardFactor(s, 8500)).toBe(0.75);
    s = stepGuard(s, 80, 10_000);
    expect(s.phase).toBe('recovering');
    s = stepGuard(s, 80, 11_000);
    expect(s).toBe(GUARD_IDLE);
  });

  it('a short dip does not trigger it; a new dip while recovering re-activates', () => {
    let s = stepGuard(GUARD_IDLE, 50, 0);
    s = stepGuard(s, 60, 1000);
    expect(s).toBe(GUARD_IDLE);
    s = stepGuard({ phase: 'recovering', sinceMs: 0 }, 40, 1000);
    expect(s).toEqual({ phase: 'active' });
    expect(stepGuard(s, null, 2000)).toBe(s);
  });
});
