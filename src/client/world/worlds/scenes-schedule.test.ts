import { describe, expect, it } from 'vitest';
import { builtinWorkouts } from '../../data/builtin';
import { songStartsSec } from '../../../domain/experience';
import { flattenWorkout, type Segment } from '../../../domain/segments';
import {
  MAX_SCENE_SEC,
  SCENE_FADE_SEC,
  MIN_SCENE_SEC,
  VARIANT_FADE_SEC,
  VARIANT_SEC,
  buildSceneSchedule,
  buildThemedSchedule,
  sceneChangeAllowed,
  lerpHex,
  lerpLook,
  lerpLookInto,
  sceneStateAt,
  workoutSeed,
} from './scenes-schedule';

function blocks(durations: number[], effort: Segment['effortStart'] = 5): Segment[] {
  let start = 0;
  return durations.map((durationSec, index) => {
    const s: Segment = {
      index,
      startSec: start,
      durationSec,
      kind: 'steady',
      ftpPctStart: 78,
      ftpPctEnd: 78,
      effortStart: effort,
      effortEnd: effort,
      blockId: `b${index}`,
      rep: 1,
      reps: 1,
    };
    start += durationSec;
    return s;
  });
}

const opts = { variantCounts: [3, 3, 3, 3] };
const scenesOnly = (segs: Segment[]) =>
  buildSceneSchedule(segs, opts).filter((e) => e.kind !== 'variant');

describe('buildSceneSchedule', () => {
  it('is deterministic for a given workout', () => {
    const w = blocks([50, 120, 300, 45, 600, 90]);
    expect(buildSceneSchedule(w, opts)).toEqual(
      buildSceneSchedule(blocks([50, 120, 300, 45, 600, 90]), opts),
    );
  });

  it('starts at 0 with a scene picked from the workout', () => {
    const w = blocks([60, 60]);
    const first = buildSceneSchedule(w, opts)[0];
    expect(first).toEqual({ startSec: 0, scene: workoutSeed(w) % 4, variant: 0, kind: 'start' });
  });

  it('changes scene only at block boundaries, at least MIN_SCENE_SEC apart, rotating', () => {
    const w = blocks(Array.from({ length: 40 }, () => 50));
    const boundaries = new Set(w.slice(1).map((s) => s.startSec));
    const sc = scenesOnly(w);
    expect(sc.length).toBeGreaterThan(4);
    for (let i = 1; i < sc.length; i++) {
      const cur = sc[i]!;
      const prev = sc[i - 1]!;
      expect(boundaries.has(cur.startSec)).toBe(true);
      expect(cur.startSec - prev.startSec).toBeGreaterThanOrEqual(MIN_SCENE_SEC);
      expect(cur.startSec - prev.startSec).toBeLessThan(MIN_SCENE_SEC + 50);
      expect(cur.scene).toBe((prev.scene + 1) % 4);
    }
  });

  it('changes scene mid-block after MAX_SCENE_SEC when one block is very long', () => {
    const sc = scenesOnly(blocks([1800]));
    expect(sc.map((e) => e.startSec)).toEqual([0, 420, 840, 1260, 1680]);
    expect(MAX_SCENE_SEC).toBe(420);
  });

  it('switches variants every VARIANT_SEC inside a scene, even inside one long block', () => {
    const all = buildSceneSchedule(blocks([1800]), opts);
    const firstScene = all.filter((e) => e.startSec < 420);
    expect(firstScene.map((e) => e.startSec)).toEqual([0, 75, 150, 225, 300, 375]);
    expect(firstScene.map((e) => e.variant)).toEqual([0, 1, 2, 0, 1, 2]);
    expect(VARIANT_SEC).toBe(75);
  });

  it('skips a variant change that would come less than 30 s before a scene change', () => {
    // boundary at 250: the 225 s variant change is 25 s before it
    const all = buildSceneSchedule(blocks([250, 400]), opts);
    expect(all.filter((e) => e.startSec < 250).map((e) => e.startSec)).toEqual([0, 75, 150]);
    expect(all.find((e) => e.startSec === 250)?.kind).toBe('scene');
  });

  it('without a workout uses scene 0 and still rotates variants', () => {
    const all = buildSceneSchedule([], opts);
    expect(all[0]).toEqual({ startSec: 0, scene: 0, variant: 0, kind: 'start' });
    expect(all[1]).toMatchObject({ startSec: 75, scene: 0, variant: 1, kind: 'variant' });
  });

  it('respects a scene with a single variant', () => {
    const all = buildSceneSchedule(blocks([400]), { variantCounts: [1] });
    expect(all.every((e) => e.variant === 0 && e.scene === 0)).toBe(true);
  });
});

