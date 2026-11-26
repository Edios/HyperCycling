import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ plans: new Map<string, unknown>(), fail: false }));
vi.mock('../data/repositories', () => ({
  getRepositories: () =>
    Promise.resolve({
      workouts: { list: () => Promise.resolve([]) },
      settings: { get: () => Promise.resolve(undefined), put: () => Promise.resolve() },
      players: { list: () => Promise.resolve([]), put: () => Promise.resolve() },
      planProgress: { get: () => Promise.resolve(undefined), put: () => Promise.resolve() },
      sessionLogs: { put: () => Promise.resolve() },
      rides: { put: () => Promise.resolve() },
      soundtrackPlans: {
        put: (r: { id: string }) => {
          if (db.fail) return Promise.reject(new Error('disk'));
          db.plans.set(r.id, r);
          return Promise.resolve();
        },
      },
    }),
}));

vi.setConfig({ testTimeout: 20_000 });

import raw from '../../content/soundtrack/catalog.json';
import { parseCatalog } from '../../domain/soundtrack-catalog';
import { DEFAULT_SOUNDTRACK_PREFS, planSoundtrack } from '../../domain/soundtrack-plan';
import type { SoundtrackPlanRecord } from '../../domain/soundtrack-store';
import { builtinWorkouts } from '../data/builtin';
import { resetSettingsForTests } from '../data/useSettings';
import { SOUNDTRACK_HISTORY_KEY } from '../soundtrack/history';
import { resetSoundtrackSessionForTests, useSoundtrackSession } from '../soundtrack/session';
import { useLastResult } from '../training/last-result';
import { SummaryScreen } from './SummaryScreen';

const catalog = parseCatalog(raw).tracks;
const workout = builtinWorkouts.find((w) => w.id === 'class-endurance-45')!;
const saved = planSoundtrack(workout, catalog, { ...DEFAULT_SOUNDTRACK_PREFS, seed: 4 });
const drawn = planSoundtrack(workout, catalog, { ...DEFAULT_SOUNDTRACK_PREFS, seed: 77 });

function rideWith(drawnOrder: boolean, music = true): void {
  useSoundtrackSession.setState({
    plans: { [workout.id]: drawnOrder ? drawn : saved },
    saved: { [workout.id]: saved },
    drawn: drawnOrder ? { [workout.id]: true } : {},
  });
  useLastResult.setState({
    result: {
      workout,
      riddenSec: 600,
      completed: false,
      config: { background: 'basic', hud: 'solo', playerIds: [], music },
      players: [],
      startedAt: '2026-11-26T10:00:00.000Z',
    },
  });
  render(
    <MemoryRouter initialEntries={['/summary']}>
      <Routes>
        <Route path="/summary" element={<SummaryScreen />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  db.plans.clear();
  db.fail = false;
  localStorage.removeItem(SOUNDTRACK_HISTORY_KEY);
  resetSettingsForTests();
  resetSoundtrackSessionForTests();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('the summary after a ride on a new song order', () => {
  it('saves the order of the ride for the next ride of the workout', async () => {
    rideWith(true);
    const card = await screen.findByTestId('summary-song-order');
    expect(card).toHaveTextContent('This ride had a new order of songs.');
    fireEvent.click(screen.getByRole('button', { name: 'Save the song order' }));
    expect(
      await screen.findByText('Saved: the next ride of this workout plays this order again.'),
    ).toBeInTheDocument();
    expect((db.plans.get(workout.id) as SoundtrackPlanRecord).plan).toEqual(drawn);
    expect(useSoundtrackSession.getState().saved[workout.id]).toBe(drawn);
    expect(screen.queryByRole('button', { name: 'Save the song order' })).not.toBeInTheDocument();
  });

  it('says so when the order could not be saved, and lets the rider try again', async () => {
    db.fail = true;
    rideWith(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Save the song order' }));
    expect(
      await screen.findByText('The song order could not be saved on this device.'),
    ).toBeInTheDocument();
    db.fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Save the song order' }));
    await waitFor(() => expect(db.plans.has(workout.id)).toBe(true));
  });

  it('offers nothing after a ride with the music off (an order nobody heard)', async () => {
    rideWith(true, false);
    await screen.findByTestId('summary-screen');
    expect(screen.queryByTestId('summary-song-order')).not.toBeInTheDocument();
  });

  it('offers nothing after a ride on the saved order', async () => {
    rideWith(false);
    await screen.findByTestId('summary-screen');
    expect(screen.queryByTestId('summary-song-order')).not.toBeInTheDocument();
  });
});
