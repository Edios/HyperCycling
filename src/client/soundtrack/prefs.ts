import { FIRST_VISIT_PREFS, parseSoundtrackPrefs } from '../../domain/soundtrack-wizard';
import type { SoundtrackPrefs } from '../../domain/soundtrack-plan';
import { readCompat, type KeyValueStorage } from '../data/storage-compat';

/** The wizard's last choice, kept on this device (not part of exports: it is a device choice). */
export const SOUNDTRACK_PREFS_KEY = 'hypercycling.soundtrack.prefs';

function defaultStorage(): KeyValueStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** The stored choice, or the first-visit one when nothing (or nothing readable) is stored. */
export function loadSoundtrackPrefs(storage = defaultStorage()): SoundtrackPrefs {
  try {
    const raw = storage ? readCompat(storage, SOUNDTRACK_PREFS_KEY) : null;
    return raw === null ? { ...FIRST_VISIT_PREFS } : parseSoundtrackPrefs(JSON.parse(raw));
  } catch {
    return { ...FIRST_VISIT_PREFS };
  }
}

/** False when the choice could not be stored (blocked storage); the wizard goes on regardless. */
export function saveSoundtrackPrefs(prefs: SoundtrackPrefs, storage = defaultStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(SOUNDTRACK_PREFS_KEY, JSON.stringify(prefs));
    return true;
  } catch {
    return false;
  }
}
