import type { SoundtrackPlan } from '../../domain/soundtrack-plan';
import type { KeyValueStorage } from '../data/storage-compat';

/**
 * The songs of the last matched rides, kept on this device (music energy spec §3a): the planner
 * makes a song of a recent ride, and an artist played often lately, step back, so the music
 * changes from one ride to the next. A device choice like the wizard's prefs: not in exports.
 */
export const SOUNDTRACK_HISTORY_KEY = 'hypercycling.soundtrack.history';
/** Rides remembered (the oldest one goes). */
export const HISTORY_RIDES = 8;

export interface SoundtrackHistoryRide {
  /** When the plan was confirmed, ISO time. */
  at: string;
  workoutId: string;
  /** Catalog ids of the songs, in play order. */
  ids: string[];
}

interface StoredHistory {
  v: 1;
  rides: SoundtrackHistoryRide[];
}

function defaultStorage(): KeyValueStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

const isString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** The remembered rides, newest first; anything unreadable is left out (never an error). */
export function loadSoundtrackHistory(storage = defaultStorage()): SoundtrackHistoryRide[] {
  try {
    const raw = storage?.getItem(SOUNDTRACK_HISTORY_KEY);
    if (!raw) return [];
    const o = JSON.parse(raw) as Partial<StoredHistory> | null;
    if (!o || o.v !== 1 || !Array.isArray(o.rides)) return [];
    const rides: SoundtrackHistoryRide[] = [];
    for (const r of o.rides as unknown[]) {
      if (typeof r !== 'object' || r === null) continue;
      const { at, workoutId, ids } = r as Record<string, unknown>;
      if (!isString(at) || !isString(workoutId) || !Array.isArray(ids)) continue;
      rides.push({ at, workoutId, ids: ids.filter(isString).slice(0, 200) });
      if (rides.length >= HISTORY_RIDES) break;
    }
    return rides;
  } catch {
    return [];
  }
}

/** What the planner takes (`PlanOptions.history`): the catalog ids of each ride, newest first. */
export function historyIds(rides: readonly SoundtrackHistoryRide[]): string[][] {
  return rides.map((r) => r.ids);
}

/**
 * Remembers a confirmed plan as the newest ride: it replaces the entry of the same workout, and
 * only the last `HISTORY_RIDES` are kept. False when storage refused (the plan still works).
 */
export function recordSoundtrackRide(
  plan: SoundtrackPlan,
  now = new Date(),
  storage = defaultStorage(),
): boolean {
  try {
    if (!storage) return false;
    const ids = plan.sections.flatMap((s) => s.picks.map((p) => p.ref.id));
    const rides = [
      { at: now.toISOString(), workoutId: plan.workoutId, ids },
      ...loadSoundtrackHistory(storage).filter((r) => r.workoutId !== plan.workoutId),
    ].slice(0, HISTORY_RIDES);
    const stored: StoredHistory = { v: 1, rides };
    storage.setItem(SOUNDTRACK_HISTORY_KEY, JSON.stringify(stored));
    return true;
  } catch {
    return false;
  }
}

/**
 * A seed for a new opening of the wizard (spec §3b): from the clock, so each new plan differs,
 * while the seed stored in a plan still repeats it. The planner itself never reads the clock.
 */
export function freshSeed(nowMs = Date.now()): number {
  return Math.floor(nowMs) % 2 ** 31;
}
