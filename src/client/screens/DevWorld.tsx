import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DEFAULT_EFFORT_TABLE } from '../../domain/effort';
import { flattenWorkout } from '../../domain/segments';
import { restoreSessionEngine } from '../../domain/session-engine';
import { resolveChapters } from '../../domain/experience';
import { getExperience, getWorkout } from '../data/builtin';
import { WorldCanvas } from '../world/WorldCanvas';
import type { FrameInput, WorldTheme } from '../world/world';
import { DEFAULT_WORLD, WORLDS, type WorldId } from '../world/worlds';
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
 * Developer page: a World world driven by a running engine over the built-in demo-mixed workout.
 * Query: `t` start second, `rate` time multiplier, `quality` high|low, `offset` view offset (0..1),
 * `world` world id (default neon-tunnel), `workout` built-in workout id (default demo-mixed),
 * `exp` built-in Experience id (its workout and theme; use with world=scenes).
 */
export function DevWorld() {
  const t = useT();
  const [params] = useSearchParams();
  const startSec = Math.max(0, num(params.get('t'), 0));
  const rate = Math.max(0.1, num(params.get('rate'), 1));
  const quality = params.get('quality') === 'low' ? 'low' : 'high';
  const offset = num(params.get('offset'), 0);
  const experience = getExperience(params.get('exp') ?? '');
  const workoutId = experience?.workoutRef.id ?? params.get('workout') ?? 'demo-mixed';
  const worldParam = params.get('world');
  const world: WorldId =
    worldParam !== null && worldParam in WORLDS ? (worldParam as WorldId) : DEFAULT_WORLD;
  const [unavailable, setUnavailable] = useState(false);

  const engine = useMemo(() => {
    const workout = getWorkout(workoutId) ?? getWorkout('demo-mixed');
    if (!workout) throw new Error('Built-in workout demo-mixed is missing');
    const segments = flattenWorkout(workout, DEFAULT_EFFORT_TABLE);
    const e = restoreSessionEngine(segments, scaledClock(rate), {
      segmentIndex: 0,
      workoutElapsedSec: startSec,
      status: 'paused',
    });
    const theme: WorldTheme | undefined =
      experience && experience.worldTheme.theme !== 'abstract'
        ? { id: experience.worldTheme.theme, chapters: resolveChapters(experience, workout) }
        : undefined;
    return { e, segments, theme };
  }, [startSec, rate, workoutId, experience]);

  useEffect(() => {
    engine.e.resume();
  }, [engine]);

  const getFrameInput = useCallback((): FrameInput => {
    engine.e.tick();
    return {
      segments: engine.segments,
      state: engine.e.getState(),
      table: DEFAULT_EFFORT_TABLE,
      theme: engine.theme,
    };
  }, [engine]);

  return (
    <main
      data-testid="dev-world"
      style={{ position: 'fixed', inset: 0, background: '#020308', overflow: 'hidden' }}
    >
      {unavailable ? (
        <p role="status" style={{ color: '#ccd', padding: '2vh' }}>
          {t('world.unavailable')}
        </p>
      ) : (
        <WorldCanvas
          getFrameInput={getFrameInput}
          quality={quality}
          world={world}
          viewOffsetX={offset}
          onUnavailable={() => setUnavailable(true)}
        />
      )}
    </main>
  );
}
