import { logoSegments, tickCentre } from './geometry';

/**
 * Timeline of the intro, in seconds. The intro is plain markup in index.html animated by CSS
 * (src/client/brand/intro-boot.css), so it runs on the compositor and starts with the first paint.
 * The whole intro, fade included, is `end + fade` = 1.5 s. KEEP the numbers in the CSS in sync;
 * a test checks them.
 */
export const INTRO_TIMING = {
  /** The overlay starts to fade out. */
  end: 1.25,
  fade: 0.25,
  /** Ticks fade in on the dotted line. */
  lineIn: 0.2,
  /** First tick starts to lift, then each next one `stagger` later. */
  liftStart: 0.1,
  stagger: 0.03,
  lift: 0.6,
  /** HYPER, then CYCLING `wordDelay` later. */
  wordStart: 0.55,
  wordDelay: 0.07,
  word: 0.4,
} as const;

export const MARK_SIZE = 360;

/** Stage is 1280x720 units; the wordmark is assumed ~360 units wide for the dotted line. */
const STAGE = { w: 1280, h: 720 };
const GAP = 64;
const WORD_W = 360;

export interface TickStart {
  /** Start position (in mark units), tangent rotation (deg) and size. */
  x: number;
  y: number;
  rot: number;
  /** Negative centre of the final tick, so scale/rotate happen about it. */
  nx: number;
  ny: number;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Where tick `i` waits: a small flat dash on the dotted line under the (not yet shown) name. */
export function tickStart(i: number): TickStart {
  const n = logoSegments(MARK_SIZE).length;
  const scale = MARK_SIZE / 100;
  const left = (STAGE.w - (MARK_SIZE + GAP + WORD_W)) / 2;
  const top = (STAGE.h - MARK_SIZE) / 2 - 20;
  const wx = left + MARK_SIZE + GAP;
  const lh = 124;
  const cap = 105;
  const y1 = top + MARK_SIZE / 2 - (lh + cap) / 2 + cap;
  const yLine = y1 + lh + 70;
  const c = tickCentre(i, MARK_SIZE);
  const flat = -((((c.angle + 90 + 180) % 360) + 360) % 360) + 180;
  return {
    x: (lerp(wx + 14, wx + WORD_W - 14, i / (n - 1)) - left) / scale,
    y: (yLine - top) / scale,
    rot: flat,
    nx: -c.x,
    ny: -c.y,
  };
}

const f = (x: number): string => `${x.toFixed(2)}px`;

/** CSS rules `.tN{...}` with each tick's start state; pasted between markers in intro-boot.css. */
export function tickVarsCss(): string {
  return logoSegments(MARK_SIZE)
    .map((_, i) => {
      const s = tickStart(i);
      const delay = INTRO_TIMING.liftStart + i * INTRO_TIMING.stagger;
      return `.t${i} { --sx: ${f(s.x)}; --sy: ${f(s.y)}; --rot: ${s.rot.toFixed(2)}deg; --nx: ${f(s.nx)}; --ny: ${f(s.ny)}; --d: ${delay.toFixed(2)}s; }`;
    })
    .join('\n');
}
