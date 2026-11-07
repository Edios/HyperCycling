import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
import { setDeezerClientForTests } from '../music/bpmLookup';
import { GetSongBpmError } from '../music/getsongbpm/client';
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

const YT_URL = 'https://youtu.be/dQw4w9WgXcQ';

beforeEach(() => {
  repo.store.clear();
  repo.store.set('user-1', userWorkout());
  repo.settings = undefined;
  resetSettingsForTests();
  resetSharedSpotifyProviderForTests();
  server.use(
    http.get('https://www.youtube.com/oembed', () =>
      HttpResponse.json({ title: 'Cool Song', author_name: 'X' }),
    ),
  );
});

const select = (i: number): void => {
  fireEvent.click(screen.getAllByTestId('editor-block')[i] as HTMLElement);
};

describe('song slots and the cool-down lane (M16 / M19c)', () => {
  it('builds a song from the selected block, sets hint and BPM, grows it and shows the card', async () => {
    await openEditor();
    expect(screen.queryByTestId('song-add')).not.toBeInTheDocument();
    select(0);
    fireEvent.click(screen.getByTestId('song-add'));
    const panel = await screen.findByTestId('song-panel');
    fireEvent.change(within(panel).getByTestId('song-hint'), { target: { value: 'Pop warm-up' } });
    fireEvent.blur(within(panel).getByTestId('song-hint'));
    fireEvent.change(within(panel).getByTestId('song-bpm-min'), { target: { value: '120' } });
    fireEvent.change(within(panel).getByTestId('song-bpm-max'), { target: { value: '128' } });
    fireEvent.blur(within(panel).getByTestId('song-bpm-max'));
    fireEvent.click(within(panel).getByTestId('song-end-plus'));
    const pill = screen.getByTestId('song-pill');
    expect(pill).toHaveTextContent('1 · Pop warm-up');
    fireEvent.click(screen.getByRole('button', { name: 'Class card' }));
    const card = await screen.findByTestId('class-card');
    expect(card).toHaveTextContent('Song 1');
    expect(card).toHaveTextContent('0:00–7:00');
    expect(card).toHaveTextContent('120–128 BPM');
    expect(card).toHaveTextContent('Pop warm-up');
  });

  it('pins a track to a song and a separate one to the cool-down', async () => {
    await openEditor();
    select(0);
    fireEvent.click(screen.getByTestId('song-add'));
    const panel = await screen.findByTestId('song-panel');
    fireEvent.change(within(panel).getByTestId('song-track-url'), { target: { value: YT_URL } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Pin track' }));
    await waitFor(() => expect(screen.getByTestId('song-pill')).toHaveTextContent('Cool Song'));

    fireEvent.click(screen.getByTestId('cooldown-add'));
    const cd = await screen.findByTestId('cooldown-panel');
    fireEvent.change(within(cd).getByTestId('cooldown-track-url'), { target: { value: YT_URL } });
    fireEvent.click(within(cd).getByRole('button', { name: 'Pin track' }));
    await waitFor(() => expect(screen.getByTestId('cooldown-pill')).toHaveTextContent('Cool Song'));
    fireEvent.click(within(cd).getByRole('button', { name: 'Remove track' }));
    expect(await screen.findByTestId('cooldown-add')).toBeInTheDocument();
  });

  it('rejects a bad BPM range and keeps the song unchanged', async () => {
    await openEditor();
    select(1);
    fireEvent.click(screen.getByTestId('song-add'));
    const panel = await screen.findByTestId('song-panel');
    fireEvent.change(within(panel).getByTestId('song-bpm-min'), { target: { value: '140' } });
    fireEvent.change(within(panel).getByTestId('song-bpm-max'), { target: { value: '120' } });
    fireEvent.blur(within(panel).getByTestId('song-bpm-max'));
    expect(within(panel).getByRole('alert')).toHaveTextContent('from 40 to');
    fireEvent.click(within(panel).getByRole('button', { name: 'Remove song' }));
    await waitFor(() => expect(screen.queryByTestId('song-pill')).not.toBeInTheDocument());
  });
});

describe('song finder (M19d)', () => {
  const hit = (title: string, bpm: number) => ({
    title,
    artist: 'Band',
    bpm,
    url: `https://www.deezer.com/track/${bpm}`,
  });
  const find = async (searchSongs: () => Promise<ReturnType<typeof hit>[]>) => {
    setDeezerClientForTests({ searchSongs, lookupBpm: () => Promise.resolve(undefined) });
    await openEditor();
    select(0);
    fireEvent.click(screen.getByTestId('song-add'));
    const panel = await screen.findByTestId('song-panel');
    fireEvent.change(within(panel).getByTestId('finder-artist'), { target: { value: 'Band' } });
    fireEvent.change(within(panel).getByTestId('finder-title'), { target: { value: 'One' } });
    return panel;
  };

  it('searches and fills hint and the empty tempo range from the picked song', async () => {
    const searchSongs = vi.fn(() => Promise.resolve([hit('Fast One', 172), hit('Slow One', 86)]));
    const panel = await find(searchSongs);
    fireEvent.click(within(panel).getByTestId('finder-search'));
    const list = await within(panel).findByTestId('finder-results');
    expect(searchSongs).toHaveBeenCalledWith({ title: 'One', artist: 'Band' });
    expect(list).toHaveTextContent('172 BPM · Deezer');
    fireEvent.click(within(panel).getAllByTestId('finder-pick')[0] as HTMLElement);
    expect(within(panel).getByTestId('song-hint')).toHaveValue('Band – Fast One');
    expect(within(panel).getByTestId('song-bpm-min')).toHaveValue('172');
    expect(within(panel).getByTestId('song-bpm-max')).toHaveValue('172');
    expect(screen.getByTestId('song-pill')).toHaveTextContent('Band – Fast One');
  });

  it('marks hits that fit a typed range, also as half time, and keeps that range on pick', async () => {
    const panel = await find(() => Promise.resolve([hit('Fast One', 172), hit('Slow One', 86)]));
    fireEvent.change(within(panel).getByTestId('song-bpm-min'), { target: { value: '170' } });
    fireEvent.change(within(panel).getByTestId('song-bpm-max'), { target: { value: '176' } });
    fireEvent.blur(within(panel).getByTestId('song-bpm-max'));
    fireEvent.click(within(panel).getByTestId('finder-search'));
    const list = await within(panel).findByTestId('finder-results');
    expect(list).toHaveTextContent('fits your range');
    expect(list).toHaveTextContent('fits as half time');
    fireEvent.click(within(panel).getAllByTestId('finder-pick')[1] as HTMLElement);
    expect(within(panel).getByTestId('song-bpm-min')).toHaveValue('170');
    expect(within(panel).getByTestId('song-hint')).toHaveValue('Band – Slow One');
  });

  it('says so when nothing is found and shows a provider error', async () => {
    const calls = vi
      .fn<() => Promise<ReturnType<typeof hit>[]>>()
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new GetSongBpmError('network', 'deezer'));
    const panel = await find(calls);
    fireEvent.click(within(panel).getByTestId('finder-search'));
    expect(await within(panel).findByTestId('finder-empty')).toBeInTheDocument();
    fireEvent.click(within(panel).getByTestId('finder-search'));
    expect(await within(panel).findByTestId('finder-error')).toHaveTextContent(
      'Cannot reach Deezer',
    );
  });

  it('offers only Deezer without a GetSongBPM key', async () => {
    const panel = await find(() => Promise.resolve([]));
    const options = within(within(panel).getByTestId('finder-provider')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['All available', 'Deezer']);
  });
});
