import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../../domain/settings';
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
import { createLibraryStore, setLibraryStoreForTests } from '../music/library/library';
import { resetSharedSpotifyProviderForTests } from '../music/spotify/shared';
import { EditorScreen } from './EditorScreen';

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
      { kind: 'steady', id: 'b', durationSec: 120, intensity: { effort: 8 }, rpm: 100 },
      { kind: 'steady', id: 'c', durationSec: 180, intensity: { effort: 2 } },
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
  return router;
}

beforeEach(() => {
  repo.store.clear();
  repo.store.set('user-1', userWorkout());
  repo.settings = { ...DEFAULT_SETTINGS };
  resetSettingsForTests();
  resetSharedSpotifyProviderForTests();
  const lib = createLibraryStore(undefined);
  lib.set([
    { id: 'fast1', title: 'Fast Song', artist: 'Band', bpm: 180, bpmSource: 'deezer', taggedAt: 1 },
    { id: 'slow1', title: 'Slow Song', bpm: 100, bpmSource: 'manual' },
  ]);
  setLibraryStoreForTests(lib);
});
afterEach(() => setLibraryStoreForTests());

describe('Suggested chips in the editor (M19b)', () => {
  it('pins a suggested song to the block, with its tempo and source', async () => {
    await openEditor();
    fireEvent.click(screen.getAllByTestId('editor-block')[0] as HTMLElement);
    const chips = await screen.findAllByTestId('suggested-chip');
    expect(chips).toHaveLength(1); // 90 RPM wants 180 BPM; 100 BPM does not fit
    expect(chips[0]).toHaveTextContent('180 BPM · Deezer · fits');
    fireEvent.click(chips[0] as HTMLElement);
    await waitFor(() => expect(screen.getByTestId('track-pinned')).toHaveTextContent('Fast Song'));
    expect(screen.getByTestId('track-bpm')).toHaveValue('180');
  });

  it('fills a song slot like Find a song does and pins the track', async () => {
    await openEditor();
    fireEvent.click(screen.getAllByTestId('editor-block')[0] as HTMLElement);
    fireEvent.click(screen.getByTestId('song-add'));
    const panel = await screen.findByTestId('song-panel');
    fireEvent.click(within(panel).getByTestId('suggested-chip'));
    await waitFor(() => expect(screen.getByTestId('song-pill')).toHaveTextContent('Fast Song'));
    expect(within(panel).getByTestId('song-hint')).toHaveValue('Band – Fast Song');
    expect(within(panel).getByTestId('song-bpm-min')).toHaveValue('180');
    expect(within(panel).getByTestId('song-track')).toHaveTextContent('Fast Song');
  });
});
