import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flattenWorkout } from '../../domain/segments';
import type { SessionConfig } from '../../domain/settings';
import type { TrackRef, Workout } from '../../domain/workout';
import { resetSettingsForTests } from '../data/useSettings';
import { createFakeMusicProvider, type FakeMusicProvider } from '../music/fake-provider';
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

const music = vi.hoisted(() => ({
  provider: undefined as unknown as FakeMusicProvider,
  created: 0,
  disposed: 0,
}));
vi.mock('../music/providers', () => ({
  createMusicProviders: () => {
    music.created += 1;
    return {
      get: () => music.provider,
      dispose: () => {
        music.disposed += 1;
      },
    };
  },
}));

let now = 0;
const fallback: TrackRef = {
  provider: 'youtube',
  id: 'abcdefghijk',
  title: 'Warm up jam',
  startAtSec: 0,
};

function workoutWith(extra: Partial<Workout>): Workout {
  return {
    id: 'w1',
    name: 'Test ride',
    blocks: [{ kind: 'steady', id: 'a', durationSec: 60, intensity: { effort: 3 }, rpm: 85 }],
    musicCues: [],
    fallbackPlaylist: [],
    ...extra,
  } as unknown as Workout;
}

function load(workout: Workout, musicOn: boolean): void {
  const config: SessionConfig = {
    background: 'basic',
    hud: 'solo',
    playerIds: [],
    music: musicOn,
  };
  useSessionStore
    .getState()
    .load({ workout, segments: flattenWorkout(workout), config, players: [] });
}

async function renderScreen() {
  const view = render(
    <MemoryRouter initialEntries={['/train']}>
      <Routes>
        <Route path="/train" element={<TrainingScreen />} />
        <Route path="*" element={<div />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByTestId('training-screen');
  return view;
}

/** Starts the engine, skips the countdown and lets the director's promises settle. */
async function startRunning() {
  await act(async () => {
    useSessionStore.getState().start();
  });
  now += 3100;
  await act(async () => {
    useSessionStore.getState().tick();
  });
  expect(useSessionStore.getState().state.status).toBe('running');
}

beforeEach(() => {
  music.provider = createFakeMusicProvider({ kind: 'youtube' });
  music.created = 0;
  music.disposed = 0;
  resetSettingsForTests();
  useLastResult.getState().clear();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  now = 0;
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
  vi.restoreAllMocks();
});

describe('music in the training screen', () => {
  it('plays the scheduled track once the workout runs', async () => {
    load(workoutWith({ fallbackPlaylist: [fallback] }), true);
    await renderScreen();
    expect(music.provider.log).toEqual([]);
    await startRunning();
    expect(music.provider.log).toEqual(['play:abcdefghijk@0']);
  });

  it('follows the engine pause', async () => {
    load(workoutWith({ fallbackPlaylist: [fallback] }), true);
    await renderScreen();
    await startRunning();
    await act(async () => {
      useSessionStore.getState().pause();
    });
    expect(music.provider.log).toEqual(['play:abcdefghijk@0', 'pause']);
  });

  it('does nothing when the session has music off', async () => {
    load(workoutWith({ fallbackPlaylist: [fallback] }), false);
    await renderScreen();
    await startRunning();
    expect(music.created).toBe(0);
    expect(music.provider.log).toEqual([]);
  });

  it('does nothing when the workout has no tracks or cues', async () => {
    load(workoutWith({}), true);
    await renderScreen();
    await startRunning();
    expect(music.created).toBe(0);
  });

  it('a failing provider shows one warning and leaves the session running', async () => {
    music.provider.failPlaysWhen(() => true);
    load(workoutWith({ fallbackPlaylist: [fallback] }), true);
    await renderScreen();
    await startRunning();
    expect(screen.getByText(/Cannot play "Warm up jam"/)).toBeInTheDocument();
    const state = useSessionStore.getState().state;
    expect(state.status).toBe('running');
    now += 2000;
    await act(async () => {
      useSessionStore.getState().tick();
    });
    expect(useSessionStore.getState().state.workoutElapsedSec).toBeGreaterThan(
      state.workoutElapsedSec,
    );
    expect(useSessionStore.getState().state.status).toBe('running');
  });

  it('releases the providers when the screen goes away', async () => {
    load(workoutWith({ fallbackPlaylist: [fallback] }), true);
    const view = await renderScreen();
    await startRunning();
    view.unmount();
    expect(music.disposed).toBe(1);
    expect(music.provider.log).toContain('pause');
  });
});
