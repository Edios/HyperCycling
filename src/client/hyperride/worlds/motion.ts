const QUERY = '(prefers-reduced-motion: reduce)';

/** The OS reduced-motion preference, read once when a world starts. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(QUERY).matches
    : false;
}

/** Frame time that drives movement: zero under reduced motion, so the scene stands still. */
export function motionDt(dtSec: number, reduced: boolean): number {
  return reduced ? 0 : dtSec;
}
