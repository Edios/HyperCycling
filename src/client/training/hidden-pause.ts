import type { EngineStatus } from '../../domain/session-engine';

/**
 * Auto-pause when the app leaves the screen on a phone (owner bug #17, task R5.3).
 *
 * A phone suspends the YouTube player when the browser is minimised, another app is opened or the
 * screen is locked, and it does not play again without a tap. So on a phone the ride pauses as the
 * page is hidden and a "Resume" card waits for that tap: the tap resumes the ride, and the music
 * goes on from the same place. A computer keeps riding with the tab in the background.
 */
export type HiddenPauseAction = 'pause' | 'takeOver' | 'none';

export function hiddenPauseAction(input: {
  mobile: boolean;
  status: EngineStatus;
  /** The ride is paused by the trainer's auto-pause, which would resume it by itself. */
  trainerAutoPaused: boolean;
}): HiddenPauseAction {
  if (!input.mobile) return 'none';
  if (input.status === 'running') return 'pause';
  // Paused already by the trainer going silent: resume it from the tap, not from the signal.
  if (input.status === 'paused' && input.trainerAutoPaused) return 'takeOver';
  return 'none';
}

interface Listenable {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

/** Calls `onHidden` when the page is hidden (visibilitychange) or left (pagehide). */
export function watchPageHidden(
  doc: Listenable & { readonly visibilityState: DocumentVisibilityState },
  win: Listenable,
  onHidden: () => void,
): () => void {
  const onVisibility = (): void => {
    if (doc.visibilityState === 'hidden') onHidden();
  };
  doc.addEventListener('visibilitychange', onVisibility);
  win.addEventListener('pagehide', onHidden);
  return () => {
    doc.removeEventListener('visibilitychange', onVisibility);
    win.removeEventListener('pagehide', onHidden);
  };
}

interface MobileEnv {
  matchMedia?: (query: string) => { matches: boolean };
  navigator: { userAgentData?: { mobile?: boolean } };
}

/** A phone or tablet: a touch-first screen, or a browser that reports itself as mobile. */
export function isMobileDevice(env: MobileEnv = window as unknown as MobileEnv): boolean {
  if (env.navigator.userAgentData?.mobile === true) return true;
  return !!env.matchMedia?.('(pointer: coarse)').matches;
}
