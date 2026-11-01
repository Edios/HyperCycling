import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DEFAULT_EFFORT_TABLE } from '../../domain/effort';
import { flattenWorkout } from '../../domain/segments';
import { restoreSessionEngine } from '../../domain/session-engine';
import { getWorkout } from '../data/builtin';
import { HyperrideCanvas } from '../hyperride/HyperrideCanvas';
import type { FrameInput } from '../hyperride/world';
import { useT } from '../i18n';

const num = (v: string | null, fallback: number): number => {
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** Monotonic clock starting at 0, running `rate` times faster than real time. */
function scaledClock(rate: number): () => number {
  const origin = performance.now();
  return () => (performance.now() - origin) * rate;
}

/**
 * Developer page: the Neon Tunnel driven by a running engine over the built-in demo-mixed workout.
 * Query: `t` start second, `rate` time multiplier, `quality` high|low, `offset` view offset (0..1).
 */
export function DevHyperride() {
  const t = useT();
  const [params] = useSearchParams();
  const startSec = Math.max(0, num(params.get('t'), 0));
  const rate = Math.max(0.1, num(params.get('rate'), 1));
  const quality = params.get('quality') === 'low' ? 'low' : 'high';
  const offset = num(params.get('offset'), 0);
  const [unavailable, setUnavailable] = useState(false);

  const engine = useMemo(() => {
    const workout = getWorkout('demo-mixed');
    if (!workout) throw new Error('Built-in workout demo-mixed is missing');
    const segments = flattenWorkout(workout, DEFAULT_EFFORT_TABLE);
    const e = restoreSessionEngine(segments, scaledClock(rate), {
      segmentIndex: 0,
      workoutElapsedSec: startSec,
      status: 'paused',
    });
    return { e, segments };
  }, [startSec, rate]);

  useEffect(() => {
    engine.e.resume();
  }, [engine]);

  const getFrameInput = useCallback((): FrameInput => {
    engine.e.tick();
    return { segments: engine.segments, state: engine.e.getState(), table: DEFAULT_EFFORT_TABLE };
  }, [engine]);

  return (
    <main
      data-testid="dev-hyperride"
      style={{ position: 'fixed', inset: 0, background: '#020308', overflow: 'hidden' }}
    >
      {unavailable ? (
        <p role="status" style={{ color: '#ccd', padding: '2vh' }}>
          {t('hyperride.unavailable')}
        </p>
      ) : (
        <HyperrideCanvas
          getFrameInput={getFrameInput}
          quality={quality}
          viewOffsetX={offset}
          onUnavailable={() => setUnavailable(true)}
        />
      )}
    </main>
  );
}
