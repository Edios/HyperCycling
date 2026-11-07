import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EFFORT_TABLE } from '../../../domain/effort';
import { flattenWorkout } from '../../../domain/segments';
import type { Workout } from '../../../domain/workout';
import { buildTrainingView } from '../view';
import { BasicPlayers } from './BasicPlayers';
import { BasicSolo } from './BasicSolo';
import { Cockpit } from './overlay/Cockpit';
import { Column } from './overlay/Column';
import { Immersive } from './overlay/Immersive';
import { TunnelTime } from './overlay/TunnelTime';
import { FocusRest } from './FocusRest';
import type { BasicLayoutProps } from './types';

const workout: Workout = {
  id: 'w',
  name: 'n',
  description: '',
  category: 'progres',
  tags: [],
  source: { kind: 'user' },
  blocks: [
    { kind: 'steady', id: 'a', durationSec: 60, intensity: { effort: 5 }, position: 'standing' },
    { kind: 'steady', id: 'b', durationSec: 60, intensity: { effort: 6 } },
    { kind: 'ramp', id: 'c', durationSec: 240, from: { effort: 3 }, to: { effort: 8 } },
  ],
  musicCues: [],
  fallbackPlaylist: [],
  schemaVersion: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function props(index: number, elapsed: number, hideRpmTile: boolean): BasicLayoutProps {
  const segments = flattenWorkout(workout, DEFAULT_EFFORT_TABLE, 'knob');
  const view = buildTrainingView(
    segments,
    {
      status: 'running',
      segmentIndex: index,
      workoutElapsedSec: (segments[index]?.startSec ?? 0) + elapsed,
      segmentElapsedSec: elapsed,
      segmentRemainingSec: (segments[index]?.durationSec ?? 0) - elapsed,
    },
    DEFAULT_EFFORT_TABLE,
  );
  if (!view) throw new Error('no view');
  return {
    view,
    segments,
    players: [],
    showsWatts: false,
    rpmIsTarget: true,
    hideRpmTile,
    reducedMotion: true,
    glass: false,
    workoutName: 'n',
    controls: null,
    coach: null,
  };
}

const LAYOUTS = {
  solo: BasicSolo,
  players: BasicPlayers,
  immersive: Immersive,
  column: Column,
  cockpit: Cockpit,
  tunnelTime: TunnelTime,
} as const;

describe('every layout shows exactly one position badge', () => {
  for (const [name, Layout] of Object.entries(LAYOUTS)) {
    it(`${name}, with the rpm tile hidden`, () => {
      render(<Layout {...props(0, 10, true)} />);
      const badges = screen.getAllByTestId('position-badge');
      expect(badges).toHaveLength(1);
      expect(badges[0]).toHaveAttribute('data-position', 'standing');
    });
    it(`${name} defaults to seated when no block sets a position`, () => {
      render(<Layout {...props(1, 10, false)} />);
      expect(screen.getByTestId('position-badge')).toHaveAttribute('data-position', 'seated');
      expect(document.body.textContent ?? '').not.toMatch(/undefined/);
    });
  }

  it('focus at rest shows the badge too', () => {
    const p = props(0, 10, false);
    render(<FocusRest view={p.view} active reducedMotion />);
    expect(screen.getAllByTestId('position-badge')).toHaveLength(1);
  });

  it('NEXT shows the next block position', () => {
    render(<Immersive {...props(0, 10, false)} />);
    expect(screen.getByTestId('next-block')).toHaveTextContent(/seated/i);
  });

  it('shows the step line in a stepped ramp and not in a steady block', () => {
    const { unmount } = render(<Immersive {...props(2, 5, false)} />);
    expect(screen.getByTestId('step-line')).toHaveTextContent(/Step 1\/6/);
    unmount();
    render(<Immersive {...props(1, 5, false)} />);
    expect(screen.queryByTestId('step-line')).toBeNull();
  });
});
