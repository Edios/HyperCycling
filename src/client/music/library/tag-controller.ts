/**
 * Holds the one running tagging queue so it keeps going while the rider moves between screens
 * (the app is a single page), and tells the UI where it stands. Pause = abort between songs;
 * resume = start again, which skips the songs that are done (the library is the state).
 */
import { useSyncExternalStore } from 'react';
import type { BpmLookup } from '../bpmLookup';
import type { ErrorInfo } from '../provider-labels';
import { getSharedLibraryStore, type LibraryStore } from './library';
import { runTagQueue, type TagProgress } from './tag-queue';

export type TagPhase = 'idle' | 'running' | 'paused' | 'stopped' | 'finished';

export interface TagState {
  phase: TagPhase;
  progress: TagProgress | undefined;
  /** Why the queue stopped by itself (provider said no, or too many failures). */
  reason: ErrorInfo | undefined;
}

export interface TagController {
  getState(): TagState;
  subscribe(listener: () => void): () => void;
  start(lookup: Pick<BpmLookup, 'lookup'>): void;
  pause(): void;
}

const IDLE: TagState = { phase: 'idle', progress: undefined, reason: undefined };

export function createTagController(
  store: () => LibraryStore = getSharedLibraryStore,
  options: { paceMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
): TagController {
  let state: TagState = IDLE;
  let abort: AbortController | undefined;
  const listeners = new Set<() => void>();
  const set = (next: TagState): void => {
    state = next;
    listeners.forEach((l) => l());
  };
  return {
    getState: () => state,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    start(lookup) {
      if (state.phase === 'running') return;
      const ctl = new AbortController();
      abort = ctl;
      const lib = store();
      set({ phase: 'running', progress: undefined, reason: undefined });
      void runTagQueue({
        getTracks: () => lib.get(),
        patch: (id, change) => lib.update((cur) => cur.map((t) => (t.id === id ? change(t) : t))),
        lookup: (q) => lookup.lookup(q),
        signal: ctl.signal,
        onProgress: (progress) => {
          if (abort === ctl) set({ phase: 'running', progress, reason: undefined });
        },
        ...(options.paceMs !== undefined ? { paceMs: options.paceMs } : {}),
        ...(options.now ? { now: options.now } : {}),
        ...(options.sleep ? { sleep: options.sleep } : {}),
      }).then(
        (out) => {
          if (abort !== ctl) return;
          abort = undefined;
          if (out.status === 'finished')
            set({ phase: 'finished', progress: out.progress, reason: undefined });
          else if (out.status === 'aborted')
            set({ phase: 'paused', progress: out.progress, reason: undefined });
          else set({ phase: 'stopped', progress: out.progress, reason: out.reason });
        },
        () => {
          if (abort !== ctl) return;
          abort = undefined;
          set({
            phase: 'stopped',
            progress: state.progress,
            reason: { kind: 'network', provider: 'getsongbpm' },
          });
        },
      );
    },
    pause() {
      abort?.abort();
    },
  };
}

let shared: TagController | undefined;
export function getSharedTagController(): TagController {
  return (shared ??= createTagController());
}
/** Tests install their own controller; no argument restores the default. */
export function setTagControllerForTests(c?: TagController): void {
  shared = c;
}

export function useTagState(): TagState {
  const c = getSharedTagController();
  return useSyncExternalStore(c.subscribe, c.getState);
}

export function useSongLibrary(): import('./library').LibraryTrack[] {
  const s = getSharedLibraryStore();
  return useSyncExternalStore(s.subscribe, s.get);
}
