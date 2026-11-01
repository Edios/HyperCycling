/**
 * Storage key naming across the rebrand (Spinning Tutor -> HyperCycling). New data is written
 * under the `hypercycling.` prefix only. A value found under the legacy `spinning-tutor.` name is
 * copied to the new name on first read and the legacy entry is left untouched, so an older build
 * opened later still finds its data.
 */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const LEGACY_PREFIX = 'spinning-tutor.';
export const PREFIX = 'hypercycling.';

export function legacyKey(key: string): string {
  return key.startsWith(PREFIX) ? LEGACY_PREFIX + key.slice(PREFIX.length) : key;
}

/** Reads `key`; when absent falls back to its legacy name and migrates (copies) the value. */
export function readCompat(storage: KeyValueStorage, key: string): string | null {
  const current = storage.getItem(key);
  if (current !== null) return current;
  const old = storage.getItem(legacyKey(key));
  if (old === null) return null;
  try {
    storage.setItem(key, old);
  } catch {
    // The copy is best effort; the value is still returned.
  }
  return old;
}

/** Removes `key` and its legacy name: a cleared entry must not come back through the fallback. */
export function removeCompat(storage: KeyValueStorage, key: string): void {
  storage.removeItem(key);
  storage.removeItem(legacyKey(key));
}
