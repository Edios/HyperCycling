import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

import { DEFAULT_SETTINGS } from '../../domain/settings';
import { resetSettingsForTests } from '../data/useSettings';
import { resetGetSongBpmClientForTests } from '../music/getsongbpm/useGetSongBpm';
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
      { kind: 'steady', id: 'c', durationSec: 60, intensity: { effort: 9 }, rpm: 120 },
      { kind: 'steady', id: 'd', durationSec: 60, intensity: { effort: 3 }, rpm: 35 },
    ],
    musicCues: [],
    fallbackPlaylist: [],
    schemaVersion: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

async function openEditor(block = 0) {
  const router = createMemoryRouter(
    [
      { path: '/editor/:workoutId', element: <EditorScreen /> },
      { path: '/settings', element: <div data-testid="settings-page" /> },
    ],
    { initialEntries: ['/editor/user-1'] },
  );
  render(<RouterProvider router={router} />);
  await screen.findByTestId('editor-screen');
  fireEvent.click(screen.getAllByTestId('editor-block')[block] as HTMLElement);
  return router;
}

const YT_URL = 'https://youtu.be/dQw4w9WgXcQ';

beforeEach(() => {
  repo.store.clear();
  repo.store.set('user-1', userWorkout());
  repo.settings = undefined;
  resetSettingsForTests();
  resetGetSongBpmClientForTests();
  try {
    localStorage.clear();
  } catch {
    /* no storage */
  }
  resetSharedSpotifyProviderForTests();
});

const withKey: Settings = { ...DEFAULT_SETTINGS, getSongBpmKey: 'TEST-KEY' };

const SEARCH_HIT = {
  id: 'o2r0L',
  title: 'Master of Puppets',
  uri: 'https://getsongbpm.com/song/master-of-puppets/o2r0L',
  tempo: '180',
  artist: { id: 'nZR', name: 'Metallica' },
};

function mockYoutube(title = 'Metallica - Master of Puppets (Official Video)') {
  server.use(
    http.get('https://www.youtube.com/oembed', () =>
      HttpResponse.json({ title, author_name: 'MetallicaVEVO' }),
    ),
  );
}

async function pinTrack(block = 0) {
  await openEditor(block);
  fireEvent.change(screen.getByTestId('track-url'), { target: { value: YT_URL } });
  fireEvent.click(screen.getByRole('button', { name: 'Pin track' }));
  return screen.findByTestId('track-bpm');
}

const stored = async () => {
  const save = screen.getByRole('button', { name: 'Save' });
  if (!(save as HTMLButtonElement).disabled) fireEvent.click(save);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
  return (repo.store.get('user-1') as Workout).musicCues[0]?.track;
};

