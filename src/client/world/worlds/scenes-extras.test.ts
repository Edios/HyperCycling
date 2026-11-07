import { describe, expect, it } from 'vitest';
import { buildExtra, pylonDensity, type Disposable, type ExtraFrame } from './scenes-extras';
import { THEMES } from './scenes-themes';

const looks = THEMES['neon-grid']!.scene.variants;
const dense = looks[4]!;
const sparse = looks[0]!;

const frame = (look: ExtraFrame['look'], dist: number): ExtraFrame => ({
  dist,
  time: dist / 10,
  intensity: 0.6,
  look,
  roadX: () => 0,
  roadY: () => 0,
  fogNear: 40,
});

interface InstancedLike {
  count: number;
  instanceMatrix: { array: Float32Array };
}

/** Instances drawn for one frame of a look. */
function drawn(high: boolean, look: ExtraFrame['look']): number {
  const created: Disposable[] = [];
  const extra = buildExtra('pylons', high, created);
  extra.update(frame(look, 1000));
  const n = (extra.object as unknown as InstancedLike).count;
  for (const c of created) c.dispose();
  return n;
}

describe('pylonDensity', () => {
  it('is 0 for the sparse grid and 1 for the dense one, and clamped', () => {
    expect(pylonDensity(18)).toBe(0);
    expect(pylonDensity(30)).toBe(0);
    expect(pylonDensity(8)).toBe(1);
    expect(pylonDensity(2)).toBe(1);
    expect(pylonDensity(13)).toBeCloseTo(0.5, 5);
  });

  it('grows through the Neon Grid looks up to the summit and dies down in the afterglow', () => {
    const d = looks.map((l) => pylonDensity(l.patternScale));
    for (let i = 1; i <= 4; i++) expect(d[i]!).toBeGreaterThanOrEqual(d[i - 1]!);
    expect(d[6]!).toBeLessThan(d[4]!);
  });
});

describe('Neon Grid pylons', () => {
  it('is the extra of the theme scene', () => {
    expect(THEMES['neon-grid']!.scene.extra).toBe('pylons');
  });

  it('stays inside its instance budget and reuses its buffer while updating', () => {
    for (const high of [true, false]) {
      const created: Disposable[] = [];
      const extra = buildExtra('pylons', high, created);
      const mesh = extra.object as unknown as InstancedLike;
      const buffer = mesh.instanceMatrix.array;
      let max = 0;
      for (let i = 0; i < 400; i++) {
        extra.update(frame(i % 2 === 0 ? dense : sparse, i * 7.3));
        max = Math.max(max, mesh.count);
        expect(mesh.instanceMatrix.array).toBe(buffer);
      }
      // design budget: at most 300 instances per theme
      expect(max).toBeLessThanOrEqual(300);
      expect(max).toBeLessThanOrEqual(buffer.length / 16);
      for (const c of created) c.dispose();
    }
  });

  it('draws arches only on the high setting and more scenery in dense looks', () => {
    expect(drawn(true, dense)).toBeGreaterThan(drawn(false, dense));
    expect(drawn(true, sparse)).toBeLessThan(drawn(true, dense));
  });
});
