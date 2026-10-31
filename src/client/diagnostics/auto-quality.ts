export const AUTO_WINDOW_MS = 5000;
export const AUTO_MIN_FPS = 45;
/** A longer gap between frames means the tab was hidden: it says nothing about speed. */
const PAUSE_MS = 1000;

export interface AutoQuality {
  /** Feed every frame timestamp (ms). True exactly once: when a full window averaged < 45 fps. */
  onFrame(nowMs: number): boolean;
}

export function createAutoQuality(windowMs = AUTO_WINDOW_MS, minFps = AUTO_MIN_FPS): AutoQuality {
  let start: number | undefined;
  let last = 0;
  let frames = 0;
  let done = false;
  return {
    onFrame(now) {
      if (done) return false;
      if (start === undefined || now - last > PAUSE_MS) {
        start = now;
        last = now;
        frames = 0;
        return false;
      }
      last = now;
      frames += 1;
      const elapsed = now - start;
      if (elapsed < windowMs) return false;
      const fps = (frames * 1000) / elapsed;
      if (fps < minFps) {
        done = true;
        return true;
      }
      start = now;
      frames = 0;
      return false;
    },
  };
}
