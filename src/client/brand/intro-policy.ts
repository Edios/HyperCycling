/** How the intro plays: the full animation, a short static logo, or not at all. */
export type IntroMode = 'full' | 'static' | 'none';

/** Settings "Show intro": every visit, at most once a week (default) or never. */
export type IntroPref = 'always' | 'rare' | 'never';
export const INTRO_PREFS: readonly IntroPref[] = ['always', 'rare', 'never'];
export const DEFAULT_INTRO_PREF: IntroPref = 'rare';

/** After a shown intro the next one waits this long (in "rare" mode). */
export const INTRO_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * localStorage keys. They are read synchronously by `public/intro-boot.js` before the first paint
 * (the Settings repository is asynchronous), so the intro choice lives here, not in Settings.
 * KEEP IN SYNC with public/intro-boot.js (a test runs both against the same cases).
 */
export const INTRO_KEYS = {
  last: 'hypercycling.intro.last',
  pref: 'hypercycling.intro.pref',
  effectsOff: 'hypercycling.intro.fx',
} as const;

export interface IntroEnv {
  /** Build made for end-to-end tests (VITE_E2E). */
  e2e: boolean;
  /** navigator.webdriver: the page is driven by automation. */
  webdriver: boolean;
  reducedMotion: boolean;
  /** Settings "effects intensity" is 0 (Effects: off). */
  effectsOff: boolean;
  pref: IntroPref;
  /** When the intro was last started (ms since epoch), null when never or unknown. */
  lastShownAt: number | null;
  now: number;
}

/**
 * The first visit always plays the intro; later ones follow the preference (default: at most once
 * every 7 days). It never plays for tests or automation, shows a still logo under reduced motion
 * and is skipped with Effects off. Unreadable storage means "first visit".
 */
export function introMode(env: IntroEnv): IntroMode {
  if (env.e2e || env.webdriver || env.effectsOff || env.pref === 'never') return 'none';
  if (env.pref === 'rare' && env.lastShownAt !== null) {
    const age = env.now - env.lastShownAt;
    // A timestamp from the future (clock change) counts as unknown, not as "just shown".
    if (age >= 0 && age < INTRO_INTERVAL_MS) return 'none';
  }
  return env.reducedMotion ? 'static' : 'full';
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function readIntroPref(): IntroPref {
  const v = read(INTRO_KEYS.pref);
  return INTRO_PREFS.find((p) => p === v) ?? DEFAULT_INTRO_PREF;
}

export function writeIntroPref(pref: IntroPref): void {
  try {
    localStorage.setItem(INTRO_KEYS.pref, pref);
  } catch {
    // Storage unavailable: the choice just does not persist.
  }
}

/** Mirrors Settings "Effects: off" so the next load can decide before Settings are read. */
export function writeIntroEffectsOff(off: boolean): void {
  try {
    if (off) localStorage.setItem(INTRO_KEYS.effectsOff, '1');
    else localStorage.removeItem(INTRO_KEYS.effectsOff);
  } catch {
    // Ignored, see above.
  }
}
