import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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

interface BgProps {
  videoId: string;
  startSec: number;
  paused: boolean;
  onFail: (r: 'embed-blocked' | 'unavailable') => void;
}
const bg = vi.hoisted(() => ({ last: undefined as unknown }));
vi.mock('../youtube/YouTubeBackground', () => ({
  YouTubeBackground: (props: BgProps) => {
    bg.last = props;
    return <div data-testid="youtube-background" />;
  },
}));
let now = 0;
const props = (): BgProps => bg.last as BgProps;

const workout = {
  id: 'w1',
  name: 'Test ride',
  blocks: [{ kind: 'steady', id: 'a', durationSec: 10, intensity: { effort: 3 }, rpm: 85 }],
} as unknown as Workout;

function load(youtubeUrl: string | undefined): void {
  const config: SessionConfig = {
    background: 'youtube',
    hud: 'immersive',
    playerIds: [],
    music: false,
    ...(youtubeUrl ? { youtubeUrl } : {}),
  };
  useSessionStore
    .getState()
    .load({ workout, segments: flattenWorkout(workout), config, players: [] });
}

async function renderScreen() {
  render(
    <MemoryRouter initialEntries={['/train']}>
      <Routes>
        <Route path="/train" element={<TrainingScreen />} />
        <Route path="*" element={<div />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByTestId('training-screen');
}

beforeEach(() => {
  bg.last = undefined;
  resetSettingsForTests();
  useLastResult.getState().clear();
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
});

describe('YouTube background in the training screen', () => {
  it('shows the video behind the overlay HUD with the start offset', async () => {
    load('https://youtu.be/dQw4w9WgXcQ?t=1m30s');
    await renderScreen();
    expect(screen.getByTestId('youtube-background')).toBeInTheDocument();
    expect(screen.getByTestId('layout-immersive')).toBeInTheDocument();
    expect(screen.getByTestId('training-screen')).toHaveAttribute('data-background', 'youtube');
    expect(props()).toMatchObject({ videoId: 'dQw4w9WgXcQ', startSec: 90, paused: false });
  });

  it('follows the engine pause and resume', async () => {
    load('https://youtu.be/dQw4w9WgXcQ');
    await renderScreen();
    act(() => useSessionStore.getState().start());
    now += 3100;
    act(() => void useSessionStore.getState().tick());
    expect(useSessionStore.getState().state.status).toBe('running');
    act(() => useSessionStore.getState().pause());
    expect(props().paused).toBe(true);
    act(() => useSessionStore.getState().resume());
    expect(props().paused).toBe(false);
  });

  it('an embedding error shows a toast and falls back to Basic dark', async () => {
    load('https://youtu.be/dQw4w9WgXcQ');
    await renderScreen();
    act(() => props().onFail('embed-blocked'));
    expect(screen.queryByTestId('youtube-background')).toBeNull();
    expect(screen.getByText(/cannot be embedded/)).toBeInTheDocument();
    const root = screen.getByTestId('training-screen');
    expect(root).toHaveAttribute('data-background', 'basic');
    expect(root).toHaveAttribute('data-theme', 'dark');
  });

  it('an unplayable video shows the generic message', async () => {
    load('https://youtu.be/dQw4w9WgXcQ');
    await renderScreen();
    act(() => props().onFail('unavailable'));
    expect(screen.getByText(/cannot be played/)).toBeInTheDocument();
  });

  it('an unreadable link falls back at once', async () => {
    load('https://example.com/nope');
    await renderScreen();
    expect(screen.queryByTestId('youtube-background')).toBeNull();
    expect(screen.getByTestId('training-screen')).toHaveAttribute('data-background', 'basic');
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('H cycles the overlay layouts on YouTube', async () => {
    load('https://youtu.be/dQw4w9WgXcQ');
    await renderScreen();
    act(() => void fireEvent.keyDown(window, { code: 'KeyH', key: 'h' }));
    expect(screen.getByTestId('layout-column')).toBeInTheDocument();
  });
});
