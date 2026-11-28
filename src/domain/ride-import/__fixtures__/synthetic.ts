/**
 * Test-only synthetic rides with a known answer (spec fit-import §6.2): a list of pieces
 * (steady or ramp, in %FTP) becomes a 1 Hz RideSeries with seeded noise, so every run is the same.
 */

import type { RideSeries } from '../types';

export interface Piece {
  sec: number;
  /** %FTP at the start and the end (equal for steady). */
  from: number;
  to?: number;
  cadence?: number;
  /** Grade in % while riding this piece (outdoor rides). */
  grade?: number;
}

/** A small seeded PRNG (mulberry32): the same noise on every run. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Expands pieces into %FTP per second. */
export function profile(pieces: Piece[]): number[] {
  const out: number[] = [];
  for (const p of pieces) {
    const to = p.to ?? p.from;
    for (let i = 0; i < p.sec; i += 1)
      out.push(p.from + ((to - p.from) * i) / Math.max(1, p.sec - 1));
  }
  return out;
}

export interface RideOptions {
  ftp?: number;
  /** Relative noise on power (0.08 = ±8 %). */
  noise?: number;
  seed?: number;
  /** Leave power out (heart rate or speed rides). */
  power?: boolean;
  /** Heart rate from the power with a first-order lag of `hrTauSec`, given HR max. */
  hrMax?: number;
  hrTauSec?: number;
  /** Speed and altitude from the grades (outdoor), at this speed in m/s on the flat. */
  speed?: number;
}

const empty = (n: number) => new Float32Array(n).fill(NaN);

export function ride(pieces: Piece[], opts: RideOptions = {}): RideSeries {
  const pct = profile(pieces);
  const n = pct.length;
  const ftp = opts.ftp ?? 250;
  const rnd = prng(opts.seed ?? 1);
  const noise = opts.noise ?? 0.04;
  const power = empty(n);
  const cadence = empty(n);
  const heartRate = empty(n);
  const speed = empty(n);
  const altitude = empty(n);
  const distance = empty(n);
  const cadences: (number | undefined)[] = [];
  const grades: number[] = [];
  for (const p of pieces) {
    for (let i = 0; i < p.sec; i += 1) {
      cadences.push(p.cadence);
      grades.push(p.grade ?? 0);
    }
  }
  let hr = opts.hrMax ? opts.hrMax * 0.55 : 0;
  let alt = 200;
  let dist = 0;
  for (let i = 0; i < n; i += 1) {
    const w = (ftp * (pct[i] as number)) / 100;
    if (opts.power !== false) power[i] = Math.max(0, w * (1 + (rnd() * 2 - 1) * noise));
    const cad = cadences[i];
    if (cad !== undefined) cadence[i] = cad + Math.round((rnd() * 2 - 1) * 3);
    if (opts.hrMax) {
      // Heart rate settles towards the zone of the effort: 50 % HR max at 45 % FTP, 100 % at 130 %.
      const target = opts.hrMax * Math.min(1, 0.5 + ((pct[i] as number) - 45) / 170);
      hr += (target - hr) / (opts.hrTauSec ?? 30);
      heartRate[i] = Math.round(hr);
    }
    if (opts.speed !== undefined) {
      const g = grades[i] as number;
      const v = Math.max(1, opts.speed * (1 - g / 12));
      speed[i] = v;
      dist += v;
      alt += (v * g) / 100;
      distance[i] = dist;
      altitude[i] = alt;
    }
  }
  const cover = (a: Float32Array) => a.filter((v) => !Number.isNaN(v)).length / n;
  return {
    format: 'fit',
    durationSec: n,
    power,
    cadence,
    heartRate,
    speed,
    altitude,
    distance,
    coverage: {
      power: cover(power),
      cadence: cover(cadence),
      heartRate: cover(heartRate),
      speed: cover(speed),
      altitude: cover(altitude),
      distance: cover(distance),
    },
    pauses: [],
    laps: [],
    meta: { startedAt: Date.parse('2026-11-22T08:00:00Z') },
    hints: {},
  };
}
