import { describe, expect, it } from 'vitest';
import { focusVisible, type FocusInput } from './focus-visibility';

const base: FocusInput = {
  status: 'running',
  nowMs: 100_000,
  lastInputMs: 0,
  blockElapsedSec: 60,
  blockRemainingSec: 120,
  workoutRemainingSec: 900,
  dialogOpen: false,
};

describe('focusVisible', () => {
  it('hides the HUD in the middle of a block with no recent input', () => {
    expect(focusVisible(base)).toBe(false);
  });

  it('shows for 3 s after the last input, then hides', () => {
    expect(focusVisible({ ...base, nowMs: 100_000, lastInputMs: 97_001 })).toBe(true);
    expect(focusVisible({ ...base, nowMs: 100_000, lastInputMs: 97_000 })).toBe(false);
  });

  it('shows from 10 s before the block ends', () => {
    expect(focusVisible({ ...base, blockRemainingSec: 10.01 })).toBe(false);
    expect(focusVisible({ ...base, blockRemainingSec: 10 })).toBe(true);
    expect(focusVisible({ ...base, blockRemainingSec: 0.2 })).toBe(true);
  });

  it('stays until 6 s after the next block started', () => {
    expect(focusVisible({ ...base, blockElapsedSec: 0 })).toBe(true);
    expect(focusVisible({ ...base, blockElapsedSec: 5.99 })).toBe(true);
    expect(focusVisible({ ...base, blockElapsedSec: 6 })).toBe(false);
  });

  it.each(['idle', 'countdown', 'paused', 'finished'] as const)(
    'is always visible when %s',
    (s) => {
      expect(focusVisible({ ...base, status: s })).toBe(true);
    },
  );

  it('is visible while a dialog or the quick settings are open', () => {
    expect(focusVisible({ ...base, dialogOpen: true })).toBe(true);
  });

  it('is visible during the last 10 s of the workout', () => {
    expect(focusVisible({ ...base, workoutRemainingSec: 10.5 })).toBe(false);
    expect(focusVisible({ ...base, workoutRemainingSec: 10 })).toBe(true);
    expect(focusVisible({ ...base, workoutRemainingSec: 0 })).toBe(true);
  });

  it('treats a never-used input clock as no input', () => {
    expect(focusVisible({ ...base, lastInputMs: Number.NEGATIVE_INFINITY })).toBe(false);
  });
});