describe('workoutSeed', () => {
  it('differs between different workouts and is a non-negative integer', () => {
    const a = workoutSeed(blocks([60, 60, 60]));
    const b = workoutSeed(blocks([60, 90, 60]));
    expect(a).not.toBe(b);
    expect(Number.isInteger(a) && a >= 0).toBe(true);
  });
});

describe('sceneStateAt', () => {
  const sched = buildSceneSchedule(blocks([250, 400]), opts);
  const s0 = sched[0]!.scene;
  const s1 = (s0 + 1) % 4;

  it('shows the scene with no wash away from changes', () => {
    expect(sceneStateAt(sched, 30)).toEqual({
      scene: s0,
      fromVariant: 0,
      toVariant: 0,
      variantMix: 1,
      wash: 0,
    });
  });

  it('washes in before a scene change, peaks at the change and washes out after', () => {
    const before = sceneStateAt(sched, 248.75);
    expect(before.scene).toBe(s0);
    expect(before.wash).toBeGreaterThan(0.3);
    expect(before.wash).toBeLessThan(0.7);
    const at = sceneStateAt(sched, 250);
    expect(at.scene).toBe(s1);
    expect(at.wash).toBe(1);
    expect(sceneStateAt(sched, 247.4).wash).toBe(0);
    expect(sceneStateAt(sched, 251.25).wash).toBeGreaterThan(0.3);
    expect(sceneStateAt(sched, 252.6).wash).toBe(0);
  });

  it('lerps the palette over VARIANT_FADE_SEC after a variant change', () => {
    const start = sceneStateAt(sched, 75);
    expect(start).toMatchObject({ scene: s0, fromVariant: 0, toVariant: 1, wash: 0 });
    expect(start.variantMix).toBe(0);
    const mid = sceneStateAt(sched, 75 + VARIANT_FADE_SEC / 2);
    expect(mid.variantMix).toBeCloseTo(0.5, 5);
    const done = sceneStateAt(sched, 75 + VARIANT_FADE_SEC + 1);
    expect(done).toMatchObject({ fromVariant: 1, toVariant: 1, variantMix: 1 });
  });

  it('clamps before the start and after the end', () => {
    expect(sceneStateAt(sched, -5).scene).toBe(s0);
    expect(sceneStateAt(sched, 99999).wash).toBe(0);
    expect(sceneStateAt([], 10)).toEqual({
      scene: 0,
      fromVariant: 0,
      toVariant: 0,
      variantMix: 1,
      wash: 0,
    });
  });
});

