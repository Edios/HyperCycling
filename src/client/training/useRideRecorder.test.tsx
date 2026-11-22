import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RideEventKind } from '../../domain/ride';
import { clearRideBuffer, loadRideBuffer } from './ride-recorder';
import { createRideSession, useRideRecorder, type RideRecorderInput } from './useRideRecorder';
import { createRideRecorder, loadRideBlocks, saveRideBuffer } from './ride-recorder';
import { createExecutionTracker } from '../../domain/execution';

const base: RideRecorderInput = {
  status: 'idle',
  trainerLink: 'live',
  readPowerW: () => 200,
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
    rerender({ ...base, status: 'running', trainerLink: 'stale', readPowerW: () => null });
    act(() => vi.advanceTimersByTime(1000));
    pauseReasonRef.current = 'autoPause';
    rerender({ ...base, status: 'paused', trainerLink: 'stale', readPowerW: () => null });
    act(() => vi.advanceTimersByTime(5000)); // paused: no samples
    rerender({ ...base, status: 'running' });
    act(() => vi.advanceTimersByTime(1000));
    rerender({ ...base, status: 'running', ergEnabled: false });
    rerender({ ...base, status: 'paused', ergEnabled: false });
    const { samples, events } = result.current.recorder.data();
    expect(samples.power).toEqual([200, 200, 200, null, 200]);
    // Wall-clock times keep the 5 s pause.
    expect(samples.timeMs).toEqual([1000, 2000, 3000, 4000, 10_000]);
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

  it('takes the power of each second only when a sample is due', () => {
    let calls = 0;
    const readPowerW = () => {
      calls += 1;
      return 300 + calls;
    };
    const { result, rerender } = run();
    rerender({ ...base, status: 'running', readPowerW });
    act(() => vi.advanceTimersByTime(3000)); // checked every 250 ms, sampled once per second
    expect(calls).toBe(3);
    expect(result.current.recorder.data().samples.power).toEqual([301, 302, 303]);
  });

  it('a reload in the middle of a ride is recorded as a pause at the last kept second', () => {
    let clock = 0;
    const r = createRideRecorder(undefined, () => clock);
    r.run();
    for (let i = 0; i < 3; i++) {
      clock += 1000;
      r.catchUp({ powerW: 200, cadenceRpm: 90, hrBpm: 140, targetW: 200, segmentIndex: 0 });
    }
    saveRideBuffer('w1', r.data());
    const resumed = createRideSession('w1', true);
    expect(resumed.recorder.data().events).toEqual([{ atSec: 3, atMs: 3000, kind: 'pause' }]);
    // Paused already before the reload: no second pause.
    r.event('autoPause');
    saveRideBuffer('w1', r.data());
    expect(
      createRideSession('w1', true)
        .recorder.data()
        .events.map((e) => e.kind),
    ).toEqual(['autoPause']);
    // A new ride drops the buffer.
    expect(createRideSession('w1', false).recorder.data().samples.power).toEqual([]);
    expect(loadRideBuffer('w1')).toBeUndefined();
  });

  it('keeps the closed D21 blocks with the buffer; the tracker carries on with them', () => {
    const block = { segmentIndex: 0, score: 90, met: true, measuredSec: 60 };
    const session = createRideSession('w1', false, () => [block]);
    session.flush();
    expect(loadRideBlocks('w2')).toEqual([]);
    const kept = loadRideBlocks('w1');
    expect(kept).toEqual([block]);
    const tracker = createExecutionTracker(kept);
    tracker.add(1, 100, 200, 0);
    tracker.add(1, 100, 200, 1000);
    tracker.closeBlock();
    expect(tracker.results().map((b) => b.segmentIndex)).toEqual([0, 1]);
    expect(tracker.total()).toBe(Math.round((90 * 60) / 61));
    session.finish();
    expect(loadRideBlocks('w1')).toEqual([]);
  });
});
