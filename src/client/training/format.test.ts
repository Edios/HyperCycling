import { describe, expect, it } from 'vitest';
import { formatClock } from './format';

describe('formatClock', () => {
  it('formats zero', () => expect(formatClock(0)).toBe('0:00'));
  it('floors when asked', () => expect(formatClock(59.9, { round: 'floor' })).toBe('0:59'));
  it('ceils fractional seconds', () => expect(formatClock(59.2)).toBe('1:00'));
  it('pads seconds', () => expect(formatClock(65)).toBe('1:05'));
  it('switches to h:mm:ss at one hour', () => expect(formatClock(3600)).toBe('1:00:00'));
  it('formats hours with minutes', () => expect(formatClock(3725)).toBe('1:02:05'));
  it('clamps negatives and NaN to zero', () => {
    expect(formatClock(-5)).toBe('0:00');
    expect(formatClock(Number.NaN)).toBe('0:00');
  });
});
