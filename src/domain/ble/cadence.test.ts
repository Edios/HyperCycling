import { describe, expect, it } from 'vitest';
import { counterDelta, createCadenceTracker } from './cadence';

// 90 rpm = 3 revolutions every 2 s = 3 revs per 2048 ticks of 1/1024 s.
const REVS = 3;
const TICKS = 2048;

describe('counterDelta', () => {
  it('handles uint16 and uint32 wrap', () => {
    expect(counterDelta(5, 3, 2 ** 16)).toBe(2);
    expect(counterDelta(1, 65534, 2 ** 16)).toBe(3);
    expect(counterDelta(2, 0xfffffffe, 2 ** 32)).toBe(4);
    expect(counterDelta(7, 7, 2 ** 32)).toBe(0);
  });
});

describe('createCadenceTracker', () => {
  it('returns 0 until a second sample arrives', () => {
    const t = createCadenceTracker();
    expect(t.push({ revs: 0, eventTime1024: 0 }, 0)).toBe(0);
    expect(t.rpm(0)).toBe(0);
  });

  it('computes a steady 90 rpm', () => {
    const t = createCadenceTracker();
    for (let i = 0; i <= 5; i++) {
      const rpm = t.push({ revs: i * REVS, eventTime1024: i * TICKS }, i * 2000);
      if (i > 0) expect(rpm).toBe(90);
    }
    expect(t.rpm(10_000)).toBe(90);
  });

  it('crosses the 64 s event-time wrap and the revolution wrap', () => {
    const t = createCadenceTracker();
    t.push({ revs: 65534, eventTime1024: 65000 }, 0);
    expect(
      t.push({ revs: (65534 + REVS) % 65536, eventTime1024: (65000 + TICKS) % 65536 }, 2000),
    ).toBe(90);
  });

  it('ignores dT = 0 (repeated event) and keeps the last cadence', () => {
    const t = createCadenceTracker();
    t.push({ revs: 0, eventTime1024: 0 }, 0);
    t.push({ revs: REVS, eventTime1024: TICKS }, 2000);
    expect(t.push({ revs: REVS, eventTime1024: TICKS }, 2500)).toBe(90);
    expect(t.push({ revs: REVS + 1, eventTime1024: TICKS }, 2600)).toBe(90);
  });

  it('drops to 0 three seconds after the last new revolution', () => {
    const t = createCadenceTracker();
    t.push({ revs: 0, eventTime1024: 0 }, 0);
    t.push({ revs: REVS, eventTime1024: TICKS }, 2000);
    // The crank stops: the sensor keeps repeating its last values.
    expect(t.push({ revs: REVS, eventTime1024: TICKS }, 4000)).toBe(90);
    expect(t.push({ revs: REVS, eventTime1024: TICKS }, 5000)).toBe(90);
    expect(t.push({ revs: REVS, eventTime1024: TICKS }, 5001)).toBe(0);
    expect(t.rpm(6000)).toBe(0);
  });

  it('rejects values above 250 rpm and continues from the new reference', () => {
    const t = createCadenceTracker();
    t.push({ revs: 0, eventTime1024: 0 }, 0);
    t.push({ revs: REVS, eventTime1024: TICKS }, 2000);
    // 10 revolutions in one second = 600 rpm: a glitch.
    expect(t.push({ revs: REVS + 10, eventTime1024: TICKS + 1024 }, 3000)).toBe(90);
    expect(t.push({ revs: REVS + 10 + REVS, eventTime1024: TICKS + 1024 + TICKS }, 5000)).toBe(90);
  });

  it('honours custom staleMs and maxRpm, and reset clears state', () => {
    const t = createCadenceTracker({ staleMs: 1000, maxRpm: 60 });
    t.push({ revs: 0, eventTime1024: 0 }, 0);
    expect(t.push({ revs: REVS, eventTime1024: TICKS }, 2000)).toBe(0); // 90 > 60
    expect(t.push({ revs: REVS + 1, eventTime1024: TICKS + 1024 }, 3000)).toBe(60);
    expect(t.rpm(4001)).toBe(0);
    t.reset();
    expect(t.rpm(3000)).toBe(0);
    expect(t.push({ revs: 100, eventTime1024: 100 }, 3000)).toBe(0);
  });
});
