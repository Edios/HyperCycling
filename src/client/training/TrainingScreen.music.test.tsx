import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flattenWorkout } from '../../domain/segments';
import { DEFAULT_SETTINGS, type SessionConfig, type Settings } from '../../domain/settings';
import type { TrackRef, Workout } from '../../domain/workout';
import { resetSettingsForTests } from '../data/useSettings';
import { SpotifyError } from '../music/spotify/errors';
import { createFakeMusicProvider, type FakeMusicProvider } from '../music/fake-provider';
import { useLastResult } from './last-result';
import {
  configureSessionSideEffects,
  resetSessionClock,
  setSessionClock,
  useSessionStore,
} from './session-store';
import { TrainingScreen } from './TrainingScreen';

const repoSettings = vi.hoisted(() => ({ value: undefined as Settings | undefined }));
vi.mock('../data/repositories', () => ({
  getRepositories: () =>
    Promise.resolve({
      settings: { get: () => Promise.resolve(repoSettings.value), put: () => Promise.resolve() },
    }),
}));

const music = vi.hoisted(() => ({
  provider: undefined as unknown as FakeMusicProvider,
  created: 0,
  disposed: 0,
  /** The element the player was given to live in (the dock's slot). */
  slot: undefined as HTMLElement | undefined,
}));
vi.mock('../music/providers', () => ({
  createMusicProviders: (frame?: { parent: HTMLElement }) => {
    music.slot = frame?.parent;
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
  repoSettings.value = undefined;
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
    expect(screen.getByText(/Cannot play “Warm up jam”/)).toBeInTheDocument();
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

describe('now playing, mute and warnings', () => {
  const titled: TrackRef = { ...fallback, title: 'Warm up jam', artist: 'The Band' };

  it('shows the track in the corner while it plays and hides it when music is off', async () => {
    load(workoutWith({ fallbackPlaylist: [titled] }), true);
    await renderScreen();
    expect(screen.queryByTestId('now-playing')).not.toBeInTheDocument();
    await startRunning();
    const corner = screen.getByTestId('now-playing');
    expect(corner).toHaveTextContent('Warm up jam');
    expect(corner).toHaveTextContent('The Band · YouTube');
  });

  it('shows the name the provider resolves for a track saved without a title', async () => {
    music.provider = createFakeMusicProvider({
      kind: 'youtube',
      describe: () => Promise.resolve({ title: 'Looked Up', artist: 'Resolved Band' }),
    });
    load(workoutWith({ fallbackPlaylist: [{ ...titled, title: '', artist: undefined }] }), true);
    await renderScreen();
    await startRunning();
    await waitFor(() => expect(screen.getByTestId('now-playing')).toHaveTextContent('Looked Up'));
    expect(screen.getByTestId('now-playing')).toHaveTextContent('Resolved Band');
  });

  it('shows the music player with the title while a YouTube track plays, and can hide it', async () => {
    load(workoutWith({ fallbackPlaylist: [titled] }), true);
    await renderScreen();
    // The dock is always there when the ride has music (the player lives in it), parked until
    // something plays.
    expect(screen.getByTestId('music-dock')).toHaveAttribute('data-visible', 'false');
    await startRunning();
    const dock = screen.getByTestId('music-dock');
    expect(dock).toHaveAttribute('data-visible', 'true');
    expect(screen.getByTestId('music-player-name')).toHaveTextContent('Warm up jam');
    // The director was started with the dock's slot, so YouTube's player is mounted in it.
    expect(music.slot).toBe(screen.getByTestId('music-player-slot'));
    // The HUD steps aside for the player (a column on its left) and the corner label gives way.
    expect(screen.getByTestId('training-screen')).toHaveAttribute('data-player', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Hide the music player' }));
    await waitFor(() =>
      expect(screen.getByTestId('music-dock')).toHaveAttribute('data-visible', 'false'),
    );
    expect(screen.getByTestId('training-screen')).not.toHaveAttribute('data-player');
    // Hiding is only a look: the track goes on.
    expect(screen.getByTestId('now-playing')).toHaveTextContent('Warm up jam');
    expect(music.provider.calls.filter((c) => c.type === 'pause')).toHaveLength(0);
  });

  describe('on a mobile device', () => {
    /** A phone: `mobile` matches the mobile query, `portrait` also the portrait one. */
    const device = (mobile: boolean, portrait = false) =>
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: query.includes('orientation: portrait') ? mobile && portrait : mobile,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }));
    const portrait = (on: boolean) => device(on, on);

    it('does not show the player until the rider switched it on', async () => {
      portrait(true);
      load(workoutWith({ fallbackPlaylist: [titled] }), true);
      await renderScreen();
      await startRunning();
      expect(screen.getByTestId('music-dock')).toHaveAttribute('data-visible', 'false');
      expect(screen.getByTestId('training-screen')).not.toHaveAttribute('data-player');
      expect(screen.getByTestId('now-playing')).toBeInTheDocument();
    });

    it('does not show the player on a phone on its side either, until switched on', async () => {
      device(true, false);
      load(workoutWith({ fallbackPlaylist: [titled] }), true);
      await renderScreen();
      await startRunning();
      expect(screen.getByTestId('music-dock')).toHaveAttribute('data-visible', 'false');
      expect(screen.getByTestId('training-screen')).not.toHaveAttribute('data-player');
    });

    it('shows it beside the HUD on a phone on its side when the rider turned it on', async () => {
      device(true, false);
      repoSettings.value = { ...DEFAULT_SETTINGS, showMusicPlayer: true };
      resetSettingsForTests();
      load(workoutWith({ fallbackPlaylist: [titled] }), true);
      await renderScreen();
      await startRunning();
      await waitFor(() =>
        expect(screen.getByTestId('music-dock')).toHaveAttribute('data-visible', 'true'),
      );
      expect(screen.getByTestId('training-screen')).toHaveAttribute('data-player', 'true');
    });

    it('keeps a rider\'s own "off" on a computer and their "on" on a phone', async () => {
      device(false);
      repoSettings.value = { ...DEFAULT_SETTINGS, showMusicPlayer: false };
      resetSettingsForTests();
      load(workoutWith({ fallbackPlaylist: [titled] }), true);
      await renderScreen();
      await startRunning();
      expect(screen.getByTestId('music-dock')).toHaveAttribute('data-visible', 'false');
    });

    it('shows it, with the HUD above it and without the corner label, when the setting says so', async () => {
      portrait(true);
      repoSettings.value = { ...DEFAULT_SETTINGS, showMusicPlayer: true };
      resetSettingsForTests();
      load(workoutWith({ fallbackPlaylist: [titled] }), true);
      await renderScreen();
      await startRunning();
      await waitFor(() =>
        expect(screen.getByTestId('music-dock')).toHaveAttribute('data-visible', 'true'),
      );
      expect(screen.getByTestId('training-screen')).toHaveAttribute('data-player', 'true');
    });
  });

  it('has no player dock when the session has music off', async () => {
    load(workoutWith({ fallbackPlaylist: [titled] }), false);
    await renderScreen();
    expect(screen.queryByTestId('music-dock')).not.toBeInTheDocument();
  });

  it('shows nothing when the session has music off', async () => {
    load(workoutWith({ fallbackPlaylist: [titled] }), false);
    await renderScreen();
    await startRunning();
    expect(screen.queryByTestId('now-playing')).not.toBeInTheDocument();
  });

  it('the M key mutes the music and unmuting restores it', async () => {
    load(workoutWith({ fallbackPlaylist: [titled] }), true);
    await renderScreen();
    await startRunning();
    expect(music.provider.log).toEqual(['play:abcdefghijk@0']);
    await act(async () => {
      fireEvent.keyDown(window, { code: 'KeyM' });
    });
    expect(music.provider.log.at(-1)).toBe('setVolume:0');
    expect(screen.getByTestId('now-playing')).toHaveAttribute('data-muted', 'true');
    expect(screen.getByTestId('now-playing')).toHaveTextContent('muted');
    await act(async () => {
      fireEvent.keyDown(window, { code: 'KeyM' });
    });
    expect(music.provider.log.at(-1)).toBe('setVolume:1');
    expect(screen.getByTestId('now-playing')).toHaveAttribute('data-muted', 'false');
  });

  it('a track that starts while muted begins at volume 0', async () => {
    load(workoutWith({ fallbackPlaylist: [titled] }), true);
    await renderScreen();
    await act(async () => {
      fireEvent.keyDown(window, { code: 'KeyM' });
    });
    await startRunning();
    expect(music.provider.log).toEqual(['setVolume:0', 'play:abcdefghijk@0']);
  });

  it.each([
    ['noActiveDevice', 'Open Spotify on a phone or computer'],
    ['premiumRequired', 'Premium'],
    ['notAuthorized', 'not connected'],
    ['rateLimited', 'busy'],
  ] as const)('maps the Spotify error %s to a clear warning', async (code, text) => {
    music.provider.failPlaysWhen(() => true);
    music.provider.failPlaysWith(new SpotifyError(code));
    load(
      workoutWith({
        fallbackPlaylist: [{ ...titled, provider: 'spotify', id: '4uLU6hMCjMI75M1A2tKUQC' }],
      }),
      true,
    );
    await renderScreen();
    await startRunning();
    const stack = screen.getByTestId('toast-stack');
    expect(stack).toHaveTextContent(text);
    expect(useSessionStore.getState().state.status).toBe('running');
  });

  it('puts the warning in the toast stack, which holds several toasts without overlap', async () => {
    music.provider.failPlaysWhen(() => true);
    load(workoutWith({ fallbackPlaylist: [titled] }), true);
    await renderScreen();
    await startRunning();
    const stack = screen.getByTestId('toast-stack');
    expect(stack).toContainElement(screen.getByText(/Cannot play “Warm up jam”/));
  });
});
