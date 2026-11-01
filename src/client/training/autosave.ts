import type { ActiveSession } from '../../domain/session-log';
import type { SessionStore } from './session-store';

export interface Autosave {
  /** Call every frame; saves at most once per interval while running. */
  onTick(s: SessionStore): void;
  /** Saves immediately (segment change, pause). Uses `s` or the last store seen by onTick. */
  onEvent(s?: SessionStore): void;
  dispose(): void;
}

export interface AutosaveOptions {
  save(a: ActiveSession): Promise<void>;
  clear(): Promise<void>;
  intervalMs?: number;
  /** Persistence gate (the engine's canResume). Defaults to running/paused state. */
  canResume?(): boolean;
}

/** Builds the record to persist, or undefined when a snapshot would be meaningless. */
export function toActiveSession(
  s: SessionStore,
  canResume?: () => boolean,
): ActiveSession | undefined {
  const { runtime, state } = s;
  if (!runtime) return undefined;
  if (state.status !== 'running' && state.status !== 'paused') return undefined;
  if (canResume && !canResume()) return undefined;
  const active: ActiveSession = {
    workoutId: runtime.workout.id,
    config: runtime.config,
    snapshot: {
      segmentIndex: state.segmentIndex,
      workoutElapsedSec: state.workoutElapsedSec,
      status: state.status,
    },
    savedAt: new Date().toISOString(),
  };
  if (runtime.plan) active.plan = runtime.plan;
  return active;
}

export function createAutosave(opts: AutosaveOptions): Autosave {
  const intervalMs = opts.intervalMs ?? 5000;
  let last: SessionStore | undefined;
  let lastSavedAt = Number.NEGATIVE_INFINITY;
  let disposed = false;

  function write(s: SessionStore): void {
    const a = toActiveSession(s, opts.canResume);
    if (!a) return;
    lastSavedAt = Date.now();
    try {
      opts.save(a).catch((err: unknown) => console.warn('Autosave failed', err));
    } catch (err) {
      console.warn('Autosave failed', err); // persistence failures never affect the workout
    }
  }

  return {
    onTick(s) {
      last = s;
      if (disposed || s.state.status !== 'running') return;
      if (Date.now() - lastSavedAt >= intervalMs) write(s);
    },
    onEvent(s) {
      const target = s ?? last;
      if (disposed || !target) return;
      last = target;
      write(target);
    },
    dispose() {
      disposed = true;
      last = undefined;
    },
  };
}
