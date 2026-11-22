import { useCallback, useEffect, useState } from 'react';
import type { CatalogTrack } from '../../domain/soundtrack-catalog';
import { loadSoundtrackCatalog } from '../data/soundtrack-catalog';

export type CatalogState =
  | { status: 'idle' | 'loading' | 'error'; catalog: readonly CatalogTrack[] }
  | { status: 'ready'; catalog: readonly CatalogTrack[] };

const NONE: readonly CatalogTrack[] = [];

/**
 * The song catalog, fetched on first use (its own chunk). `enabled = false` loads nothing, so a
 * screen that may not need it (the ride setup without matched music) never pays for it.
 */
export function useSoundtrackCatalog(enabled = true): CatalogState & { retry(): void } {
  // What the last attempt brought; `attempt` tells which one, so a retry reads as "loading" again.
  const [result, setResult] = useState<{
    attempt: number;
    catalog: readonly CatalogTrack[] | undefined;
  }>();
  const [attempt, setAttempt] = useState(0);
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
  if (result?.catalog) return { status: 'ready', catalog: result.catalog, retry };
  if (!enabled) return { status: 'idle', catalog: NONE, retry };
  const failed = result !== undefined && result.attempt === attempt;
  return { status: failed ? 'error' : 'loading', catalog: NONE, retry };
}
