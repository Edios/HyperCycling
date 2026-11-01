import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_PLAN_SETTINGS, type Plan, type PlanProgress } from '../../domain/plan';
import type { SessionLog } from '../../domain/session-log';
import { builtinPlans } from '../data/builtin';
import { getRepositories } from '../data/repositories';
import { useSettings } from '../data/useSettings';

export type ActivePlan =
  { state: 'loading' } | { state: 'none' } | { state: 'ready'; plan: Plan; progress: PlanProgress };

function freshProgress(planId: string): PlanProgress {
  return {
    id: planId,
    planId,
    startedAt: new Date().toISOString(),
    settings: DEFAULT_PLAN_SETTINGS,
    entries: [],
  };
}

/** The plan chosen in settings plus its stored progress (missing progress means a fresh start). */
export function useActivePlan(): ActivePlan {
  const { settings, loaded } = useSettings();
  const planId = settings.activePlanId;
  const plan = useMemo(
    () => (planId === undefined ? undefined : builtinPlans.find((p) => p.id === planId)),
    [planId],
  );
  const [stored, setStored] = useState<{ planId: string; progress: PlanProgress } | undefined>();

  useEffect(() => {
    if (!plan) return undefined;
    let live = true;
    void (async () => {
      let progress: PlanProgress | undefined;
      try {
        const repos = await getRepositories();
        progress = await repos.planProgress.get(plan.id);
      } catch (err) {
        console.warn('Loading plan progress failed', err);
      }
      if (live) setStored({ planId: plan.id, progress: progress ?? freshProgress(plan.id) });
    })();
    return () => {
      live = false;
    };
  }, [plan]);

  if (!loaded) return { state: 'loading' };
  if (!plan) return { state: 'none' };
  if (stored?.planId !== plan.id) return { state: 'loading' };
  return { state: 'ready', plan, progress: stored.progress };
}

/** Most recent session log, or undefined. */
export function useLastSession(): SessionLog | undefined {
  const [last, setLast] = useState<SessionLog | undefined>();
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const repos = await getRepositories();
        const logs = await repos.sessionLogs.list();
        const latest = logs.reduce<SessionLog | undefined>(
          (m, l) => (m === undefined || l.endedAt > m.endedAt ? l : m),
          undefined,
        );
        if (live) setLast(latest);
      } catch (err) {
        console.warn('Loading session logs failed', err);
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  return last;
}
