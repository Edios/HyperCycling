import { newId } from '../../domain/ids';
import { recordEntry, type PlanProgress } from '../../domain/plan';
import type { SessionLog } from '../../domain/session-log';
import { DEFAULT_PLAN_SETTINGS } from '../../domain/plan';
import { getRepositories } from '../data/repositories';
import type { LastResult } from '../training/last-result';
import { activeCycle, type CountTarget } from './model';

const persisted = new WeakMap<LastResult, Promise<void>>();

export function buildSessionLog(result: LastResult, endedAt: string): SessionLog {
  return {
    id: newId(),
    workoutId: result.workout.id,
    startedAt: result.startedAt,
    endedAt,
    riddenSec: result.riddenSec,
    completed: result.completed,
    playerIds: result.players.map((p) => p.id),
    config: result.config,
  };
}

/**
 * Stores the session log and, when `count` is given, a done entry in the plan progress.
 * Runs at most once per result: later calls return the first call's promise.
 */
export function persistResult(result: LastResult, count: CountTarget | undefined): Promise<void> {
  const existing = persisted.get(result);
  if (existing) return existing;
  const run = (async () => {
    const at = new Date().toISOString();
    let repos;
    try {
      repos = await getRepositories();
    } catch (err) {
      console.warn('Saving the session failed', err);
      return;
    }
    try {
      await repos.sessionLogs.put(buildSessionLog(result, at));
    } catch (err) {
      console.warn('Saving the session log failed', err);
    }
    if (!count) return;
    try {
      const planId = count.plan.id;
      const progress: PlanProgress = (await repos.planProgress.get(planId)) ?? {
        id: planId,
        planId,
        startedAt: at,
        settings: DEFAULT_PLAN_SETTINGS,
        entries: [],
      };
      const cycle = activeCycle(count.plan, progress);
      await repos.planProgress.put(
        recordEntry(progress, {
          week: count.week,
          slot: count.slot,
          workoutId: result.workout.id,
          status: 'done',
          at,
          ...(cycle > 1 ? { cycle } : {}),
        }),
      );
    } catch (err) {
      console.warn('Saving the plan progress failed', err);
    }
  })();
  persisted.set(result, run);
  return run;
}
