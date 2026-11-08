import type { Segment } from '../../../domain/segments';

/**
 * Pure scene scheduling of the Scenes world (no three.js), unit tested. Which scene and which variant
 * of it shows at a workout second, and how far a transition has progressed. Deterministic for a
 * given workout. Design note: .superpowers/sdd/2026-10-30-spinning-tutor-v2/road-scenes-design.md.
 */

/** A scene lasts at least this long; it then changes at the next block boundary. */
export const MIN_SCENE_SEC = 240;
/** …or at this age mid-block, when one block is very long. */
export const MAX_SCENE_SEC = 420;
/** A scene switches to its next variant this often. */
export const VARIANT_SEC = 75;
/** No variant change this close before a scene change. */
export const VARIANT_SKIP_SEC = 30;
/** Full length of the colour wash of a scene change, centred on the change. */
export const SCENE_FADE_SEC = 5;
/** Palette lerp after a variant change. */
export const VARIANT_FADE_SEC = 10;
/** Schedule length when there is no workout (variants still rotate). */
const NO_WORKOUT_SEC = 3 * 3600;

export interface SceneScheduleEntry {
  startSec: number;
  /** Index into the scene registry. */
  scene: number;
  variant: number;
  kind: 'start' | 'scene' | 'variant';
}

export interface ScheduleOptions {
  /** Variant count of every scene in registry order (its length is the scene count). */
  variantCounts: readonly number[];
  /**
   * Allowed scene-change seconds (song starts of an Experience), sorted. Changes then happen only
   * at these seconds that pass `sceneChangeAllowed`; absent = every block boundary (default).
   */
  boundaries?: readonly number[];
}

/** A scene-change wash must not start in a sprint or at effort 9+. */
export const NO_CHANGE_EFFORT = 9;
/** A cadence at or above this is a sprint (same limit as the world frame). */
const SPRINT_RPM_LIMIT = 105;

/** Step of the search for the next allowed second when a scene change is forced. */
const FORCED_STEP_SEC = 5;

/** A change this close after a block start counts as AT the block boundary. */
const BOUNDARY_TOLERANCE_SEC = 1;

/** A block that is a sprint or effort 9+: nothing may change in it, nor right out of it. */
function isHard(s: Segment): boolean {
  return (
    Math.max(s.effortStart, s.effortEnd) >= NO_CHANGE_EFFORT || (s.rpm ?? 0) >= SPRINT_RPM_LIMIT
  );
}

/**
 * Whether a scene may change at workout second `t`. The wash lasts SCENE_FADE_SEC, centred on `t`,
 * so the whole window [t - half, t + half] is checked, not just the point. At a block boundary
 * (within BOUNDARY_TOLERANCE_SEC of a block start) the block that starts there is exempt: rest or
 * moderate → anything, including hard work (the dramatic moment, the new world arrives with the
 * pre-cue). Every OTHER block touched by the window must not be hard: hard → hard (or sprint →
 * sprint) is refused, and so is a change 1–2.5 s after a hard block whose wash would reach back
 * into it. Inside a running block the block itself must not be hard either.
 */
export function sceneChangeAllowed(segments: readonly Segment[], t: number): boolean {
  const half = SCENE_FADE_SEC / 2;
  let at = -1;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i] as Segment;
    if (t >= s.startSec && t < s.startSec + s.durationSec) {
      at = i;
      break;
    }
  }
  if (at < 0) return true;
  const cur = segments[at] as Segment;
  const exempt = at > 0 && t - cur.startSec < BOUNDARY_TOLERANCE_SEC ? at : -1;
  for (let i = 0; i < segments.length; i++) {
    if (i === exempt) continue;
    const s = segments[i] as Segment;
    if (s.startSec >= t + half || s.startSec + s.durationSec <= t - half) continue;
    if (isHard(s)) return false;
  }
  return true;
}

export interface ThemedChapter {
  startSec: number;
  /** Variant of the theme's scene. */
  variant: number;
}

/**
 * Schedule of a theme: one scene, one variant per chapter, changing only at the chapter starts that
 * `sceneChangeAllowed` accepts (a refused one is merged into the previous chapter). Pure.
 */
export function buildThemedSchedule(
  segments: readonly Segment[],
  chapters: readonly ThemedChapter[],
): SceneScheduleEntry[] {
  const first = chapters[0];
  const out: SceneScheduleEntry[] = [
    { startSec: 0, scene: 0, variant: first?.variant ?? 0, kind: 'start' },
  ];
  for (const c of chapters.slice(1)) {
    const prev = out[out.length - 1];
    if (!prev || c.startSec <= prev.startSec || c.variant === prev.variant) continue;
    if (!sceneChangeAllowed(segments, c.startSec)) continue;
    out.push({ startSec: c.startSec, scene: 0, variant: c.variant, kind: 'scene' });
  }
  return out;
}

export interface SceneState {
  scene: number;
  fromVariant: number;
  toVariant: number;
  /** 0 → fromVariant, 1 → toVariant. */
  variantMix: number;
  /** Colour wash over the whole view, 0..1 (1 exactly at a scene change). */
  wash: number;
}

const smooth01 = (u: number): number => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

/** Stable non-negative integer for a workout (block count, lengths and efforts). */
export function workoutSeed(segments: readonly Segment[]): number {
  let h = 2166136261 ^ segments.length;
  for (const s of segments) {
    h = Math.imul(h ^ Math.round(s.durationSec), 16777619);
    h = Math.imul(h ^ (s.effortStart * 16 + s.effortEnd), 16777619);
  }
  return (h >>> 0) % 1_000_003;
}

