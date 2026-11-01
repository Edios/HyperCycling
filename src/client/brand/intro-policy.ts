const SEEN_KEY = 'hypercycling.intro';

export interface IntroEnv {
  /** Build made for end-to-end tests (VITE_E2E). */
  e2e: boolean;
  /** navigator.webdriver: the page is driven by automation. */
  webdriver: boolean;
  reducedMotion: boolean;
  /** Settings "effects intensity" is 0 (Effects: off). */
  effectsOff: boolean;
  /** The URL is the app's start page (no deep link into a screen). */
  atStart: boolean;
  alreadySeen: boolean;
}

/** The intro plays once per session, on the start page, and never for tests or reduced effects. */
export function shouldShowIntro(env: IntroEnv): boolean {
  return (
    !env.e2e &&
    !env.webdriver &&
    !env.reducedMotion &&
    !env.effectsOff &&
    env.atStart &&
    !env.alreadySeen
  );
}

export function introSeen(): boolean {
  try {
    return sessionStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function markIntroSeen(): void {
  try {
    sessionStorage.setItem(SEEN_KEY, '1');
  } catch {
    // Blocked storage: the intro may play again after a reload, which is harmless.
  }
}