describe('lerpHex', () => {
  it('mixes two #rrggbb colours', () => {
    expect(lerpHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(lerpHex('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(lerpHex('#000000', '#ff0080', 0.5)).toBe('#800040');
  });
});

describe('lerpLook', () => {
  it('mixes colours as colours and numbers as numbers, field by field', () => {
    const a = { sky: '#000000', size: 0, pattern: 1 };
    const b = { sky: '#ffffff', size: 10, pattern: 3 };
    expect(lerpLook(a, b, 0)).toEqual(a);
    expect(lerpLook(a, b, 1)).toEqual(b);
    expect(lerpLook(a, b, 0.5)).toEqual({ sky: '#808080', size: 5, pattern: 2 });
  });
});

describe('lerpLookInto', () => {
  it('equals lerpLook and reuses the buffer', () => {
    const a = { sky: '#000000', size: 0, pattern: 1 };
    const b = { sky: '#ffffff', size: 10, pattern: 3 };
    const buf = { sky: '', size: 0, pattern: 0 };
    const r = lerpLookInto(buf, a, b, 0.5);
    expect(r).toBe(buf);
    expect(r).toEqual(lerpLook(a, b, 0.5));
  });
});

describe('sceneChangeAllowed', () => {
  it('refuses effort 9+ and sprint cadence, allows the rest', () => {
    const hard = { ...blocks([60], 9)[0]!, startSec: 300 };
    const sprint = { ...blocks([30], 6)[0]!, startSec: 360, rpm: 106 };
    const all = [...blocks([300], 5), hard, sprint];
    expect(sceneChangeAllowed(all, 100)).toBe(true);
    expect(sceneChangeAllowed(all, 310)).toBe(false);
    expect(sceneChangeAllowed(all, 370)).toBe(false);
    expect(sceneChangeAllowed(all, 10_000)).toBe(true);
  });
  it('allows a change at a boundary out of rest or moderate work, also into effort 9+ or a sprint', () => {
    const hard = { ...blocks([60], 9)[0]!, startSec: 300 };
    const rest = { ...blocks([30], 3)[0]!, startSec: 360 };
    const sprint = { ...blocks([30], 6)[0]!, startSec: 390, rpm: 106 };
    const all = [...blocks([300], 5), hard, rest, sprint];
    expect(sceneChangeAllowed(all, 300)).toBe(true); // moderate -> effort 9
    expect(sceneChangeAllowed(all, 390)).toBe(true); // rest -> sprint
    expect(sceneChangeAllowed(all, 360)).toBe(false); // effort 9 -> rest: inside the wash of a hard block
    expect(sceneChangeAllowed(all, 301.5)).toBe(false);
  });
  it('refuses hard -> hard and sprint -> sprint boundaries (the wash would start mid-effort)', () => {
    const h1 = { ...blocks([60], 9)[0]!, startSec: 300 };
    const h2 = { ...blocks([60], 9)[0]!, startSec: 360 };
    const s1 = { ...blocks([15], 6)[0]!, startSec: 420, rpm: 108 };
    const s2 = { ...blocks([30], 6)[0]!, startSec: 435, rpm: 108 };
    const all = [...blocks([300], 5), h1, h2, s1, s2];
    expect(sceneChangeAllowed(all, 360)).toBe(false);
    expect(sceneChangeAllowed(all, 420)).toBe(false); // effort 9 -> sprint
    expect(sceneChangeAllowed(all, 435)).toBe(false);
    const out = buildThemedSchedule(all, [
      { startSec: 0, variant: 0 },
      { startSec: 360, variant: 3 },
    ]);
    expect(out).toHaveLength(1);
  });
  it('never puts a scene-change wash over the middle of a hard block, in any built-in workout', () => {
    for (const w of builtinWorkouts) {
      const segs = flattenWorkout(w);
      const changes = buildSceneSchedule(segs, { ...opts, boundaries: songStartsSec(w) })
        .filter((e) => e.kind === 'scene')
        .map((e) => e.startSec);
      const half = SCENE_FADE_SEC / 2;
      for (const t of changes) {
        for (const s of segs) {
          if (!(s.effortStart >= 9 || s.effortEnd >= 9 || (s.rpm ?? 0) >= 105)) continue;
          // the wash [t - half, t + half] must not reach into the part of a hard block after its start
          const overlaps = t - half < s.startSec + s.durationSec && t + half > s.startSec;
          if (overlaps) expect(t, `${w.id} change at ${t}s`).toBe(s.startSec);
        }
      }
    }
  });
});

describe('buildSceneSchedule with boundaries', () => {
  it('changes scenes only at the given boundaries', () => {
    const segs = blocks([100, 100, 100, 100, 100, 100, 100, 100], 5);
    const out = buildSceneSchedule(segs, { ...opts, boundaries: [300, 600] }).filter(
      (e) => e.kind === 'scene',
    );
    expect(out.map((e) => e.startSec)).toEqual([300, 600]);
  });
  it('skips boundaries inside a hard block', () => {
    const segs = [...blocks([300], 5), { ...blocks([300], 9)[0]!, startSec: 300 }];
    const out = buildSceneSchedule(segs, { ...opts, boundaries: [330] }).filter(
      (e) => e.kind === 'scene',
    );
    expect(out.every((e) => e.startSec !== 300)).toBe(true);
  });
  it('without boundaries behaves as before', () => {
    const segs = blocks([240, 240, 240], 5);
    expect(scenesOnly(segs).map((e) => e.startSec)).toEqual([0, 240, 480]);
  });
});

describe('buildThemedSchedule', () => {
  const segs = [...blocks([300, 300], 4), { ...blocks([60], 9)[0]!, startSec: 600 }];
  it('starts at chapter one and switches variant at the chapter starts', () => {
    const out = buildThemedSchedule(segs, [
      { startSec: 0, variant: 2 },
      { startSec: 300, variant: 4 },
    ]);
    expect(out).toEqual([
      { startSec: 0, scene: 0, variant: 2, kind: 'start' },
      { startSec: 300, scene: 0, variant: 4, kind: 'scene' },
    ]);
  });
  it('drops a chapter that would start inside effort 9+ and a repeated variant', () => {
    const out = buildThemedSchedule(segs, [
      { startSec: 0, variant: 0 },
      { startSec: 100, variant: 0 },
      { startSec: 620, variant: 3 },
    ]);
    expect(out).toHaveLength(1);
  });
  it('yields a single start entry without chapters', () => {
    expect(buildThemedSchedule(segs, [])).toEqual([
      { startSec: 0, scene: 0, variant: 0, kind: 'start' },
    ]);
  });
});
