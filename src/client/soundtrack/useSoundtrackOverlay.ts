import { useEffect, useMemo } from 'react';
import type { ChainOptions } from '../../domain/music-chain';
import {
  compilePlan,
  withSoundtrack,
  type CompiledSoundtrack,
} from '../../domain/soundtrack-compile';
import { isOwnTrackId } from '../../domain/soundtrack-own';
import type { Workout } from '../../domain/workout';
import { loadSavedPlan, useSoundtrackSession } from './session';
import { useSoundtrackCatalog } from './useCatalog';

export interface SoundtrackOverlay {
  /** The workout with the matched music on top (the workout itself unless the plan applies). */
  workout: Workout;
  /**
   * none: nothing matched. loading / error: the catalog is on its way / failed. stale: the ride
   * changed after the match (or an own song of the plan was removed), so the plan is not applied.
   * ready: the music is on the workout.
   */
  state: 'none' | 'loading' | 'error' | 'stale' | 'ready';
  /** Why a plan is stale: the ride changed, or an own song of the plan was removed. */
  staleReason?: StaleReason;
  songs: number;
}

export type StaleReason = 'ride' | 'ownSongGone';

/**
 * Why a compiled plan may not play, or undefined when it may. A removed own song leaves a hole the
 * rider did not choose: match again, as for a changed ride (the ride's change is said first).
 */
export function staleReason(
  compiled: Pick<CompiledSoundtrack, 'stale' | 'missing'>,
): StaleReason | undefined {
  if (compiled.stale) return 'ride';
  if (compiled.missing.some(isOwnTrackId)) return 'ownSongGone';
  return undefined;
}

/**
 * The music matched for a workout in this visit, compiled onto it for the ride screen. The song
 * catalog is only fetched when there is a plan to compile.
 */
export function useSoundtrackOverlay(
  base: Workout,
  chain: Pick<ChainOptions, 'source' | 'spotifyUsable' | 'dead'>,
): SoundtrackOverlay {
  const plan = useSoundtrackSession((s) => s.plans[base.id]);
  // The plan saved on this device comes into the session the first time the workout is looked at.
  useEffect(() => {
    void loadSavedPlan(base.id);
  }, [base.id]);
  const catalog = useSoundtrackCatalog(plan !== undefined);
  return useMemo((): SoundtrackOverlay => {
    if (!plan) return { workout: base, state: 'none', songs: 0 };
    if (catalog.status === 'error') return { workout: base, state: 'error', songs: 0 };
    if (catalog.status !== 'ready') return { workout: base, state: 'loading', songs: 0 };
    const compiled = compilePlan(plan, base, { catalog: catalog.catalog, chain });
    const reason = staleReason(compiled);
    if (reason) return { workout: base, state: 'stale', staleReason: reason, songs: 0 };
    const songs = compiled.cues.reduce((n, c) => n + 1 + (c.queue?.length ?? 0), 0);
    return { workout: withSoundtrack(base, compiled), state: 'ready', songs };
  }, [plan, catalog.status, catalog.catalog, base, chain]);
}
