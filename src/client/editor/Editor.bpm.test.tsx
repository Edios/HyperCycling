import { fireEvent, render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../../domain/settings';
import type { Workout } from '../../domain/workout';

const repo = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  settings: undefined as Settings | undefined,
}));

vi.mock('../data/repositories', () => ({
  getRepositories: () =>
    Promise.resolve({
      workouts: {
        get: (id: string) => Promise.resolve(repo.store.get(id)),
        put: (w: { id: string }) => {
          repo.store.set(w.id, w);
          return Promise.resolve();
        },
        remove: (id: string) => {
          repo.store.delete(id);
          return Promise.resolve();
        },
        list: () => Promise.resolve([...repo.store.values()]),
      },
      settings: {
        get: () => Promise.resolve(repo.settings),
        put: (s: Settings) => {
          repo.settings = s;
          return Promise.resolve();
        },
      },
      activeSession: { get: () => Promise.resolve(undefined) },
    }),
}));

vi.setConfig({ testTimeout: 20_000 });

import { resetSettingsForTests } from '../data/useSettings';
import { resetSharedSpotifyProviderForTests } from '../music/spotify/shared';
import { EditorScreen } from './EditorScreen';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function userWorkout(): Workout {
  return {
    id: 'user-1',
    name: 'My ride',
    description: '',
    category: 'freestyle',
    tags: [],
    source: { kind: 'user' },
    blocks: [
      { kind: 'steady', id: 'a', durationSec: 300, intensity: { effort: 5 }, rpm: 90 },
      { kind: 'steady', id: 'b', durationSec: 120, intensity: { effort: 8 } },
    ],
    musicCues: [],
    fallbackPlaylist: [],
    schemaVersion: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

async function openEditor() {
  const router = createMemoryRouter(
    [
      { path: '/editor/:workoutId', element: <EditorScreen /> },
      { path: '/settings', element: <div data-testid="settings-page" /> },
    ],
    { initialEntries: ['/editor/user-1'] },
  );
  render(<RouterProvider router={router} />);
  await screen.findByTestId('editor-screen');
  fireEvent.click(screen.getAllByTestId('editor-block')[0] as HTMLElement);
  return router;
}

const YT_URL = 'https://youtu.be/dQw4w9WgXcQ';

beforeEach(() => {
  repo.store.clear();
  repo.store.set('user-1', userWorkout());
  repo.settings = undefined;
  resetSettingsForTests();
  resetSharedSpotifyProviderForTests();
});

describe('BPM matching hint', () => {
  beforeEach(() => {
    server.use(
      http.get('https://www.youtube.com/oembed', () =>
        HttpResponse.json({ title: 'Song', author_name: 'Band' }),
      ),
    );
  });

  async function pinTrack() {
    await openEditor();
    fireEvent.change(screen.getByTestId('track-url'), { target: { value: YT_URL } });
    fireEvent.click(screen.getByRole('button', { name: 'Pin track' }));
    return screen.findByTestId('track-bpm');
  }

  it('tells which tempo to look for before a track is pinned (90 RPM -> 180 BPM)', async () => {
    await openEditor();
    expect(screen.getByTestId('bpm-target')).toHaveTextContent('90 RPM');
    expect(screen.getByTestId('bpm-target')).toHaveTextContent('180 BPM');
    expect(screen.queryByTestId('track-bpm')).not.toBeInTheDocument();
  });

  it('judges a typed BPM against the block cadence and stores it on the track', async () => {
    const bpm = await pinTrack();
    fireEvent.change(bpm, { target: { value: '180' } });
    expect(screen.getByTestId('bpm-match')).toHaveTextContent('Fits the cadence');
    fireEvent.change(bpm, { target: { value: '90' } });
    expect(screen.getByTestId('bpm-match')).toHaveTextContent('half time');
    fireEvent.change(bpm, { target: { value: '128' } });
    expect(screen.getByTestId('bpm-nomatch')).toBeInTheDocument();
  });

  it('rejects an implausible tempo', async () => {
    const bpm = await pinTrack();
    fireEvent.change(bpm, { target: { value: '999' } });
    expect(screen.getByRole('alert')).toHaveTextContent('40-220');
    expect(screen.queryByTestId('bpm-match')).not.toBeInTheDocument();
  });
});
