/** Continuous resolution scaling: lowers the render scale while frames are slow, raises it back when there is headroom. */
export const SCALE_MIN = 0.5;
export const SCALE_MAX = 1;
const STEP_DOWN = 0.1;
const STEP_UP = 0.05;
/** Frame budget (ms) of a 60 Hz display; frames beyond SLOW_MS are "slow". */
const SLOW_MS = 20;
/** Frames at most this long (vsync-bound) count as "comfortable". */
const OK_MS = 17.5;
/** GPU time (ms) under which there is room to raise the resolution. */
const GPU_HEADROOM_MS = 9;
const WINDOW_MS = 1000;
/** A longer gap between frames means the tab was hidden: it says nothing about speed. */
const PAUSE_MS = 1000;
/** Start-up frames (shader compilation) are ignored. */
const WARM_UP_MS = 1500;
const UP_COOLDOWN_MS = 8000;

export interface RenderScaleController {
  readonly scale: number;
  /** Feed every frame (timestamp in ms, GPU ms when known). Returns the new scale when it changed. */
  onFrame(nowMs: number, gpuMs: number | null): number | undefined;
}

export function createRenderScaleController(): RenderScaleController {
  let scale = SCALE_MAX;
  let origin: number | undefined;
  let last = 0;
  let winStart = 0;
  let frames = 0;
  let sumMs = 0;
  let gpuSum = 0;
  let gpuN = 0;
  /** After a step down, the next raise waits; every bounce (raise followed by a drop) doubles the wait. */
  let upBlockedUntil = 0;
  let cooldown = UP_COOLDOWN_MS;
  let lastWasUp = false;
  const reset = (now: number): void => {
    winStart = now;
    frames = 0;
    sumMs = 0;
    gpuSum = 0;
    gpuN = 0;
  };
  return {
    get scale() {
      return scale;
    },
    onFrame(now, gpuMs) {
      if (origin === undefined || now - last > PAUSE_MS) {
        origin = now;
        last = now;
        reset(now);
        return undefined;
      }
      const dt = now - last;
      last = now;
      if (now - origin < WARM_UP_MS) {
        reset(now);
        return undefined;
      }
      frames += 1;
      sumMs += dt;
      if (gpuMs !== null) {
        gpuSum += gpuMs;
        gpuN += 1;
      }
      if (now - winStart < WINDOW_MS) return undefined;
      const avg = sumMs / frames;
      const gpuAvg = gpuN > 0 ? gpuSum / gpuN : null;
      reset(now);
      let next = scale;
      if (avg > SLOW_MS && scale > SCALE_MIN) {
        next = Math.max(SCALE_MIN, scale - STEP_DOWN);
        if (lastWasUp) cooldown = Math.min(cooldown * 2, 64000);
        lastWasUp = false;
        upBlockedUntil = now + cooldown;
      } else if (
        avg <= OK_MS &&
        scale < SCALE_MAX &&
        now >= upBlockedUntil &&
        (gpuAvg === null || gpuAvg < GPU_HEADROOM_MS)
      ) {
        next = Math.min(SCALE_MAX, scale + STEP_UP);
        lastWasUp = true;
        upBlockedUntil = now + cooldown;
      }
      next = Math.round(next * 100) / 100;
      if (next === scale) return undefined;
      scale = next;
      return scale;
    },
  };
}
