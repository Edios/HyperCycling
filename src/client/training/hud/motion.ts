import type { CSSProperties } from 'react';

/**
 * One place for HUD motion timing (round 11): every duration goes through `ms()`, so "Effects off"
 * and prefers-reduced-motion mean 0 ms everywhere. Callers pass the already combined flag
 * (reduced motion || effects off) they get from the training screen.
 */
export function ms(duration: number, reduced: boolean): number {
  return reduced ? 0 : duration;
}

/** Focus: the HUD arrives fast (mouse move) and leaves slowly; the rest screen is the mirror. */
export const FOCUS_IN_MS = 180;
export const FOCUS_OUT_MS = 700;

/**
 * Opacity fade for something that comes and goes (inline, so the off switch is one place).
 * `visibility` follows after a fade out, so a hidden layer is also out of reach of the keyboard.
 */
export function fadeStyle(
  visible: boolean,
  enterMs: number,
  leaveMs: number,
  reduced: boolean,
): CSSProperties {
  const duration = ms(visible ? enterMs : leaveMs, reduced);
  return {
    transitionDuration: `${duration}ms, 0ms`,
    transitionDelay: `0ms, ${visible ? 0 : duration}ms`,
  };
}
