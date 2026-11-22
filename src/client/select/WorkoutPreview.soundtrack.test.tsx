import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../domain/settings';
import type { TrackRef, Workout } from '../../domain/workout';

vi.mock('../data/repositories', () => ({
  getRepositories: () =>
    Promise.resolve({
      settings: {
        get: () => Promise.resolve({ ...DEFAULT_SETTINGS }),
        put: () => Promise.resolve(),
      },
    }),
}));

import { builtinWorkouts } from '../data/builtin';
import { resetSettingsForTests } from '../data/useSettings';
import { resetSoundtrackSessionForTests, useSoundtrackSession } from '../soundtrack/session';
import { WorkoutPreview } from './WorkoutPreview';

const workout = builtinWorkouts.find((w) => w.id === 'class-endurance-45')!;
const track: TrackRef = { provider: 'youtube', id: 'abcdefghijk', title: 'T', startAtSec: 0 };

function renderPreview(w: Workout) {
  return render(
    <MemoryRouter>
      <WorkoutPreview workout={w} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetSettingsForTests();
  resetSoundtrackSessionForTests();
});

describe('WorkoutPreview, match music', () => {
  it('links to the wizard of this workout, and the wizard plans the workout as it is', () => {
    useSoundtrackSession.getState().setWorkout(workout.id, workout); // left over from a ride setup
    renderPreview(workout);
    const link = screen.getByTestId('workout-match-music');
    expect(link).toHaveTextContent('Match music');
    expect(link).toHaveAttribute('href', `/soundtrack/${workout.id}?from=select`);
    fireEvent.click(link);
    expect(useSoundtrackSession.getState().workouts).toEqual({});
  });

  it('says "Change music" when the workout already has music', () => {
    renderPreview({ ...workout, musicCues: [{ blockId: 'x', rep: 1, track }] });
    expect(screen.getByTestId('workout-match-music')).toHaveTextContent('Change music');
  });

  it('is not offered for a workout under five minutes', () => {
    const short: Workout = {
      ...workout,
      blocks: [{ kind: 'steady', id: 'a', durationSec: 120, intensity: { effort: 4 }, rpm: 90 }],
    };
    renderPreview(short);
    expect(screen.queryByTestId('workout-match-music')).not.toBeInTheDocument();
  });
});
