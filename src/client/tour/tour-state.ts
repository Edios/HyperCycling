/**
 * State of a coach-marks tour: where it is, and whether the user has already seen it. The
 * "seen" flag lives in localStorage; every access is guarded because storage can be missing or
 * throw (private window, blocked site data, tests).
 */

export type TourOutcome = 'done' | 'skipped';

export interface TourState {
  running: boolean;
  /** Index of the current step; kept inside 0..count-1. */
  index: number;
  count: number;
}

export type TourAction =
  | { type: 'start' }
  | { type: 'next' }
  | { type: 'back' }
  /** Ends the tour: `done` after the last step, `skipped` any time earlier. */
  | { type: 'stop' };

export function createTourState(count: number): TourState {
  return { running: false, index: 0, count: Math.max(1, count) };
}

export function isLastStep(state: TourState): boolean {
  return state.index >= state.count - 1;
}

/** Pure transitions: starting always begins at step 1, `next` on the last step ends the tour. */
export function tourReducer(state: TourState, action: TourAction): TourState {
  switch (action.type) {
    case 'start':
      return { ...state, running: true, index: 0 };
    case 'next':
      if (!state.running) return state;
      return isLastStep(state)
        ? { ...state, running: false, index: 0 }
        : { ...state, index: state.index + 1 };
    case 'back':
      if (!state.running) return state;
      return { ...state, index: Math.max(0, state.index - 1) };
    case 'stop':
      return { ...state, running: false, index: 0 };
  }
}

/** Outcome stored for a finished or skipped tour: `done` once the last step was left. */
export function outcomeOnLeave(state: TourState, action: 'next' | 'stop'): TourOutcome {
  return action === 'next' && isLastStep(state) ? 'done' : 'skipped';
}

function defaultStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** The stored outcome, or `undefined` when the tour was never finished or storage is unreadable. */
export function readTourOutcome(
  key: string,
  storage: Pick<Storage, 'getItem'> | undefined = defaultStorage(),
): TourOutcome | undefined {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { outcome?: unknown } | null;
    return parsed?.outcome === 'done' || parsed?.outcome === 'skipped' ? parsed.outcome : undefined;
  } catch {
    return undefined;
  }
}

/** Remembers that the tour was seen. Failures are ignored: the tour then simply shows again. */
export function writeTourOutcome(
  key: string,
  outcome: TourOutcome,
  storage: Pick<Storage, 'setItem'> | undefined = defaultStorage(),
  now: Date = new Date(),
): void {
  try {
    storage?.setItem(key, JSON.stringify({ outcome, at: now.toISOString() }));
  } catch {
    // Storage unavailable or full: nothing to do.
  }
}

/** A tour opens by itself on the first visit only: no stored outcome yet. */
export function shouldAutoStart(
  key: string,
  storage: Pick<Storage, 'getItem'> | undefined = defaultStorage(),
): boolean {
  return readTourOutcome(key, storage) === undefined;
}
