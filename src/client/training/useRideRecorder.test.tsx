import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RideEventKind } from '../../domain/ride';
import { clearRideBuffer, loadRideBuffer } from './ride-recorder';
import { useRideRecorder, type RideRecorderInput } from './useRideRecorder';

const base: RideRecorderInput = {
  status: 'idle',
  trainerLink: 'live',
  powerW: 200,
  cadenceRpm: 90,
  hrBpm: 140,
  targetW: 200,
  segmentIndex: 0,
  ergEnabled: true,
};

describe('useRideRecorder', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    clearRideBuffer();
  });

  const run = (resumed = false) => {
    const pauseReasonRef = { current: null as RideEventKind | null };
    const hook = renderHook(
      (props: RideRecorderInput) =>
        useRideRecorder(props, { workoutId: 'w1', resumed, pauseReasonRef }),
      { initialProps: base },
    );
    return { ...hook, pauseReasonRef };
  };

  it('samples every second while running, notes pauses, signal and ERG changes', () => {
    const { result, rerender, pauseReasonRef } = run();
    act(() => vi.advanceTimersByTime(3000));
    expect(result.current.recorder.data().samples.power).toEqual([]); // not started yet
    rerender({ ...base, status: 'running' });
    act(() => vi.advanceTimersByTime(3000));
    rerender({ ...base, status: 'running', trainerLink: 'stale', powerW: null });
    act(() => vi.advanceTimersByTime(1000));
    pauseReasonRef.current = 'autoPause';
    rerender({ ...base, status: 'paused', trainerLink: 'stale', powerW: null });
    act(() => vi.advanceTimersByTime(5000)); // paused: no samples
    rerender({ ...base, status: 'running' });
    act(() => vi.advanceTimersByTime(1000));
    rerender({ ...base, status: 'running', ergEnabled: false });
    rerender({ ...base, status: 'paused', ergEnabled: false });
    const { samples, events } = result.current.recorder.data();
    expect(samples.power).toEqual([200, 200, 200, null, 200]);
    // Wall-clock times keep the 5 s pause.
    expect(samples.timeMs).toEqual([0, 1000, 2000, 3000, 9000]);
    expect(events.map(({ atSec, kind }) => ({ atSec, kind }))).toEqual([
      { atSec: 3, kind: 'signalLost' },
      { atSec: 4, kind: 'autoPause' },
      { atSec: 4, kind: 'resume' },
      { atSec: 4, kind: 'signalBack' },
      { atSec: 5, kind: 'ergOff' },
      { atSec: 5, kind: 'pause' },
    ]);
    expect(pauseReasonRef.current).toBeNull();
  });

  it('keeps the recording for a reload and picks it up on resume; finish drops it', () => {
    const first = run();
    first.rerender({ ...base, status: 'running' });
    act(() => vi.advanceTimersByTime(5000)); // the 5 s flush
    expect(loadRideBuffer('w1')?.samples.power).toHaveLength(5);
    act(() => vi.advanceTimersByTime(2000));
    first.unmount(); // leaving without ending keeps it all
    expect(loadRideBuffer('w1')?.samples.power).toHaveLength(7);

    const resumed = run(true);
    expect(resumed.result.current.recorder.data().samples.power).toHaveLength(7);
    act(() => resumed.result.current.finish());
    resumed.unmount();
    expect(loadRideBuffer('w1')).toBeUndefined();

    // A new ride of the same workout starts empty.
    const fresh = run(false);
    expect(fresh.result.current.recorder.data().samples.power).toEqual([]);
  });
});
