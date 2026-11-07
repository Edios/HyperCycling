import { act, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flattenWorkout } from '../../domain/segments';
import type { SessionConfig } from '../../domain/settings';
import type { Workout } from '../../domain/workout';
import { resetSettingsForTests } from '../data/useSettings';
import { useLastResult } from './last-result';
import {
  configureSessionSideEffects,
  resetSessionClock,
  setSessionClock,
  useSessionStore,
} from './session-store';
import { TrainingScreen } from './TrainingScreen';

vi.mock('../data/repositories', () => ({
  getRepositories: () =>
    Promise.resolve({
      settings: { get: () => Promise.resolve(undefined), put: () => Promise.resolve() },
    }),
}));

const workout = {
  id: 'w1',
  name: 'Test ride',
  blocks: [{ kind: 'steady', id: 'a', durationSec: 60, intensity: { effort: 3 }, rpm: 85 }],
} as unknown as Workout;

let now = 0;

function load(): void {
  const config: SessionConfig = { background: 'basic', hud: 'solo', playerIds: [], music: false };
  useSessionStore
    .getState()
    .load({ workout, segments: flattenWorkout(workout), config, players: [] });
}

async function renderAt() {
  const router = createMemoryRouter(
    [
      { path: '/setup', element: <div data-testid="setup-page" /> },
      { path: '/train', element: <TrainingScreen /> },
      { path: '/summary', element: <div data-testid="summary-page" /> },
      { path: '/', element: <div data-testid="home-page" /> },
    ],
    { initialEntries: ['/setup', '/train'], initialIndex: 1 },
  );
  render(<RouterProvider router={router} />);
  await screen.findByTestId('training-screen');
  return router;
}

beforeEach(() => {
  now = 0;
  resetSettingsForTests();
  useLastResult.getState().clear();
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  setSessionClock(() => now);
  configureSessionSideEffects({
    wakeLock: { acquire: async () => undefined, release: async () => undefined },
    save: async () => undefined,
    clear: async () => undefined,
  });
});

afterEach(() => {
  useSessionStore.getState().stop();
  configureSessionSideEffects(null);
  resetSessionClock();
  vi.unstubAllGlobals();
});

function startRide(): void {
  act(() => {
    fireEvent.keyDown(window, { code: 'Space', key: ' ' });
  });
  now += 3100;
  act(() => useSessionStore.getState().tick());
}

describe('browser Back during a ride (QA F8)', () => {
  it('asks the exit question instead of leaving', async () => {
    load();
    const router = await renderAt();
    startRide();
    await act(async () => {
      await router.navigate(-1);
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/train');
    expect(useSessionStore.getState().state.status).toBe('paused');
  });

  it('Cancel stays on the ride and resumes it', async () => {
    load();
    const router = await renderAt();
    startRide();
    await act(async () => {
      await router.navigate(-1);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Back to workout' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(router.state.location.pathname).toBe('/train');
    expect(useSessionStore.getState().state.status).toBe('running');
  });

  it('Leave without saving goes home after Back', async () => {
    load();
    const router = await renderAt();
    startRide();
    await act(async () => {
      await router.navigate(-1);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Leave without saving' }));
    expect(await screen.findByTestId('home-page')).toBeInTheDocument();
  });

  it('does not block before the ride has started', async () => {
    load();
    const router = await renderAt();
    await act(async () => {
      await router.navigate(-1);
    });
    expect(await screen.findByTestId('setup-page')).toBeInTheDocument();
  });
});
