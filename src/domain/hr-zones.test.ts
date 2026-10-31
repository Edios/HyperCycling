import { describe, expect, it } from 'vitest';
import { flattenWorkout, type Segment } from './segments';
import { bpmRange, estimateHrMax, hrTargetFor, HR_ZONES, zoneForEffort } from './hr-zones';
import type { Workout } from './workout';

function segmentOf(block: Workout['blocks'][number]): Segment {
  const w = { blocks: [block] } as unknown as Workout;
  const seg = flattenWorkout(w)[0];
  if (!seg) throw new Error('no segment');
  return seg;
}

const steady = (durationSec: number, effort: number) =>
  segmentOf({
    id: 'b',
    kind: 'steady',
    durationSec,
    intensity: { effort },
  } as Workout['blocks'][number]);

describe('zoneForEffort', () => {
  it.each([
    [1, 1],
    [2, 1],
    [3, 2],
    [4, 2],
    [5, 3],
    [6, 3],
    [7, 4],
    [8, 4],
    [9, 5],
    [10, 5],
    [6.5, 4],
    [0, 1],
    [12, 5],
  ])('effort %s -> Z%s', (effort, zone) => {
    expect(zoneForEffort(effort)).toBe(zone);
  });
});

describe('zone table', () => {
  it('covers 50-100 % contiguously', () => {
    expect(HR_ZONES.map((z) => [z.minPct, z.maxPct])).toEqual([
      [50, 60],
      [60, 70],
      [70, 80],
      [80, 90],
      [90, 100],
    ]);
  });
});

describe('bpmRange / estimateHrMax', () => {
  it('computes rounded bpm bands', () => {
    expect(bpmRange(3, 183)).toEqual({ min: 128, max: 146 });
  });
  it('uses Tanaka', () => {
    expect(estimateHrMax(36)).toBe(183);
  });
});

describe('hrTargetFor', () => {
  it('returns null for segments shorter than 60 s', () => {
    expect(hrTargetFor(steady(45, 6), 0, 183)).toBeNull();
  });
  it('gives zone and bpm when hrMax is known', () => {
    expect(hrTargetFor(steady(300, 6), 10, 183)).toEqual({ zone: 3, bpm: { min: 128, max: 146 } });
  });
  it('omits bpm when hrMax is unknown', () => {
    const t = hrTargetFor(steady(300, 6), 10, undefined);
    expect(t).toEqual({ zone: 3 });
    expect(t).not.toHaveProperty('bpm');
  });
  it('follows a ramp to the zone at the current second', () => {
    const ramp = segmentOf({
      id: 'r',
      kind: 'ramp',
      durationSec: 120,
      from: { effort: 4 },
      to: { effort: 8 },
    } as Workout['blocks'][number]);
    expect(hrTargetFor(ramp, 0, undefined)?.zone).toBe(2);
    expect(hrTargetFor(ramp, 100, undefined)?.zone).toBe(4);
  });
});
