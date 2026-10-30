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

let engine: SessionEngine | undefined;
let overrides: SessionSideEffects | null = null;
let defaultWakeLock: WakeLockController | undefined;
let autosave: Autosave | undefined;

/** Test hook: pass `null` to restore the real wake lock and repositories. */
export function configureSessionSideEffects(fx: SessionSideEffects | null): void {
  overrides = fx;
  disposeAutosave();
}

function wakeLock(): WakeLockController {
  if (overrides) return overrides.wakeLock;
  defaultWakeLock ??= createWakeLock();
  return defaultWakeLock;
}

/** All persistence runs on one chain so a late save can never land after a clear. */
let chain: Promise<void> = Promise.resolve();
/** Bumped whenever pending saves must be dropped (dispose, stop, finish, load). */
let generation = 0;

function enqueue(op: () => Promise<void>, label: string): Promise<void> {
  const run = async (): Promise<void> => {
    try {
      await op();
    } catch (err) {
      console.warn(label + ' failed', err);
    }
  };
  chain = chain.then(run);
  return chain;
}

function rawSave(fx: SessionSideEffects | null, a: ActiveSession): Promise<void> {
  if (fx) return fx.save(a);
  return getRepositories().then((r) => r.activeSession.put(a));
}

function rawClear(fx: SessionSideEffects | null): Promise<void> {
  if (fx) return fx.clear();
  return getRepositories().then((r) => r.activeSession.clear());
}

function save(a: ActiveSession): Promise<void> {
  const gen = generation;
  const fx = overrides;
  return enqueue(async () => {
    if (gen === generation) await rawSave(fx, a);
  }, 'Autosave');
}

function clearActive(): Promise<void> {
  generation++; // drop saves that have not started yet
  const fx = overrides;
  return enqueue(() => rawClear(fx), 'Clearing active session');
}

function disposeAutosave(): void {
  generation++;
  autosave?.dispose();
  autosave = undefined;
}

function getAutosave(): Autosave {
  autosave ??= createAutosave({
    save,
    clear: clearActive,
    canResume: () => engine?.canResume() ?? false,
  });
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
      if (engine) {
        // Unload the previous session cleanly. Resuming from a snapshot keeps the stored record.
        engine = undefined;
        disposeAutosave();
        void wakeLock().release();
        if (!snapshot) void clearActive();
      }
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
      disposeAutosave();
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
      const finished = events.some((e) => e.type === 'finished');
      try {
        for (const e of events) {
          for (const l of [...listeners]) {
            try {
              l(e, state);
            } catch (err) {
              console.error('Session event listener failed', err);
            }
          }
        }
      } finally {
        if (finished) {
          disposeAutosave();
          void wakeLock().release();
          void clearActive();
        }
      }
      if (!finished) {
        if (events.some((e) => e.type === 'segmentChanged')) getAutosave().onEvent(get());
        else getAutosave().onTick(get());
      }
      return events;
    },
  };
});
