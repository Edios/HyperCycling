import { useCallback, useState } from 'react';
import { DEFAULT_EFFORT_TABLE } from '../../domain/effort';
import { flattenWorkout } from '../../domain/segments';
import { restoreSessionEngine } from '../../domain/session-engine';
import { getWorkout } from '../data/builtin';
import type { FrameInput } from '../world/world';

/**
 * Frame input for the World canvas from a running engine over the built-in demo-mixed workout
 * (the same source as the dev page), so a performance test sees a realistic mix of efforts.
 */
export function useDemoFrameInput(): () => FrameInput {
  const [demo] = useState(() => {
    const workout = getWorkout('demo-mixed');
    if (!workout) throw new Error('Built-in workout demo-mixed is missing');
    const segments = flattenWorkout(workout, DEFAULT_EFFORT_TABLE);
    const origin = performance.now();
    const engine = restoreSessionEngine(segments, () => performance.now() - origin, {
      segmentIndex: 0,
      workoutElapsedSec: 0,
      status: 'paused',
    });
    engine.resume();
    return { engine, segments };
  });
  return useCallback((): FrameInput => {
    demo.engine.tick();
    return {
      segments: demo.segments,
      state: demo.engine.getState(),
      table: DEFAULT_EFFORT_TABLE,
    };
  }, [demo]);
}
