import { create } from 'zustand';
import type { Player } from '../../domain/player';
import type { PlanSlot } from '../../domain/plan';
import type { Segment } from '../../domain/segments';
import {
  createSessionEngine,
  restoreSessionEngine,
  type EngineEvent,
  type EngineSnapshot,
  type EngineState,
  type SessionEngine,
} from '../../domain/session-engine';
import type { ActiveSession } from '../../domain/session-log';
import type { SessionConfig } from '../../domain/settings';
import type { Workout } from '../../domain/workout';
import { getRepositories } from '../data/repositories';
import { createAutosave, type Autosave } from './autosave';
import { createWakeLock, type WakeLockController } from './wake-lock';

export { createAutosave } from './autosave';
export type { Autosave, AutosaveOptions } from './autosave';

export interface SessionRuntime {
  workout: Workout;
  /** Already flattened with the effort table from settings. */
  segments: Segment[];
  config: SessionConfig;
  players: Player[];
  plan?: { planId: string; week: number; slot: PlanSlot };
}

export interface SessionStore {
  runtime?: SessionRuntime;
  state: EngineState;
  muted: boolean;
  /** With a snapshot the engine is restored paused. */
  load(r: SessionRuntime, snapshot?: EngineSnapshot): void;
  start(): void;
  pause(): void;
  resume(): void;
  next(): void;
  prev(): void;
  /** Unloads the runtime and discards the active session. */
  stop(): void;
  toggleMute(): void;
  tick(): EngineEvent[];
}

const IDLE_STATE: EngineState = {
  status: 'idle',
  segmentIndex: 0,
  workoutElapsedSec: 0,
  segmentElapsedSec: 0,
  segmentRemainingSec: 0,
};

// ---- injectable clock (test hook) -------------------------------------------------------------

let clock: () => number = () => performance.now();
export function setSessionClock(fn: () => number): void {
  clock = fn;
}
export function resetSessionClock(): void {
  clock = () => performance.now();
}

// ---- side effects (wake lock + persistence), replaceable in tests -----------------------------

export interface SessionSideEffects {
  wakeLock: WakeLockController;
  save(a: ActiveSession): Promise<void>;
  clear(): Promise<void>;
}

let overrides: SessionSideEffects | null = null;
let defaultWakeLock: WakeLockController | undefined;
let autosave: Autosave | undefined;

/** Test hook: pass `null` to restore the real wake lock and repositories. */
export function configureSessionSideEffects(fx: SessionSideEffects | null): void {
  overrides = fx;
  autosave?.dispose();
  autosave = undefined;
}

function wakeLock(): WakeLockController {
  if (overrides) return overrides.wakeLock;
  defaultWakeLock ??= createWakeLock();
  return defaultWakeLock;
}

function save(a: ActiveSession): Promise<void> {
  if (overrides) return overrides.save(a);
  return getRepositories().then((r) => r.activeSession.put(a));
}

function clearActive(): Promise<void> {
  const p = overrides ? overrides.clear() : getRepositories().then((r) => r.activeSession.clear());
  return p.catch(() => undefined);
}

function getAutosave(): Autosave {
  autosave ??= createAutosave({ save, clear: clearActive });
  return autosave;
}

// ---- event bus ---------------------------------------------------------------------------------

type Listener = (e: EngineEvent, s: EngineState) => void;
const listeners = new Set<Listener>();

export function subscribeSessionEvents(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// ---- store -------------------------------------------------------------------------------------

let engine: SessionEngine | undefined;

export const useSessionStore = create<SessionStore>((set, get) => {
  const sync = (): void => {
    if (engine) set({ state: engine.getState() });
  };
  /** Wake lock follows the engine: held while counting down or running. */
  const syncWakeLock = (): void => {
    const status = engine?.getState().status;
    if (status === 'countdown' || status === 'running') void wakeLock().acquire();
    else void wakeLock().release();
  };
  const after = (immediateSave: boolean): void => {
    sync();
    syncWakeLock();
    if (immediateSave) getAutosave().onEvent(get());
  };

  return {
    runtime: undefined,
    state: IDLE_STATE,
    muted: false,

    load(r, snapshot) {
      autosave?.dispose();
      autosave = undefined;
      engine = snapshot
        ? restoreSessionEngine(r.segments, clock, snapshot)
        : createSessionEngine(r.segments, clock);
      set({ runtime: r, state: engine.getState() });
    },

    start() {
      if (!engine) return;
      engine.start();
      after(false);
    },

    pause() {
      if (!engine) return;
      engine.pause();
      after(true);
    },

    resume() {
      if (!engine) return;
      engine.resume();
      after(false);
    },

    next() {
      if (!engine) return;
      engine.next();
      after(true);
    },

    prev() {
      if (!engine) return;
      engine.prev();
      after(true);
    },

    stop() {
      const hadRuntime = engine !== undefined;
      engine = undefined;
      autosave?.dispose();
      autosave = undefined;
      set({ runtime: undefined, state: IDLE_STATE });
      void wakeLock().release();
      if (hadRuntime) void clearActive();
    },

    toggleMute() {
      set((s) => ({ muted: !s.muted }));
    },

    tick() {
      if (!engine) return [];
      const events = engine.tick();
      sync();
      const state = get().state;
      for (const e of events) for (const l of [...listeners]) l(e, state);
      if (events.some((e) => e.type === 'finished')) {
        autosave?.dispose();
        autosave = undefined;
        void wakeLock().release();
        void clearActive();
      } else if (events.some((e) => e.type === 'segmentChanged')) {
        getAutosave().onEvent(get());
      } else {
        getAutosave().onTick(get());
      }
      return events;
    },
  };
});
