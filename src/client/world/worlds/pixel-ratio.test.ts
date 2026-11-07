import { describe, expect, it } from 'vitest';
import { PIXEL_BUDGET, renderPixelRatio, wantsAntialias } from './pixel-ratio';

describe('renderPixelRatio', () => {
  it('keeps the device ratio (≤2) for small canvases', () => {
    expect(renderPixelRatio(800, 600, true, 2)).toBe(2);
    expect(renderPixelRatio(800, 600, true, 3)).toBe(2);
    expect(renderPixelRatio(800, 600, false, 2)).toBe(1);
  });
  it('4K at DPR 1 renders at ratio 0.5 (≈2 Mpx)', () => {
    expect(renderPixelRatio(3840, 2160, true, 1)).toBeCloseTo(0.5, 5);
  });
  it('never exceeds the pixel budget for any CSS size × DPR × quality', () => {
    for (const w of [320, 800, 1280, 1920, 2560, 3840, 5120]) {
      for (const h of [240, 600, 1080, 1440, 2160]) {
        for (const dpr of [1, 1.25, 1.5, 2, 3]) {
          for (const high of [true, false]) {
            const r = renderPixelRatio(w, h, high, dpr);
            expect(w * r * (h * r)).toBeLessThanOrEqual(PIXEL_BUDGET + 1);
          }
        }
      }
    }
  });
  it('MSAA only below ratio 1.5', () => {
    expect(wantsAntialias(1)).toBe(true);
    expect(wantsAntialias(1.49)).toBe(true);
    expect(wantsAntialias(1.5)).toBe(false);
    expect(wantsAntialias(2)).toBe(false);
  });
});

describe('renderPixelRatio render scale', () => {
  it('multiplies the budgeted ratio by the continuous scale', () => {
    expect(renderPixelRatio(800, 600, true, 2, 0.5)).toBe(1);
    expect(renderPixelRatio(3840, 2160, true, 1, 0.5)).toBeCloseTo(0.25, 5);
  });
});
