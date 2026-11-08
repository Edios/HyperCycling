import { describe, expect, it } from 'vitest';
import source from './scenes-constructs.ts?raw';
import {
  CONSTRUCT,
  MAX_CONSTRUCT_INSTANCES,
  buildConstruct,
  type ConstructFrame,
} from './scenes-constructs';

const IDS = Object.values(CONSTRUCT);

function frame(n: number): ConstructFrame {
  return {
    dist: n * 37.7,
    time: n * 0.3,
    roadX: (d) => Math.sin(d / 50) * 3,
    roadY: (d) => d * 0.01,
    scale: 0.6 + (n % 10) * 0.1,
  };
}

describe('world constructions', () => {
  it('builds every construction within the budget, deterministically, on both qualities', () => {
    for (const high of [true, false]) {
      for (const id of IDS) {
        for (let n = 0; n < 200; n++) {
          let count = 0;
          let sum = 0;
          const put = (...v: number[]): void => {
            count++;
            for (const x of v) sum += x;
          };
          buildConstruct(id, high, frame(n), put);
          const first = [count, sum];
          count = 0;
          sum = 0;
          buildConstruct(id, high, frame(n), put);
          expect([count, sum]).toEqual(first);
          expect(count).toBeGreaterThan(0);
          expect(count).toBeLessThanOrEqual(MAX_CONSTRUCT_INSTANCES * 2);
        }
      }
    }
  });

  // buildConstruct runs every frame: a callback passed to a helper is a closure allocated per
  // frame (zero-allocation rule of the render loop), so the slot loops must stay plain `for` loops
  it('has no per-frame closures: no callback helpers and no function literals in the builders', () => {
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
      .split('\n');
    const from = code.findIndex((l) => l.includes('export function buildConstruct'));
    expect(from).toBeGreaterThan(0);
    const body = code.slice(from).join('\n');
    expect(body).not.toMatch(/=>/);
    expect(body).not.toMatch(/\bfunction\b(?!\s+\w)/);
    expect(source).not.toMatch(/\b(slots|jittered)\s*\(/);
    // above it only the Placer type and four top-level pure consts use arrows
    const head = code.slice(0, from).join('\n');
    expect(head.match(/=>/g)?.length ?? 0).toBeLessThanOrEqual(5);
  });
});
