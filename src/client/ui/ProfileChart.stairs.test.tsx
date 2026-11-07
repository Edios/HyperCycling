import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { flattenWorkout } from '../../domain/segments';
import type { Workout } from '../../domain/workout';
import { ProfileChart, stairPolygons } from './ProfileChart';

const workout: Workout = {
  id: 'w',
  name: 'n',
  description: '',
  category: 'progres',
  tags: [],
  source: { kind: 'user' },
  blocks: [{ kind: 'ramp', id: 'r', durationSec: 240, from: { effort: 3 }, to: { effort: 8 } }],
  musicCues: [],
  fallbackPlaylist: [],
  schemaVersion: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('stairPolygons', () => {
  it('draws horizontal runs with vertical risers, and a closed bottom', () => {
    const steps = [
      { offsetSec: 0, durationSec: 50, effort: 2 },
      { offsetSec: 50, durationSec: 50, effort: 4 },
    ];
    const { fill } = stairPolygons(steps, 100, 4);
    // y of effort 2 of top 4 = 50 %, effort 4 = 0 %
    expect(fill).toBe('polygon(0% 50%, 50% 50%, 50% 0%, 100% 0%, 100% 100%, 0% 100%)');
  });

  it('the edge band follows the same staircase', () => {
    const { edge } = stairPolygons([{ offsetSec: 0, durationSec: 10, effort: 5 }], 10, 5, '3px');
    expect(edge).toContain('0% 0%');
    expect(edge).toContain('calc(0% + 3px)');
  });
});

describe('ProfileChart with stepped segments', () => {
  it('uses the staircase polygon for a stepped ramp and the slope for a smooth one', () => {
    const stepped = flattenWorkout(workout, undefined, 'knob');
    const { rerender } = render(<ProfileChart segments={stepped} height={100} />);
    const fill = screen.getByTestId('profile-chart').querySelector('b') as HTMLElement;
    const pts = (fill.style.clipPath.match(/\d+(\.\d+)?%/g) ?? []).join(' ');
    // six steps: a staircase has many more vertices than the 4-point slope polygon
    expect(pts.split(' ').length).toBeGreaterThan(10);
    rerender(<ProfileChart segments={flattenWorkout(workout)} height={100} />);
    const slope = screen.getByTestId('profile-chart').querySelector('b') as HTMLElement;
    expect((slope.style.clipPath.match(/\d+(\.\d+)?%/g) ?? []).length).toBeLessThanOrEqual(8);
  });
});
