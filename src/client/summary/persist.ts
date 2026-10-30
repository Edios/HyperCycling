import { newId } from '../../domain/ids';
import {
  DEFAULT_PLAN_SETTINGS,
  recordEntry,
  removeEntry,
  type PlanProgress,
  type ProgressEntry,
} from '../../domain/plan';
import type { SessionLog } from '../../domain/session-log';
import { getRepositories } from '../data/repositories';
import type { LastResult } from '../training/last-result';
import { entryCycle, type CountTarget } from './model';

const logged = new WeakSet<LastResult>();

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

/** Stores the session log, at most once per result (StrictMode and remounts call this again). */
export async function saveSessionLog(result: LastResult): Promise<void> {
  if (logged.has(result)) return;
  logged.add(result);
  try {
    const repos = await getRepositories();
    await repos.sessionLogs.put(buildSessionLog(result, new Date().toISOString()));
  } catch (err) {
    console.warn('Saving the session log failed', err);
  }
}

interface EntryState {
  /** Whether the done entry is currently written for this result. */
  applied: boolean;
  /** Entry the write replaced, restored when the toggle goes off. */
  previous: ProgressEntry | undefined;
  /** Writes run one after another so they land in toggle order. */
  queue: Promise<void>;
}

const entryStates = new WeakMap<LastResult, EntryState>();

function sameSlot(e: ProgressEntry, week: number, slot: string, cycle: number): boolean {
  return (e.cycle ?? 1) === cycle && e.week === week && e.slot === slot;
}

/**
 * Makes the plan progress match the toggle: on records a done entry, off puts back whatever the
 * entry replaced (or removes it). Does nothing when the state already matches.
 */
export function syncPlanEntry(result: LastResult, target: CountTarget, on: boolean): Promise<void> {
  let state = entryStates.get(result);
  if (!state) {
    state = { applied: false, previous: undefined, queue: Promise.resolve() };
    entryStates.set(result, state);
  }
  if (state.applied === on) return state.queue;
  state.applied = on;
  const st = state;
  st.queue = st.queue.then(async () => {
    try {
      const repos = await getRepositories();
      const planId = target.plan.id;
      const at = new Date().toISOString();
      const progress: PlanProgress = (await repos.planProgress.get(planId)) ?? {
        id: planId,
        planId,
        startedAt: at,
        settings: DEFAULT_PLAN_SETTINGS,
        entries: [],
      };
      const cycle = entryCycle(result, target.plan, progress);
      const key = { week: target.week, slot: target.slot, cycle };
      if (on) {
        st.previous = progress.entries.find((e) => sameSlot(e, key.week, key.slot, cycle));
        await repos.planProgress.put(
          recordEntry(progress, {
            week: key.week,
            slot: key.slot,
            workoutId: result.workout.id,
            status: 'done',
            at,
            ...(cycle > 1 ? { cycle } : {}),
          }),
        );
      } else {
        const removed = removeEntry(progress, key);
        await repos.planProgress.put(st.previous ? recordEntry(removed, st.previous) : removed);
      }
    } catch (err) {
      console.warn('Saving the plan progress failed', err);
    }
  });
  return st.queue;
}
