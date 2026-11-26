import { describe, expect, it } from 'vitest';
import { formatViewport, readViewport, type ViewportEnv } from './viewport-info';

const env = (o: Partial<ViewportEnv> = {}): ViewportEnv => ({
  innerWidth: 390,
  innerHeight: 664,
  visualHeight: 640,
  devicePixelRatio: 3,
  orientation: 'portrait-primary',
  probe: () => ({
    dvh: 664,
    svh: 600,
    lvh: 750,
    safeTop: 47,
    safeRight: 0,
    safeBottom: 34,
    safeLeft: 0,
  }),
  ...o,
});

describe('viewport info', () => {
  it('collects size, dvh, safe area and orientation', () => {
    expect(readViewport(env())).toEqual({
      width: 390,
      height: 664,
      visualHeight: 640,
      dpr: 3,
      dvh: 664,
      svh: 600,
      lvh: 750,
      safe: { top: 47, right: 0, bottom: 34, left: 0 },
      orientation: 'portrait-primary',
    });
  });

  it('formats one short line for the overlay', () => {
    expect(formatViewport(readViewport(env()))).toBe(
      '390x664@3 vv640 dvh664 svh600 lvh750 safe 47/0/34/0 portrait',
    );
  });

  it('survives a missing probe', () => {
    const v = readViewport(env({ probe: () => null, orientation: undefined }));
    expect(formatViewport(v)).toBe('390x664@3 vv640 dvh- svh- lvh- safe -/-/-/- -');
  });
});
