import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useExecution, type ExecutionInput } from './useExecution';

describe('useExecution (review #115 B1)', () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
  afterEach(() => vi.useRealTimers());

  const run = (input: ExecutionInput) =>
    renderHook((props: ExecutionInput) => useExecution(props, { now: () => Date.now() }), {
      initialProps: input,
    });

  it('a steady power exactly on target counts every second: ~100 % and met', () => {
    const { result, rerender } = run({ active: true, segmentIndex: 0, powerW: 138, targetW: 138 });
    // The shown power never changes, so nothing re-renders; the interval still samples.
    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current.blockScore).toBe(100);
    rerender({ active: true, segmentIndex: 1, powerW: 138, targetW: 200 });
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.blockResult).toMatchObject({ segmentIndex: 0, met: true });
    expect(result.current.blockResult!.score).toBeGreaterThanOrEqual(99);
    // The message goes away after 5 s.
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.blockResult).toBeNull();
  });

  it('off target for good is not met; nothing is sampled while inactive', () => {
    const { result, rerender } = run({ active: true, segmentIndex: 0, powerW: 100, targetW: 200 });
    act(() => vi.advanceTimersByTime(8000));
    expect(result.current.blockScore).toBe(0);
    rerender({ active: false, segmentIndex: 0, powerW: 200, targetW: 200 });
    act(() => vi.advanceTimersByTime(8000));
    expect(result.current.blockScore).toBe(0);
    rerender({ active: true, segmentIndex: 1, powerW: 200, targetW: 200 });
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.blockResult).toMatchObject({ segmentIndex: 0, met: false, score: 0 });
    act(() => result.current.dismissBlockResult());
    expect(result.current.blockResult).toBeNull();
    result.current.tracker.closeBlock();
    expect(result.current.tracker.results().map((r) => r.met)).toEqual([false]);
  });
});
