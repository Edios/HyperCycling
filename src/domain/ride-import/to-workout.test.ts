import { describe, expect, it } from 'vitest';
import type { Block } from '../workout';
import { ride } from './__fixtures__/synthetic';
import { rideToWorkout } from './to-workout';

const blocks: Block[] = [{ kind: 'steady', id: 'b1', durationSec: 600, intensity: { effort: 5 } }];
const now = new Date('2026-11-28T10:00:00Z');

describe('rideToWorkout', () => {
  it('makes an imported workout named after the activity, with the date and the maker', () => {
    const series = ride([{ sec: 600, from: 70 }]);
    series.meta = { ...series.meta, name: ' Morning Ride ', device: 'Garmin' };
    const w = rideToWorkout(series, blocks, ['climb', 'climb'], {
      fileName: 'a.fit',
      now,
      lang: 'pl',
    });
    expect(w).toMatchObject({
      name: 'Morning Ride',
      description: 'Jazda z 2026-11-22 · Garmin',
      category: 'freestyle',
      tags: ['climb'],
      source: { kind: 'import', file: 'a.fit' },
      updatedAt: now.toISOString(),
      blocks,
    });
  });

  it('falls back to the file name, then to a plain name; no date without a start', () => {
    const series = ride([{ sec: 600, from: 70 }]);
    expect(rideToWorkout(series, blocks, [], { fileName: 'rides/Evening.fit' })?.name).toBe(
      'Evening',
    );
    series.meta = {};
    const w = rideToWorkout(series, blocks, []);
    expect(w).toMatchObject({ name: 'Imported ride', description: '', source: { kind: 'import' } });
  });

  it('gives nothing for blocks the schema refuses', () => {
    const bad: Block[] = [{ kind: 'steady', id: 'x', durationSec: 0, intensity: { effort: 5 } }];
    expect(rideToWorkout(ride([{ sec: 600, from: 70 }]), bad, [])).toBeUndefined();
  });
});
