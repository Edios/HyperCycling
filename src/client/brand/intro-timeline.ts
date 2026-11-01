import { logoSegments, tickCentre } from './geometry';

/** Timeline of the intro, in seconds. The whole intro, fade included, is TOTAL + FADE = 3.2 s. */
export const INTRO_TIMING = {
  /** Last frame of the animation; the final logo is held from WORDMARK_END until here. */
  end: 2.8,
  /** Cross-fade to the app. */
  fade: 0.4,
  /** The dotted line fades in. */
  lineIn: 0.35,
  /** First tick starts to lift, then each next one `stagger` later. */
  liftStart: 0.4,
  stagger: 0.06,
  lift: 1.0,
  wordmarkStart: 1.45,
  wordmarkEnd: 2.2,
} as const;

/** Stage is 1280x720; the mark is 100 units wide scaled by `scale`. */
export const STAGE = { w: 1280, h: 720 } as const;
export const MARK_SIZE = 360;

export interface IntroLayout {
  /** Mark box origin on the stage and its scale (stage px per mark unit). */
  left: number;
  top: number;
  scale: number;
  /** Wordmark text origin (left edge) and baselines. */
  wx: number;
  y1: number;
  y2: number;
  /** Where the dotted line runs (stage px). */
  x0: number;
  x1: number;
  yLine: number;
}

/** Lays out mark + wordmark centred on the stage, given the measured wordmark width. */
export function introLayout(wordmarkWidth: number): IntroLayout {
  const gap = 64;
  const left = (STAGE.w - (MARK_SIZE + gap + wordmarkWidth)) / 2;
  const top = (STAGE.h - MARK_SIZE) / 2 - 20;
  const cy = top + MARK_SIZE / 2;
  const lh = 124;
  const cap = 105;
  const y1 = cy - (lh + cap) / 2 + cap;
  const y2 = y1 + lh;
  const wx = left + MARK_SIZE + gap;
  return {
    left,
    top,
    scale: MARK_SIZE / 100,
    wx,
    y1,
    y2,
    x0: wx + 14,
    x1: wx + wordmarkWidth - 14,
    yLine: y2 + 70,
  };
}

const clamp = (x: number, a = 0, b = 1): number => Math.min(b, Math.max(a, x));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const outCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

export interface TickState {
  /** SVG transform to apply to the tick's final path (identity at rest). */
  transform: string;
  opacity: number;
}

export interface IntroState {
  ticks: TickState[];
  /** HYPER then CYCLING: opacity and x offset in stage px. */
  words: { opacity: number; dx: number }[];
}

/**
 * Pure state of the intro at `time` seconds. Every tick is the final LogoMark path; before the
 * lift it is shrunk to a dash, turned flat and parked on the dotted line, so at rest it is exactly
 * the logo geometry.
 */
export function introState(time: number, layout: IntroLayout): IntroState {
  const ticks: TickState[] = [];
  const n = logoSegments(MARK_SIZE).length;
  for (let i = 0; i < n; i++) {
    const c = tickCentre(i, MARK_SIZE);
    const p = outCubic(
      clamp((time - INTRO_TIMING.liftStart - i * INTRO_TIMING.stagger) / INTRO_TIMING.lift),
    );
    const sx = (lerp(layout.x0, layout.x1, i / (n - 1)) - layout.left) / layout.scale;
    const sy = (layout.yLine - layout.top) / layout.scale;
    // Flat (tangent horizontal) at the start, upright in the logo at the end.
    const flat = -((((c.angle + 90 + 180) % 360) + 360) % 360) + 180;
    const x = lerp(sx, c.x, p);
    const y = lerp(sy, c.y, p) - Math.sin(Math.PI * p) * 16;
    const s = lerp(0.4, 1, p);
    ticks.push({
      transform: `translate(${x.toFixed(3)} ${y.toFixed(3)}) rotate(${(flat * (1 - p)).toFixed(3)}) scale(${s.toFixed(4)}) translate(${(-c.x).toFixed(3)} ${(-c.y).toFixed(3)})`,
      opacity: clamp(time / INTRO_TIMING.lineIn),
    });
  }
  const words = [0, 0.12].map((delay) => {
    const u = outCubic(
      clamp(
        (time - INTRO_TIMING.wordmarkStart - delay) /
          (INTRO_TIMING.wordmarkEnd - INTRO_TIMING.wordmarkStart - 0.12),
      ),
    );
    return { opacity: u, dx: (1 - u) * -60 };
  });
  return { ticks, words };
}
