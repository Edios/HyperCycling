import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFrameMeter, useFrameMeter } from './useFrameMeter';

describe('createFrameMeter', () => {
  it('keeps only samples inside the window', () => {
    const m = createFrameMeter(1000);
    for (let t = 0; t <= 3000; t += 100) m.push(t);
    const s = m.stats();
    expect(s.count).toBe(10); // 100 ms frames, last second
    expect(s.avgFps).toBeCloseTo(10, 6);
  });

  it('drops frame gaps longer than 1 s (hidden tab)', () => {
    const m = createFrameMeter(60_000);
    m.push(0);
    m.push(16);
    m.push(10_000);
    expect(m.stats().count).toBe(1);
    expect(m.stats().avgFrameMs).toBe(16);
  });
});

describe('useFrameMeter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('publishes stats about once a second and reports every frame', () => {
    const onFrame = vi.fn();
    const { result } = renderHook(() => useFrameMeter({ onFrame }));
    expect(result.current.count).toBe(0);
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(onFrame).toHaveBeenCalled();
    expect(result.current.count).toBeGreaterThan(30);
    expect(result.current.avgFps).toBeGreaterThan(40);
  });

  it('does nothing while disabled', () => {
    const onFrame = vi.fn();
    renderHook(() => useFrameMeter({ enabled: false, onFrame }));
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onFrame).not.toHaveBeenCalled();
  });

  it('stops on unmount', () => {
    const onFrame = vi.fn();
    const { unmount } = renderHook(() => useFrameMeter({ onFrame }));
    act(() => {
      vi.advanceTimersByTime(200);
    });
    unmount();
    const n = onFrame.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onFrame.mock.calls.length).toBe(n);
  });
});
