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

export function buildConstruct(id: number, high: boolean, f: ConstructFrame, put: Placer): void {
  const k = f.scale;
  switch (Math.round(id)) {
    case CONSTRUCT.gate: {
      // an empty plain with one huge gate now and then: slow, open, quiet
      slots(f, 40, (depth, slot) => {
        if (slot % 8 !== 0) return;
        const a = fade(depth);
        const x = f.roadX(depth);
        const y = f.roadY(depth) - 0.3;
        const h = 52 * k * a;
        put(x - 30, y, -depth, 3, h, 3, 0, 0);
        put(x + 30, y, -depth, 3, h, 3, 0, 0);
        put(x, y + h - 3, -depth, 63, 3, 3, 0, 0);
      });
      break;
    }
    case CONSTRUCT.corridor: {
      // a data corridor: square rings close together over the road, a rhythm you ride through
      slots(f, high ? 16 : 30, (depth, slot) => {
        const a = fade(depth);
        const x = f.roadX(depth);
        const y = f.roadY(depth) - 0.3;
        const h = (11 + (slot % 4 === 0 ? 2 : 0)) * k * a;
        put(x - 10, y, -depth, 0.7, h, 0.7, 0, 0);
        put(x + 10, y, -depth, 0.7, h, 0.7, 0, 0);
        put(x, y + h - 0.7, -depth, 20.7, 0.7, 0.7, 0, 0);
      });
      break;
    }
    case CONSTRUCT.terraces: {
      // stepped terraces at the sides (terrain) and a bridge deck over the road every few slots
      slots(f, high ? 34 : 60, (depth, slot) => {
        if (slot % 3 !== 0) return;
        const a = fade(depth);
        const x = f.roadX(depth);
        const y = f.roadY(depth) - 0.3;
        const h = 10 * a;
        put(x - 17, y, -depth, 2, h, 3, 0, 0);
        put(x + 17, y, -depth, 2, h, 3, 0, 0);
        put(x, y + h, -depth, 38, 1.2, 8, 0, 0);
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
        if (high && slot % 5 === 0) {
          put(x - 16, y, -depth, 2, 13 * a, 4, 0, 0);
          put(x + 16, y, -depth, 2, 13 * a, 4, 0, 0);
          put(x, y + 13 * a, -depth, 34, 1.4, 6, 0, 0);
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
}
