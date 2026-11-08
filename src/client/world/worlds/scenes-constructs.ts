import { dashOffset, hash01 } from './road-model';

/**
 * World constructions of the Neon Grid chapters: what stands along the road, as instanced boxes
 * (one InstancedMesh, one shader, one draw call; at most MAX_CONSTRUCT_INSTANCES). Each chapter
 * has a different architecture, not just a different palette. Pure: positions only, no three.js,
 * no allocation per frame (the placer is a reused closure). Abstract forms only: gates, rings,
 * terraces, towers, helices, drifting tiles and dust.
 */

export const CONSTRUCT = {
  gate: 0,
  corridor: 1,
  terraces: 2,
  city: 3,
  spiral: 4,
  storm: 5,
  dust: 6,
} as const;

/** Hard cap of instances for any construction (design budget: at most 300 per theme). */
export const MAX_CONSTRUCT_INSTANCES = 220;

/** Places one box: base centre (x, y, z), size (sx, sy, sz), yaw and roll in radians. */
export type Placer = (
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  yaw: number,
  roll: number,
) => void;

export interface ConstructFrame {
  dist: number;
  time: number;
  roadX(depth: number): number;
  roadY(depth: number): number;
  /** Height factor of the look (0.6..1.5). */
  scale: number;
}

const VIEW = 600;
const smooth = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
/** Fades an object in over the far end of the view and out right in front of the camera. */
const fade = (depth: number): number => smooth((VIEW - depth) / 120) * smooth((depth - 4) / 10);

/** Slot loop helper: calls `each(depth, slot)` for every slot of the given period. */
function slots(
  f: ConstructFrame,
  period: number,
  each: (depth: number, slot: number) => void,
): void {
  const phase = dashOffset(f.dist, period);
  const base = Math.floor(f.dist / period);
  const count = Math.ceil(VIEW / period) + 1;
  for (let i = 0; i < count; i++) {
    const depth = i * period - phase;
    if (depth < 4) continue;
    each(depth, i + base);
  }
}

/** Like slots(), but each slot sits at a stable random offset (uneven spacing, no metronome). */
function jittered(
  f: ConstructFrame,
  period: number,
  each: (depth: number, slot: number) => void,
): void {
  slots(f, period, (depth, slot) => {
    const d = depth + (hash01(slot * 3 + 7) - 0.5) * period * 0.75;
    if (d >= 4) each(d, slot);
  });
}

/** Two columns at ±halfSpan of the road centre. */
function columnPair(
  put: Placer,
  x: number,
  y: number,
  depth: number,
  halfSpan: number,
  h: number,
  w: number,
): void {
  put(x - halfSpan, y, -depth, w, h, w, 0, 0);
  put(x + halfSpan, y, -depth, w, h, w, 0, 0);
}

/** Columns plus a beam over the road (a gate / arch). */
function archOver(
  put: Placer,
  x: number,
  y: number,
  depth: number,
  span: number,
  h: number,
  w: number,
): void {
  columnPair(put, x, y, depth, span / 2, h, w);
  put(x, y + h - w, -depth, span + w, w, w, 0, 0);
}

/** A big far-off formation once in a long while (a landmark you ride towards for minutes). */
const LANDMARK_PERIOD = 4200;
function landmark(f: ConstructFrame, high: boolean, put: Placer): void {
  const n = Math.floor((f.dist + 300) / LANDMARK_PERIOD) + 1;
  for (let i = n - 1; i <= n; i++) {
    const depth = i * LANDMARK_PERIOD - f.dist;
    if (depth < 30 || depth > 560) continue;
    const a = fade(depth);
    const kind = Math.floor(hash01(i * 17 + 3) * 3);
    const side = hash01(i * 17 + 4) < 0.5 ? -1 : 1;
    const x = f.roadX(depth) + side * (85 + hash01(i * 17 + 5) * 40);
    const y = f.roadY(depth) - 1;
    if (kind === 0) {
      // a stepped pyramid
      for (let t = 0; t < 5; t++) {
        const w = (70 - t * 13) * 1.0;
        put(x, y + t * 10 * a, -depth, w, 10 * a, w, 0, 0);
      }
    } else if (kind === 1) {
      // a giant ring standing on its edge, built of boxes
      const seg = high ? 16 : 10;
      for (let j = 0; j < seg; j++) {
        const th = (j / seg) * Math.PI * 2;
        put(x + Math.cos(th) * 48, y + (60 + Math.sin(th) * 48) * a, -depth, 9, 9, 9, 0, th);
      }
    } else {
      // three leaning monoliths
      for (let j = 0; j < 3; j++) {
        put(x + (j - 1) * 34, y, -depth - j * 14, 12, (120 + j * 45) * a, 12, 0, (j - 1) * 0.05);
      }
    }
  }
}

