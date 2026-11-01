/** How the intro plays: the full animation, a short static logo, or not at all. */
export type IntroMode = 'full' | 'static' | 'none';

export interface IntroEnv {
  /** Build made for end-to-end tests (VITE_E2E). */
  e2e: boolean;
  /** navigator.webdriver: the page is driven by automation. */
  webdriver: boolean;
  reducedMotion: boolean;
  /** Settings "effects intensity" is 0 (Effects: off). */
  effectsOff: boolean;
}

/**
 * The intro plays on every load of the app shell (not on in-app navigation). It never plays for
 * tests or automation, shows a still logo under reduced motion and is skipped with Effects off.
 */
export function introMode(env: IntroEnv): IntroMode {
  if (env.e2e || env.webdriver || env.effectsOff) return 'none';
  return env.reducedMotion ? 'static' : 'full';
}
