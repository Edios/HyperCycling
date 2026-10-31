import { intensityAt, type Segment } from './segments';

export type HrZone = 1 | 2 | 3 | 4 | 5;

export interface HrZoneDef {
  zone: HrZone;
  minPct: number;
  maxPct: number;
  /** Inclusive effort levels mapped to this zone. */
  efforts: readonly [number, number];
}

export const HR_ZONES: readonly HrZoneDef[] = [
  { zone: 1, minPct: 50, maxPct: 60, efforts: [1, 2] },
  { zone: 2, minPct: 60, maxPct: 70, efforts: [3, 4] },
  { zone: 3, minPct: 70, maxPct: 80, efforts: [5, 6] },
  { zone: 4, minPct: 80, maxPct: 90, efforts: [7, 8] },
  { zone: 5, minPct: 90, maxPct: 100, efforts: [9, 10] },
];

/** Blocks shorter than this show no HR target (heart rate lags behind effort). */
export const MIN_HR_SEGMENT_SEC = 60;

/** Effort 1-10 (fractions allowed): round half up, clamp to 1..10, then map to a zone. */
export function zoneForEffort(effort: number): HrZone {
  const level = Math.min(10, Math.max(1, Math.floor(effort + 0.5)));
  return Math.ceil(level / 2) as HrZone;
}

function def(zone: HrZone): HrZoneDef {
  // HR_ZONES has exactly five entries indexed by zone - 1.
  return HR_ZONES[zone - 1] as HrZoneDef;
}

export function bpmRange(zone: HrZone, hrMax: number): { min: number; max: number } {
  const z = def(zone);
  return { min: Math.round((hrMax * z.minPct) / 100), max: Math.round((hrMax * z.maxPct) / 100) };
}

/** Tanaka formula; age is an input only and never stored. */
export function estimateHrMax(age: number): number {
  return Math.round(208 - 0.7 * age);
}

export function hrTargetFor(
  segment: Segment,
  elapsedInSegSec: number,
  hrMax: number | undefined,
): { zone: HrZone; bpm?: { min: number; max: number } } | null {
  if (segment.durationSec < MIN_HR_SEGMENT_SEC) return null;
  const zone = zoneForEffort(intensityAt(segment, elapsedInSegSec).effort);
  return hrMax === undefined ? { zone } : { zone, bpm: bpmRange(zone, hrMax) };
}