export function buildConstruct(id: number, high: boolean, f: ConstructFrame, put: Placer): void {
  const k = f.scale;
  switch (Math.round(id)) {
    case CONSTRUCT.gate: {
      // an open plain: lone columns, far monoliths, a floating panel now and then and, very
      // rarely, one huge arch; spacing and size vary slot by slot
      jittered(f, high ? 34 : 60, (depth, slot) => {
        const r = hash01(slot * 5 + 1);
        const a = fade(depth);
        const x = f.roadX(depth);
        const y = f.roadY(depth) - 0.3;
        const side = hash01(slot * 5 + 2) < 0.5 ? -1 : 1;
        if (r < 0.2) {
          columnPair(put, x, y, depth, 15 + hash01(slot + 70) * 26, (16 + r * 80) * k * a, 2.4);
        } else if (r < 0.24) {
          archOver(put, x, y, depth, 56, (34 + hash01(slot + 71) * 18) * k * a, 3);
        } else if (r < 0.42) {
          const w = 10 + hash01(slot + 72) * 14;
          put(
            x + side * (20 + hash01(slot + 73) * 24),
            y + (10 + r * 40) * k,
            -depth,
            w,
            6,
            0.5,
            0.2 * side,
            0,
          );
        } else if (r < 0.52) {
          const h = (40 + hash01(slot + 74) * 80) * k * a;
          put(x + side * (70 + hash01(slot + 75) * 50), y, -depth, 7, h, 7, 0, 0);
        }
      });
      break;
    }
    case CONSTRUCT.corridor: {
      // lanes of light: beams of light running along the road overhead, with a pair of columns or
      // a low arch only now and then (not a rhythm of identical rings)
      jittered(f, high ? 18 : 34, (depth, slot) => {
        const r = hash01(slot * 5 + 11);
        const a = fade(depth);
        const x = f.roadX(depth);
        const y = f.roadY(depth) - 0.3;
        if (r < 0.34) {
          const len = (30 + hash01(slot + 80) * 70) * a;
          const off = (r < 0.17 ? -1 : 1) * (4 + hash01(slot + 81) * 14);
          put(
            x + off,
            y + (7 + hash01(slot + 82) * 8) * k,
            -depth - len / 2,
            0.45,
            0.45,
            len,
            0,
            0,
          );
        } else if (r < 0.48) {
          columnPair(
            put,
            x,
            y,
            depth,
            9 + hash01(slot + 83) * 6,
            (8 + hash01(slot + 84) * 8) * k * a,
            0.7,
          );
        } else if (r < 0.54) {
          archOver(put, x, y, depth, 20, (10 + hash01(slot + 85) * 4) * k * a, 0.7);
        }
      });
      break;
    }
    case CONSTRUCT.terraces: {
      // stepped terraces at the sides, bridge decks over the road at uneven intervals and
      // floating panels between them
      jittered(f, high ? 30 : 56, (depth, slot) => {
        const r = hash01(slot * 5 + 21);
        const a = fade(depth);
        const x = f.roadX(depth);
        const y = f.roadY(depth) - 0.3;
        const side = hash01(slot * 5 + 22) < 0.5 ? -1 : 1;
        if (r < 0.34) {
          const h = (6 + hash01(slot + 90) * 10) * a;
          put(x + side * (15 + hash01(slot + 91) * 14), y, -depth, 2, h, 3 + r * 6, 0, 0);
        } else if (r < 0.46) {
          const w = 30 + hash01(slot + 92) * 20;
          const h = 8 + hash01(slot + 93) * 6;
          columnPair(put, x, y, depth, w / 2 - 2, h * a, 2);
          put(x, y + h * a, -depth, w, 1.2, 6 + hash01(slot + 94) * 5, 0, 0);
        } else if (r < 0.62) {
          put(
            x + side * (14 + hash01(slot + 95) * 20),
            y + 9 + hash01(slot + 96) * 14,
            -depth,
            12,
            0.8,
            5,
            0,
            0.12 * side,
          );
        }
      });
      break;
    }
    case CONSTRUCT.city: {
      // a circuit city: towers of every height at both sides, a viaduct over the road now and then
      slots(f, high ? 30 : 56, (depth, slot) => {
        const a = fade(depth);
        const x = f.roadX(depth);
        const y = f.roadY(depth) - 0.3;
        for (let side = 0; side < 2; side++) {
          const key = slot * 2 + side;
          const r = hash01(key + 13);
          const w = 7 + hash01(key + 29) * 9;
          const h = (18 + r * r * 92) * k * a;
          const off = 22 + w / 2 + hash01(key + 41) * 34;
          put(x + (side === 0 ? -off : off), y, -depth, w, h, w, 0, 0);
        }
        if (high && hash01(slot + 120) < 0.12) {
          const vh = 10 + hash01(slot + 121) * 8;
          columnPair(put, x, y, depth, 15 + hash01(slot + 122) * 5, vh * a, 2);
          put(x, y + vh * a, -depth, 34 + hash01(slot + 123) * 12, 1.4, 6, 0, 0);
        }
      });
      break;
    }
    case CONSTRUCT.spiral: {
      // two helical strands wind around the road (a climb around a megastructure), and one huge
      // monolith stands at the far end of the view
      const period = high ? 12 : 22;
      slots(f, period, (depth, slot) => {
        const x = f.roadX(depth);
        const y = f.roadY(depth);
        for (let s = 0; s < 2; s++) {
          const th = slot * 0.5 + s * Math.PI;
          const cx = x + Math.cos(th) * 15;
          const cy = y + 9 + Math.sin(th) * 7 - 0.5;
          put(cx, cy, -depth, 0.9, 1, period * 1.2, 0, 0);
        }
      });
      const far = 430;
      put(f.roadX(far) + 60, f.roadY(far) - 2, -far, 46, 260 * k, 46, 0, 0);
      break;
    }
    case CONSTRUCT.storm: {
      // the world breaks up: tiles of the grid tumble and drift, thick near the road
      slots(f, high ? 7 : 14, (depth, slot) => {
        const a = fade(depth);
        const x = f.roadX(depth);
        const y = f.roadY(depth);
        for (let s = 0; s < 2; s++) {
          const key = slot * 2 + s;
          const side = hash01(key + 3) < 0.5 ? -1 : 1;
          const off = 7 + hash01(key + 5) * 52;
          const size = (0.9 + hash01(key + 7) * 2.6) * a;
          const lift = 1.2 + hash01(key + 9) * 30 + Math.sin(f.time * 0.9 + key) * 1.6;
          put(
            x + side * off,
            y + lift,
            -depth,
            size * 1.6,
            size * 0.35,
            size * 1.6,
            f.time * (0.4 + hash01(key + 11)) + key,
            f.time * 0.5 + key * 1.3,
          );
        }
      });
      break;
    }
    default: {
      // stillness: slow motes of dust drifting in the dark
      slots(f, high ? 6 : 12, (depth, slot) => {
        const a = fade(depth);
        const x = f.roadX(depth);
        const y = f.roadY(depth);
        const side = hash01(slot + 3) < 0.5 ? -1 : 1;
        const sway = Math.sin(f.time * 0.25 + slot * 1.7);
        put(
          x + side * (3 + hash01(slot + 5) * 30) + sway * 2,
          y + 0.6 + hash01(slot + 9) * 12 + Math.sin(f.time * 0.18 + slot) * 0.8,
          -depth,
          0.32 * a,
          0.32 * a,
          0.32 * a,
          0,
          0,
        );
      });
    }
  }
  landmark(f, high, put);
}
