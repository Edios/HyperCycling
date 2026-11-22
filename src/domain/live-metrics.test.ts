import { describe, expect, it } from 'vitest';
import { zoneForBpm } from './hr-zones';
import {
  createPowerSmoother,
  createSecondPower,
  judgeCadence,
  MAX_VALID_WATTS,
} from './live-metrics';

describe('createPowerSmoother', () => {
  it('is empty until the first reading and returns a single fresh reading as is', () => {
    const s = createPowerSmoother();
    expect(s.value(0)).toBeNull();
    s.push(200, 1000);
    expect(s.value(1000)).toBe(200);
    expect(s.value(2000)).toBe(200);
  });

  it('weights each reading by the time since the previous one, the newest holds until now', () => {
    const s = createPowerSmoother();
    s.push(100, 0);
    s.push(200, 1000);
    s.push(400, 2000);
    // Window 0..3 s: 200 covers 0..1 s, 400 covers 1..3 s.
    expect(s.value(3000)).toBeCloseTo(333.33, 1);
    // The newest reading counts as soon as it arrives.
    expect(s.value(2000)).toBeCloseTo(300, 5);
    // Window 1..4 s: only 400.
    expect(s.value(4000)).toBe(400);
  });

  it('clips coverage at the window start', () => {
    const s = createPowerSmoother();
    s.push(300, 0);
    s.push(150, 1000);
    s.push(450, 2500);
    // Window 0.5..3.5 s: 150 for 0.5 s, 450 for 2.5 s.
    expect(s.value(3500)).toBeCloseTo(400, 5);
  });

  it('goes stale (null, not zero) 3 s after the last reading', () => {
    const s = createPowerSmoother();
    s.push(180, 0);
    expect(s.value(3000)).toBe(180);
    expect(s.value(3001)).toBeNull();
  });

  it('ignores negative, too high, non-finite and out-of-order readings', () => {
    const s = createPowerSmoother();
    s.push(200, 1000);
    s.push(-5, 1500);
    s.push(MAX_VALID_WATTS + 1, 1600);
    s.push(Number.NaN, 1700);
    s.push(500, Number.NaN);
    s.push(900, 500);
    expect(s.value(2000)).toBe(200);
    s.push(0, 2000);
    expect(s.value(3000)).toBe(0);
  });

  it('a clock slightly behind the last reading reads as now', () => {
    const s = createPowerSmoother();
    s.push(120, 5000);
    expect(s.value(4990)).toBe(120);
  });

  it('keeps working past its capacity and after reset', () => {
    const s = createPowerSmoother({ capacity: 4, windowMs: 10_000 });
    for (let t = 0; t < 10; t++) s.push(t * 10, t * 100);
    // Only the last 4 readings remain (60..90 at 600..900 ms); 60 has no earlier neighbour.
    expect(s.value(900)).toBeCloseTo(80, 5);
    expect(s.value(1000)).toBeCloseTo(82.5, 5);
    s.reset();
    expect(s.value(1000)).toBeNull();
  });
});

describe('judgeCadence', () => {
  it('within ±5 rpm is ok', () => {
    expect(judgeCadence(84, 90)).toBe('low');
    expect(judgeCadence(85, 90)).toBe('ok');
    expect(judgeCadence(95, 90)).toBe('ok');
    expect(judgeCadence(96, 90)).toBe('high');
    expect(judgeCadence(100, 90, 10)).toBe('ok');
  });
});

describe('zoneForBpm', () => {
  it('maps % of HRmax to zones 1-5', () => {
    expect(zoneForBpm(95, 200)).toBeNull();
    expect(zoneForBpm(100, 200)).toBe(1);
    expect(zoneForBpm(130, 200)).toBe(2);
    expect(zoneForBpm(150, 200)).toBe(3);
    expect(zoneForBpm(179, 200)).toBe(4);
    expect(zoneForBpm(180, 200)).toBe(5);
    expect(zoneForBpm(215, 200)).toBe(5);
  });

  it('needs a valid HRmax and bpm', () => {
    expect(zoneForBpm(130, undefined)).toBeNull();
    expect(zoneForBpm(130, 0)).toBeNull();
    expect(zoneForBpm(Number.NaN, 190)).toBeNull();
  });
});

describe('createSecondPower (ride record, review #120 B2)', () => {
  it('a 1 s peak stays a peak (the 3 s HUD average would flatten it)', () => {
    const p = createSecondPower();
    const hud = createPowerSmoother();
    // 4 Hz readings: 200 W, one second at 600 W, then 200 W again.
    for (let t = 0; t <= 2000; t += 250) {
      const w = t > 1000 && t <= 2000 ? 600 : 200;
      p.push(w, t);
      hud.push(w, t);
    }
    expect(p.value(2000)).toBe(600);
    expect(Math.round(hud.value(2000)!)).toBeLessThan(500);
  });

  it('a slow trainer: the last reading holds up to 2 s; no reading after that is null', () => {
    const p = createSecondPower();
    expect(p.value(0)).toBeNull();
    p.push(180, 1000);
    expect(p.value(1500)).toBe(180);
    expect(p.value(2900)).toBe(180); // nothing in this second, the last reading is 1.9 s old
    expect(p.value(3100)).toBeNull();
    p.push(Number.NaN, 3200); // invalid readings are ignored
    expect(p.value(3300)).toBeNull();
    p.reset();
    expect(p.value(3300)).toBeNull();
  });
});
