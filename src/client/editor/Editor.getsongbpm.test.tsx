import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
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
import { GetSongBpmError } from '../music/getsongbpm/client';
import { setDeezerClientForTests } from '../music/bpmLookup';
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
  // The real Deezer client loads <script> tags; here it knows no song unless a test says otherwise.
  setDeezerClientForTests({
    searchSongs: () => Promise.resolve([]),
    lookupBpm: () => Promise.resolve(undefined),
  });
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

describe('Deezer lookup without a key', () => {
  it('fills the tempo, shows the source and attribution, and the value stays editable', async () => {
    mockYoutube();
    const lookupBpm = vi.fn(() =>
      Promise.resolve({
        title: 'Master of Puppets',
        artist: 'Metallica',
        bpm: 212,
        url: 'https://www.deezer.com/track/1',
      }),
    );
    setDeezerClientForTests({ searchSongs: () => Promise.resolve([]), lookupBpm });
    const bpm = await pinTrack();
    fireEvent.click(await screen.findByTestId('bpm-fetch'));
    await waitFor(() => expect(bpm).toHaveValue('212'));
    expect(lookupBpm).toHaveBeenCalledWith({ title: 'Master of Puppets', artist: 'Metallica' });
    expect(screen.getByTestId('bpm-source')).toHaveTextContent('Source: Deezer');
    const link = within(screen.getByTestId('bpm-attribution-deezer')).getByRole('link', {
      name: /Deezer/,
    });
    expect(link).toHaveAttribute('href', 'https://www.deezer.com');
    expect(await stored()).toMatchObject({ bpm: 212, bpmSource: 'deezer' });
    fireEvent.change(bpm, { target: { value: '106' } });
    fireEvent.blur(bpm);
    await waitFor(() => expect(screen.queryByTestId('bpm-source')).not.toBeInTheDocument());
    expect((await stored())?.bpmSource).toBeUndefined();
  });

  it('says so when Deezer has no tempo and leaves the field alone', async () => {
    mockYoutube();
    const bpm = await pinTrack();
    fireEvent.click(await screen.findByTestId('bpm-fetch'));
    expect(await screen.findByTestId('bpm-fetch-notfound')).toBeInTheDocument();
    expect(bpm).toHaveValue('');
  });

  it('names Deezer when it cannot be reached', async () => {
    mockYoutube();
    setDeezerClientForTests({
      searchSongs: () => Promise.resolve([]),
      lookupBpm: () => Promise.reject(new GetSongBpmError('network', 'deezer')),
    });
    await pinTrack();
    fireEvent.click(await screen.findByTestId('bpm-fetch'));
    expect(await screen.findByTestId('bpm-fetch-error')).toHaveTextContent('Cannot reach Deezer');
  });

  it('offers no song suggestions, only a pointer to Settings', async () => {
    mockYoutube();
    await pinTrack();
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
    const link = within(screen.getByTestId('bpm-attribution-getsongbpm')).getByRole('link', {
      name: /GetSongBPM/,
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
    [403, 'refused the key'],
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

describe('GetSongBPM lookup: races and a11y', () => {
  beforeEach(() => {
    repo.settings = withKey;
    mockYoutube();
  });

  it('N2: a value typed while the lookup is pending is not overwritten', async () => {
    server.use(
      http.get('https://api.getsong.co/search/', async () => {
        await delay(150);
        return HttpResponse.json({ search: [SEARCH_HIT] });
      }),
    );
    const bpm = await pinTrack();
    fireEvent.click(await screen.findByTestId('bpm-fetch'));
    fireEvent.change(bpm, { target: { value: '176' } });
    fireEvent.blur(bpm);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(bpm).toHaveValue('176');
    expect(screen.queryByTestId('bpm-source')).not.toBeInTheDocument();
    expect((await stored())?.bpm).toBe(176);
  });

  it('N1: results are announced through a polite live region', async () => {
    server.use(
      http.get('https://api.getsong.co/search/', () =>
        HttpResponse.json({ search: { error: 'no result' } }),
      ),
    );
    await pinTrack();
    const region = screen.getByTestId('bpm-status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    fireEvent.click(await screen.findByTestId('bpm-fetch'));
    await waitFor(() =>
      expect(within(region).getByTestId('bpm-fetch-notfound')).toBeInTheDocument(),
    );
  });

  it('N1: suggestions are cleared when the cadence changes', async () => {
    server.use(
      http.get('https://api.getsong.co/tempo/', () =>
        HttpResponse.json({
          tempo: [
            {
              song_id: 'a',
              song_title: 'Song A',
              song_uri: 'https://getsongbpm.com/song/a/a',
              tempo: '180',
            },
          ],
        }),
      ),
    );
    await openEditor();
    fireEvent.click(await screen.findByTestId('bpm-suggest'));
    const list = await screen.findByTestId('bpm-suggestions');
    expect(within(list).getAllByRole('link', { name: /opens in a new tab/ })).not.toHaveLength(0);
    const rpm = screen.getByTestId('block-rpm');
    fireEvent.change(rpm, { target: { value: '70' } });
    fireEvent.blur(rpm);
    await waitFor(() => expect(screen.queryByTestId('bpm-suggestions')).not.toBeInTheDocument());
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
    expect(within(list).getByRole('link', { name: /Song x180/ })).toHaveAttribute(
      'href',
      'https://getsongbpm.com/song/song-x180/x180',
    );
    expect(within(list).queryByText('Song bad')).not.toBeInTheDocument();
    expect(screen.getByTestId('bpm-attribution-getsongbpm')).toBeInTheDocument();
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
