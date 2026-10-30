import { useEffect, useRef } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { builtinPlans } from '../data/builtin';
import { DEFAULT_PLAN_SETTINGS } from '../../domain/plan';
import { scaleWorkout } from '../../domain/scale';
import { flattenWorkout } from '../../domain/segments';
import type { SessionConfig } from '../../domain/settings';
import { getRepositories } from '../data/repositories';
import { useLibrary } from '../data/useLibrary';
import { useSettings } from '../data/useSettings';
import { useSessionStore, type SessionRuntime } from '../training/session-store';

const DEFAULT_CONFIG: SessionConfig = {
  background: 'basic',
  hud: 'solo',
  playerIds: [],
  music: false,
};

/**
 * Temporary route /setup/:workoutId (Task 5.3 replaces it with the real setup screen):
 * loads the workout with default config and starts the training screen.
 */
export function SetupPlaceholder() {
  const { workoutId = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { settings, loaded } = useSettings();
  const { workouts, loaded: libraryLoaded } = useLibrary();
  const started = useRef(false);

  const workout = workouts.find((w) => w.id === workoutId);
  const planId = params.get('plan');
  const week = Number(params.get('week'));
  const slot = params.get('slot');

  useEffect(() => {
    if (started.current || !loaded || !workout) return;
    started.current = true;
    void (async () => {
      let planProgressSettings = DEFAULT_PLAN_SETTINGS;
      if (planId) {
        try {
          const repos = await getRepositories();
          planProgressSettings =
            (await repos.planProgress.get(planId))?.settings ?? planProgressSettings;
        } catch (err) {
          console.warn('Loading plan settings failed, using defaults', err);
        }
      }
      const planned =
        planId && builtinPlans.some((p) => p.id === planId)
          ? scaleWorkout(workout, {
              targetMinutes: planProgressSettings.sessionMinutes,
              difficultyPct: planProgressSettings.difficulty,
            })
          : workout;
      const runtime: SessionRuntime = {
        workout: planned,
        segments: flattenWorkout(planned, settings.effortTable),
        config: DEFAULT_CONFIG,
        players: [],
        ...(planId &&
        Number.isInteger(week) &&
        week > 0 &&
        (slot === 'progres' || slot === 'freestyle')
          ? { plan: { planId, week, slot } }
          : {}),
      };
      useSessionStore.getState().load(runtime);
      navigate('/train', { replace: true });
    })();
  }, [loaded, workout, planId, week, slot, settings, navigate]);

  if (libraryLoaded && !workout) return <Navigate to="/" replace />;
  return null;
}
