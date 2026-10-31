import { create } from 'zustand';
import type { PlanSlot } from '../../domain/plan';
import type { Player } from '../../domain/player';
import type { SessionConfig } from '../../domain/settings';
import type { Workout } from '../../domain/workout';

export interface LastResult {
  workout: Workout;
  riddenSec: number;
  completed: boolean;
  config: SessionConfig;
  players: Player[];
  startedAt: string;
  plan?: { planId: string; week: number; slot: PlanSlot; cycle?: number };
  /** True when read back from session storage after a reload: it was already logged and counted. */
  restored?: true;
}

interface LastResultStore {
  result?: LastResult;
  set(r: LastResult): void;
  clear(): void;
}

const STORAGE_KEY = 'spinning-tutor.lastResult';

function isStored(v: unknown): v is LastResult {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r['workout'] === 'object' &&
    r['workout'] !== null &&
    typeof r['riddenSec'] === 'number' &&
    typeof r['completed'] === 'boolean' &&
    typeof r['config'] === 'object' &&
    r['config'] !== null &&
    Array.isArray(r['players']) &&
    typeof r['startedAt'] === 'string'
  );
}

/** The result a reload would otherwise lose; undefined when nothing valid is stored. */
export function loadStoredResult(): LastResult | undefined {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return isStored(parsed) ? { ...parsed, restored: true } : undefined;
  } catch {
    return undefined;
  }
}

function storeResult(r: LastResult): void {
  try {
    const plain: LastResult = { ...r };
    delete plain.restored;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(plain));
  } catch (err) {
    console.warn('Keeping the last result for a reload failed', err);
  }
}

export function clearStoredResult(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage may be blocked; the summary then simply does not survive a reload.
  }
}

/**
 * Hand-over from the training screen to the summary screen. It is also kept in session storage so
 * a reload of the summary page still shows the result and the FTP test card.
 */
export const useLastResult = create<LastResultStore>((set) => ({
  result: loadStoredResult(),
  set: (result) => {
    storeResult(result);
    set({ result });
  },
  clear: () => {
    clearStoredResult();
    set({ result: undefined });
  },
}));
