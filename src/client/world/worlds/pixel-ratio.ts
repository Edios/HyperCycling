/** Largest drawing buffer we render, in pixels (1080p-class). A 4K canvas renders at half ratio. */
export const PIXEL_BUDGET = 2_073_600;
/** MSAA is only worth its memory/bandwidth when the effective ratio is below this. */
export const MSAA_MAX_RATIO = 1.5;

/**
 * Effective render ratio for a CSS-sized canvas: device ratio (≤ 2; 1 for low quality) further
 * reduced so width*height*ratio² never exceeds PIXEL_BUDGET, whatever the CSS size or DPR.
 */
export function renderPixelRatio(cssW: number, cssH: number, high: boolean, dpr?: number): number {
  const device = dpr ?? (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
  const want = high ? Math.min(device, 2) : 1;
  const area = Math.max(1, cssW) * Math.max(1, cssH);
  return Math.min(want, Math.sqrt(PIXEL_BUDGET / area));
}

/** MSAA only for low effective ratios (high ratios already hide aliasing). */
export const wantsAntialias = (ratio: number): boolean => ratio < MSAA_MAX_RATIO;

/** Calls `onChange` whenever devicePixelRatio changes (window moved to another screen, zoom). */
export function watchDevicePixelRatio(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => undefined;
  let mq: MediaQueryList | undefined;
  const handle = (): void => {
    onChange();
    listen();
  };
  function listen(): void {
    mq?.removeEventListener('change', handle);
    mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    mq.addEventListener('change', handle);
  }
  listen();
  return () => mq?.removeEventListener('change', handle);
}
