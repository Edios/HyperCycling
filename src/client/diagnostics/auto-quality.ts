export const AUTO_WINDOW_MS = 5000;
export const AUTO_MIN_FPS = 45;
/** Start-up frames (shader compilation, world loading) say nothing about steady-state speed. */
export const AUTO_WARM_UP_MS = 1500;
/** Consecutive slow windows needed before lowering the quality. */
const LOW_WINDOWS = 2;
/** A longer gap between frames means the tab was hidden: it says nothing about speed. */
const PAUSE_MS = 1000;

export interface AutoQuality {
  /** Feed every frame timestamp (ms). True exactly once: after two consecutive windows under 45 fps. */
  onFrame(nowMs: number): boolean;
}

export function createAutoQuality(
  windowMs = AUTO_WINDOW_MS,
  minFps = AUTO_MIN_FPS,
  warmUpMs = AUTO_WARM_UP_MS,
): AutoQuality {
  let origin: number | undefined; // start of the warm-up
  let start: number | undefined; // start of the current window
  let last = 0;
  let frames = 0;
  let lows = 0;
  let done = false;
  return {
    onFrame(now) {
      if (done) return false;
      if (origin === undefined || now - last > PAUSE_MS) {
        origin = now;
        last = now;
        start = undefined;
        frames = 0;
        lows = 0;
        return false;
      }
      last = now;
      if (now - origin < warmUpMs) return false;
      if (start === undefined) {
        start = now;
        frames = 0;
        return false;
      }
      frames += 1;
      const elapsed = now - start;
      if (elapsed < windowMs) return false;
      const fps = (frames * 1000) / elapsed;
      start = now;
      frames = 0;
      if (fps >= minFps) {
        lows = 0;
        return false;
      }
      lows += 1;
      if (lows < LOW_WINDOWS) return false;
      done = true;
      return true;
    },
  };
}
