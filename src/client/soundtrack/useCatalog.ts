import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CatalogTrack } from '../../domain/soundtrack-catalog';
import { withOwnTracks } from '../../domain/soundtrack-own';
import { loadSoundtrackCatalog } from '../data/soundtrack-catalog';
import { loadOwnTracks, useOwnTracks } from './own-tracks';

export type CatalogState =
  | { status: 'idle' | 'loading' | 'error'; catalog: readonly CatalogTrack[] }
  | { status: 'ready'; catalog: readonly CatalogTrack[] };

const NONE: readonly CatalogTrack[] = [];

/**
 * The song catalog, fetched on first use (its own chunk), with the rider's own songs after it
 * (read from the device; the planner takes them only when "use my songs" is on). `enabled = false`
 * loads nothing, so a screen that may not need it (the ride setup without matched music) never
 * pays for it. It is ready once both are there, so a saved plan with own songs compiles whole.
 */
export function useSoundtrackCatalog(enabled = true): CatalogState & { retry(): void } {
  // What the last attempt brought; `attempt` tells which one, so a retry reads as "loading" again.
  const [result, setResult] = useState<{
    attempt: number;
    catalog: readonly CatalogTrack[] | undefined;
  }>();
  const [attempt, setAttempt] = useState(0);
  const own = useOwnTracks((s) => s.tracks);
  const ownLoaded = useOwnTracks((s) => s.loaded);
  useEffect(() => {
    if (enabled) void loadOwnTracks();
  }, [enabled]);
  const base = result?.catalog;
  const merged = useMemo(() => (base ? withOwnTracks(base, own) : undefined), [base, own]);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    loadSoundtrackCatalog().then(
      (catalog) => {
        if (live) setResult({ attempt, catalog });
      },
      (err: unknown) => {
        console.warn('Loading the soundtrack catalog failed', err);
        if (live) setResult({ attempt, catalog: undefined });
      },
    );
    return () => {
      live = false;
    };
  }, [enabled, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  if (merged && ownLoaded) return { status: 'ready', catalog: merged, retry };
  if (!enabled) return { status: 'idle', catalog: NONE, retry };
  const failed = result !== undefined && !result.catalog && result.attempt === attempt;
  return { status: failed ? 'error' : 'loading', catalog: NONE, retry };
}
