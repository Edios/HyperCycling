import { parseCatalog, type CatalogTrack } from '../../domain/soundtrack-catalog';

let pending: Promise<readonly CatalogTrack[]> | undefined;

/**
 * The curated soundtrack catalog, loaded on first use only (≈ 100 KB of JSON, its own chunk), so
 * the start bundle does not grow. Validated once; a broken file rejects (and the next call tries
 * again) instead of feeding the planner half-checked data.
 */
export function loadSoundtrackCatalog(): Promise<readonly CatalogTrack[]> {
  pending ??= import('../../content/soundtrack/catalog.json')
    .then((m) => parseCatalog(m.default).tracks)
    .catch((e: unknown) => {
      pending = undefined;
      throw e;
    });
  return pending;
}