describe('GetSongBPM without a key', () => {
  it('offers no lookup, only a pointer to Settings', async () => {
    mockYoutube();
    await pinTrack();
    expect(screen.queryByTestId('bpm-fetch')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bpm-suggest')).not.toBeInTheDocument();
    expect(screen.getByTestId('bpm-needs-key')).toHaveTextContent('API key');
    expect(screen.getByRole('link', { name: 'Add it in Settings' })).toHaveAttribute(
      'href',
      '/settings',
    );
  });
});

describe('GetSongBPM lookup', () => {
  beforeEach(() => {
    repo.settings = withKey;
    mockYoutube();
  });

  it('fills the BPM, shows the source and attribution, and stores both', async () => {
    let lookup: string | null = null;
    let apiKey: string | null = null;
    server.use(
      http.get('https://api.getsong.co/search/', ({ request }) => {
        const u = new URL(request.url);
        lookup = u.searchParams.get('lookup');
        apiKey = u.searchParams.get('api_key');
        return HttpResponse.json({ search: [SEARCH_HIT] });
      }),
    );
    const bpm = await pinTrack();
    fireEvent.click(await screen.findByTestId('bpm-fetch'));
    await waitFor(() => expect(bpm).toHaveValue('180'));
    expect(lookup).toBe('song:Master of Puppets artist:Metallica');
    expect(apiKey).toBe('TEST-KEY');
    expect(screen.getByTestId('bpm-source')).toHaveTextContent('Source: GetSongBPM');
    expect(screen.getByTestId('bpm-match')).toHaveTextContent('Fits the cadence');
    const link = within(screen.getByTestId('bpm-attribution')).getByRole('link', {
      name: 'GetSongBPM',
    });
    expect(link).toHaveAttribute('href', 'https://getsongbpm.com');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(await stored()).toMatchObject({ bpm: 180, bpmSource: 'getsongbpm' });
  });

  it('a manual correction drops the source', async () => {
    server.use(
      http.get('https://api.getsong.co/search/', () => HttpResponse.json({ search: [SEARCH_HIT] })),
    );
    const bpm = await pinTrack();
    fireEvent.click(await screen.findByTestId('bpm-fetch'));
    await waitFor(() => expect(screen.getByTestId('bpm-source')).toBeInTheDocument());
    fireEvent.change(bpm, { target: { value: '176' } });
    fireEvent.blur(bpm);
    await waitFor(() => expect(screen.queryByTestId('bpm-source')).not.toBeInTheDocument());
    const track = await stored();
    expect(track?.bpm).toBe(176);
    expect(track?.bpmSource).toBeUndefined();
  });

  it('says so when the song is unknown and leaves the field alone', async () => {
    server.use(
      http.get('https://api.getsong.co/search/', () =>
        HttpResponse.json({ search: { error: 'no result' } }),
      ),
    );
    const bpm = await pinTrack();
    fireEvent.click(await screen.findByTestId('bpm-fetch'));
    expect(await screen.findByTestId('bpm-fetch-notfound')).toBeInTheDocument();
    expect(bpm).toHaveValue('');
  });

  it.each([
    [401, 'rejected the API key'],
    [429, 'request limit'],
    [500, 'unexpected answer'],
  ])('shows a readable error for HTTP %i', async (status, text) => {
    server.use(http.get('https://api.getsong.co/search/', () => new HttpResponse('', { status })));
    await pinTrack();
    fireEvent.click(await screen.findByTestId('bpm-fetch'));
    expect(await screen.findByTestId('bpm-fetch-error')).toHaveTextContent(text);
  });

  it('shows a network error', async () => {
    server.use(http.get('https://api.getsong.co/search/', () => HttpResponse.error()));
    await pinTrack();
    fireEvent.click(await screen.findByTestId('bpm-fetch'));
    expect(await screen.findByTestId('bpm-fetch-error')).toHaveTextContent('Cannot reach');
  });
});

describe('GetSongBPM suggestions', () => {
  beforeEach(() => {
    repo.settings = withKey;
  });

  const tempoHit = (n: string, bpm: string, uri?: string) => ({
    song_id: n,
    song_title: `Song ${n}`,
    song_uri: uri ?? `https://getsongbpm.com/song/song-${n}/${n}`,
    tempo: bpm,
    artist: { id: 'a', name: `Band ${n}` },
  });

  it('lists songs for 2 x RPM and half time, with links, and credits the source', async () => {
    const asked: string[] = [];
    server.use(
      http.get('https://api.getsong.co/tempo/', ({ request }) => {
        const bpm = new URL(request.url).searchParams.get('bpm') ?? '';
        asked.push(bpm);
        return HttpResponse.json({
          tempo: [tempoHit(`x${bpm}`, bpm), tempoHit('bad', bpm, 'javascript:alert(1)')],
        });
      }),
    );
    await openEditor();
    fireEvent.click(await screen.findByTestId('bpm-suggest'));
    const list = await screen.findByTestId('bpm-suggestions');
    expect(asked).toEqual(['180', '90']);
    expect(list).toHaveTextContent('Song x180');
    expect(list).toHaveTextContent('Band x180');
    expect(list).toHaveTextContent('half time');
    expect(within(list).getByRole('link', { name: 'Song x180' })).toHaveAttribute(
      'href',
      'https://getsongbpm.com/song/song-x180/x180',
    );
    expect(within(list).queryByText('Song bad')).not.toBeInTheDocument();
    expect(screen.getByTestId('bpm-attribution')).toBeInTheDocument();
  });

  it('shows an error when the service refuses', async () => {
    server.use(
      http.get('https://api.getsong.co/tempo/', () => new HttpResponse('', { status: 429 })),
    );
    await openEditor();
    fireEvent.click(await screen.findByTestId('bpm-suggest'));
    expect(await screen.findByTestId('bpm-suggest-error')).toHaveTextContent('request limit');
  });

  it('is not offered for a block without a cadence', async () => {
    await openEditor(1);
    expect(screen.queryByTestId('bpm-suggest')).not.toBeInTheDocument();
  });
});
