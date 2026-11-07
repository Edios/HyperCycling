import { describe, expect, it } from 'vitest';
import { THEMES } from './scenes-themes';
import type { SceneLook } from './scenes-registry';

const looks = THEMES['neon-grid']!.scene.variants;

function hue(hex: string): { h: number; s: number; v: number } {
  const n = parseInt(hex.slice(1, 7), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const mx = Math.max(r, g, b);
  const d = mx - Math.min(r, g, b);
  let h = 0;
  if (d > 0) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return { h: (h * 60 + 360) % 360, s: mx === 0 ? 0 : d / mx, v: mx };
}

/** How different two looks read at a glance (hue of the lines and sky, terrain shape, pattern, speed). */
function distance(a: SceneLook, b: SceneLook): number {
  const dh = (x: string, y: string): number => {
    const p = hue(x);
    const q = hue(y);
    // low-saturation colours (white, grey) have no hue: compare by brightness instead
    if (p.s < 0.25 || q.s < 0.25) return Math.abs(p.v - q.v) * 90;
    const d = Math.abs(p.h - q.h);
    return Math.min(d, 360 - d);
  };
  let score = dh(a.line, b.line) / 3 + dh(a.skyHorizon, b.skyHorizon) / 3;
  score += Math.abs(a.height - b.height) / 4;
  score += a.pattern !== b.pattern ? 25 : 0;
  score += Math.abs(a.speedMul - b.speedMul) * 40;
  score += Math.abs(a.warp - b.warp) * 25;
  score += Math.abs(a.objDensity - b.objDensity) * 25;
  score += Math.abs(a.sunSize - b.sunSize) * 150;
  return score;
}

describe('Neon Grid chapters', () => {
  it('has the seven looks the Experience refers to', () => {
    expect(looks).toHaveLength(7);
    expect(Object.keys(THEMES['neon-grid']!.looks)).toHaveLength(7);
  });

  it('makes every chapter stand apart from the previous one at a glance', () => {
    for (let i = 1; i < looks.length; i++) {
      expect(distance(looks[i - 1]!, looks[i]!), `look ${i - 1} -> ${i}`).toBeGreaterThan(30);
    }
  });

  it('spreads across at least four hue families over the ride (not one cyan)', () => {
    const buckets = new Set(
      looks
        .filter((l) => hue(l.line).s > 0.25)
        .map((l) => Math.round(hue(l.line).h / 40)),
    );
    expect(buckets.size).toBeGreaterThanOrEqual(4);
  });

  it('keeps every colour off the zone hues and the World accent (road edge carries the zone colour)', () => {
    for (const l of looks) {
      for (const c of [l.line, l.lineB, l.horizonGlow, l.skyHorizon, l.extraB]) {
        const { h, s, v } = hue(c);
        if (s < 0.3 || v < 0.3) continue;
        // 0-75 degrees: red / orange / yellow zones; 300-360: pink World accent
        expect(h > 75 && h < 300, `${c} hue ${Math.round(h)}`).toBe(true);
      }
    }
  });

  it('stays calm: no flashing, a clear road side, bounded speed', () => {
    for (const l of looks) {
      expect(l.pulseHz).toBeLessThanOrEqual(1.5);
      expect(l.pulse).toBeLessThanOrEqual(0.7);
      expect(l.flat).toBeGreaterThanOrEqual(14);
      expect(l.speedMul).toBeGreaterThanOrEqual(0.6);
      expect(l.speedMul).toBeLessThanOrEqual(1.5);
      expect(l.objHeight).toBeLessThanOrEqual(1.5);
      expect(l.vignette).toBeLessThanOrEqual(0.5);
    }
  });

  it('builds to a climax in the overdrive and calms down in the afterglow', () => {
    const wake = looks[0]!;
    const surge = looks[3]!;
    const overdrive = looks[5]!;
    const after = looks[6]!;
    expect(overdrive.speedMul).toBeGreaterThan(surge.speedMul);
    expect(overdrive.pulse).toBeGreaterThanOrEqual(surge.pulse);
    expect(overdrive.warp).toBe(1);
    expect(after.speedMul).toBeLessThan(wake.speedMul);
    expect(after.pulse).toBe(0);
    expect(after.streak).toBe(0);
    expect(after.objDensity).toBe(0);
    expect(after.vignette).toBe(0);
  });
});