export function buildSceneSchedule(
  segments: readonly Segment[],
  opts: ScheduleOptions,
): SceneScheduleEntry[] {
  const n = opts.variantCounts.length;
  if (n === 0) return [];
  const last = segments[segments.length - 1];
  const end = last ? last.startSec + last.durationSec : NO_WORKOUT_SEC;
  const boundaries = opts.boundaries
    ? opts.boundaries.filter((b) => b > 0 && sceneChangeAllowed(segments, b))
    : segments.slice(1).map((s) => s.startSec);
  const variantsOf = (scene: number): number => Math.max(1, opts.variantCounts[scene] ?? 1);
  const visits = new Array<number>(n).fill(0);

  let scene = segments.length > 0 ? workoutSeed(segments) % n : 0;
  let variant = 0;
  let sceneStart = 0;
  visits[scene] = 1;
  const out: SceneScheduleEntry[] = [{ startSec: 0, scene, variant, kind: 'start' }];

  for (;;) {
    const boundary = boundaries.find((b) => b >= sceneStart + MIN_SCENE_SEC);
    let change =
      boundary !== undefined && boundary <= sceneStart + MAX_SCENE_SEC
        ? boundary
        : sceneStart + MAX_SCENE_SEC;
    // a forced change (no boundary in time) still never lands in the middle of an effort
    if (change !== boundary) {
      while (change < end && !sceneChangeAllowed(segments, change)) change += FORCED_STEP_SEC;
    }
    const count = variantsOf(scene);
    for (let t = sceneStart + VARIANT_SEC; t < end; t += VARIANT_SEC) {
      if (change - t < VARIANT_SKIP_SEC) break;
      if (count < 2) break;
      variant = (variant + 1) % count;
      out.push({ startSec: t, scene, variant, kind: 'variant' });
    }
    if (change >= end) break;
    scene = (scene + 1) % n;
    const seen = visits[scene] ?? 0;
    variant = seen % variantsOf(scene);
    visits[scene] = seen + 1;
    sceneStart = change;
    out.push({ startSec: change, scene, variant, kind: 'scene' });
  }
  return out;
}

export function sceneStateAt(schedule: readonly SceneScheduleEntry[], t: number): SceneState {
  let i = 0;
  while (i + 1 < schedule.length && (schedule[i + 1]?.startSec ?? Infinity) <= t) i++;
  const cur = schedule[i];
  if (!cur) return { scene: 0, fromVariant: 0, toVariant: 0, variantMix: 1, wash: 0 };

  const half = SCENE_FADE_SEC / 2;
  let wash = 0;
  if (cur.kind === 'scene' && t - cur.startSec < half) {
    wash = smooth01(1 - Math.max(0, t - cur.startSec) / half);
  }
  for (let j = i + 1; j < schedule.length; j++) {
    const e = schedule[j];
    if (!e || e.startSec - t >= half) break;
    if (e.kind === 'scene') wash = Math.max(wash, smooth01(1 - (e.startSec - t) / half));
  }

  const prev = schedule[i - 1];
  const since = t - cur.startSec;
  if (cur.kind === 'variant' && prev && since < VARIANT_FADE_SEC) {
    return {
      scene: cur.scene,
      fromVariant: prev.variant,
      toVariant: cur.variant,
      variantMix: smooth01(Math.max(0, since) / VARIANT_FADE_SEC),
      wash,
    };
  }
  return {
    scene: cur.scene,
    fromVariant: cur.variant,
    toVariant: cur.variant,
    variantMix: 1,
    wash,
  };
}

const hexByte = (hex: string, at: number): number => parseInt(hex.slice(at, at + 2), 16) || 0;

/** Mixes two `#rrggbb` colours. */
export function lerpHex(a: string, b: string, t: number): string {
  const k = Math.min(1, Math.max(0, t));
  let out = '#';
  for (let at = 1; at < 7; at += 2) {
    const v = Math.round(hexByte(a, at) + (hexByte(b, at) - hexByte(a, at)) * k);
    out += v.toString(16).padStart(2, '0');
  }
  return out;
}

/** Like lerpLook but writes into a reused buffer (no object allocation per call). */
export function lerpLookInto<T extends Record<string, number | string>>(
  out: T,
  a: T,
  b: T,
  t: number,
): T {
  const o = out as Record<string, number | string>;
  for (const key in a) {
    const x = a[key];
    const y = b[key];
    if (typeof x === 'string' && typeof y === 'string') o[key] = lerpHex(x, y, t);
    else if (typeof x === 'number' && typeof y === 'number') o[key] = x + (y - x) * t;
    else o[key] = (t < 0.5 ? x : y) ?? '';
  }
  return out;
}

/** Mixes two looks field by field: `#rrggbb` strings as colours, numbers linearly. */
export function lerpLook<T extends Record<string, number | string>>(a: T, b: T, t: number): T {
  const out: Record<string, number | string> = {};
  for (const key of Object.keys(a)) {
    const x = a[key];
    const y = b[key];
    if (typeof x === 'string' && typeof y === 'string') out[key] = lerpHex(x, y, t);
    else if (typeof x === 'number' && typeof y === 'number') out[key] = x + (y - x) * t;
    else out[key] = (t < 0.5 ? x : y) ?? '';
  }
  // same keys as `a`, each mixed with a value of the same type
  return out as T;
}
