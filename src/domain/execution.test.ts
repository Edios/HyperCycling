import { describe, expect, it } from 'vitest';
import { createExecutionTracker, onTarget } from './execution';

describe('onTarget', () => {
  it('±10 % of the target, at least ±10 W', () => {
    expect(onTarget(220, 200)).toBe(true);
    expect(onTarget(221, 200)).toBe(false);
    expect(onTarget(179, 200)).toBe(false);
    expect(onTarget(60, 50)).toBe(true); // ±10 W floor
    expect(onTarget(61, 50)).toBe(false);
  });
});

describe('createExecutionTracker', () => {
  it('scores a block by the time on target and marks it met at ≥ 70 %', () => {
    const t = createExecutionTracker();
    // 8 s on target, 2 s off (1 Hz readings).
    for (let s = 0; s <= 10; s++) t.add(0, s < 8 ? 200 : 150, 200, s * 1000);
    expect(t.current()).toBe(80);
    expect(t.closeBlock()).toEqual({ segmentIndex: 0, measuredSec: 10, score: 80, met: true });
  });

  it('a new block closes the previous one; the total is weighted by time', () => {
    const t = createExecutionTracker();
    for (let s = 0; s <= 10; s++) t.add(0, 200, 200, s * 1000); // 100 % over 10 s
    for (let s = 11; s <= 41; s++) t.add(1, 100, 300, s * 1000); // 0 % over 30 s
    t.closeBlock();
    expect(t.results().map((r) => [r.segmentIndex, r.score, r.met])).toEqual([
      [0, 100, true],
      [1, 0, false],
    ]);
    expect(t.total()).toBe(25);
  });

  it('gaps (no signal) and blocks without a target do not count', () => {
    const t = createExecutionTracker();
    t.add(0, 200, 200, 0);
    t.add(0, 200, 200, 1000);
    t.add(0, 100, 200, 10_000); // 9 s gap: not counted
    t.add(0, 100, 200, 11_000);
    expect(t.current()).toBe(50);
    t.add(1, null, 200, 12_000);
    t.add(1, null, 200, 13_000);
    t.add(2, 150, null, 14_000);
    t.add(2, 150, null, 15_000);
    expect(t.closeBlock()).toBeNull();
    expect(t.results()).toHaveLength(1);
    expect(t.total()).toBe(50);
  });

  it('nothing scored: no total', () => {
    const t = createExecutionTracker();
    expect(t.total()).toBeNull();
    expect(t.current()).toBeNull();
    expect(t.closeBlock()).toBeNull();
  });
});
