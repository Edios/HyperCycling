import { describe, expect, it } from 'vitest';
import { buildExtra, type Disposable, type ExtraFrame } from './scenes-extras';
import { THEMES } from './scenes-themes';

const looks = THEMES['neon-grid']!.scene.variants;
const dense = looks[3]!;
const sparse = looks[0]!;

const frame = (look: ExtraFrame['look'], dist: number): ExtraFrame => ({
  dist,
  time: dist / 10,
  intensity: 0.6,
  beat: 0,
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

  it('draws something in every chapter, never over the budget, and less on Lite', () => {
    for (const look of looks) {
      const hi = drawn(true, look);
      const lo = drawn(false, look);
      expect(hi, String(look.construct)).toBeGreaterThan(0);
      expect(hi).toBeLessThanOrEqual(220);
      expect(lo).toBeLessThanOrEqual(110);
      expect(lo).toBeLessThanOrEqual(hi);
    }
  });

  it('builds a different scene for every chapter', () => {
    const counts = new Set(looks.map((l) => drawn(true, l)));
    expect(counts.size).toBeGreaterThanOrEqual(4);
  });
});
