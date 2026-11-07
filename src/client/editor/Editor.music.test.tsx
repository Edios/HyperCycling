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
import { resetSharedSpotifyProviderForTests } from '../music/spotify/shared';
import { EditorScreen } from './EditorScreen';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
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
  fireEvent.click(screen.getAllByTestId('editor-block')[1] as HTMLElement);
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

describe('YouTube embed check', () => {
  function oembed(status: number, body?: unknown) {
    server.use(
      http.get('https://www.youtube.com/oembed', () =>
        body === undefined
          ? new HttpResponse(null, { status })
          : HttpResponse.json(body as Record<string, unknown>, { status }),
      ),
    );
  }

  it('fills in the title and author of an embeddable video', async () => {
    oembed(200, { title: 'Great Song', author_name: 'The Band' });
    await openEditor();
    fireEvent.change(screen.getByTestId('track-url'), { target: { value: YT_URL } });
    fireEvent.click(screen.getByRole('button', { name: 'Pin track' }));
    await waitFor(() => expect(screen.getByTestId('music-pill')).toHaveTextContent('Great Song'));
    expect(screen.queryByTestId('track-not-embeddable')).not.toBeInTheDocument();
  });

  it('marks a video that cannot be embedded and warns, keeping the pin', async () => {
    oembed(401);
    await openEditor();
    fireEvent.change(screen.getByTestId('track-url'), { target: { value: YT_URL } });
    fireEvent.click(screen.getByRole('button', { name: 'Pin track' }));
    const warning = await screen.findByTestId('track-not-embeddable');
    expect(warning).toHaveTextContent('cannot be embedded');
    expect(screen.getByTestId('music-pill')).toHaveTextContent('⚠');
  });

  it('says so when the video is missing', async () => {
    oembed(404);
    await openEditor();
    fireEvent.change(screen.getByTestId('track-url'), { target: { value: YT_URL } });
    fireEvent.click(screen.getByRole('button', { name: 'Pin track' }));
    expect(await screen.findByTestId('track-not-embeddable')).toHaveTextContent(
      'private or removed',
    );
  });

  it('clears the mark when the video embeds on a later check', async () => {
    oembed(401);
    await openEditor();
    fireEvent.change(screen.getByTestId('track-url'), { target: { value: YT_URL } });
    fireEvent.click(screen.getByRole('button', { name: 'Pin track' }));
    await screen.findByTestId('track-not-embeddable');
    oembed(200, { title: 'Back again', author_name: 'X' });
    fireEvent.click(screen.getByRole('button', { name: 'Pin track' }));
    await waitFor(() =>
      expect(screen.queryByTestId('track-not-embeddable')).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId('music-pill')).not.toHaveTextContent('⚠');
  });

  it('marks nothing when YouTube cannot be reached', async () => {
    server.use(http.get('https://www.youtube.com/oembed', () => HttpResponse.error()));
    await openEditor();
    fireEvent.change(screen.getByTestId('track-url'), { target: { value: YT_URL } });
    fireEvent.click(screen.getByRole('button', { name: 'Pin track' }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.getByTestId('music-pill')).toHaveTextContent('♫');
    expect(screen.queryByTestId('track-not-embeddable')).not.toBeInTheDocument();
  });

  it('marks a blocked video added to the fallback playlist', async () => {
    oembed(401);
    await openEditor();
    fireEvent.change(screen.getByTestId('fallback-url'), { target: { value: YT_URL } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    const item = await screen.findByTestId('fallback-track');
    await waitFor(() => expect(item).toHaveTextContent('not embeddable'));
  });
});

describe('Spotify search', () => {
  const connected: Settings = {
    ...DEFAULT_SETTINGS,
    spotify: {
      clientId: 'cid',
      accessToken: 'AT',
      refreshToken: 'RT',
      expiresAt: Date.now() + 3_600_000,
    },
  };

  const items = Array.from({ length: 12 }, (_, i) => ({
    id: `track${String(i).padStart(2, '0')}abcdefghij`,
    name: `Song ${i + 1}`,
    duration_ms: 200_000,
    artists: [{ name: 'Artist A' }, { name: 'Artist B' }],
  }));

  it('hints at Settings while Spotify is not connected', async () => {
    await openEditor();
    expect(screen.queryByTestId('spotify-search')).not.toBeInTheDocument();
    expect(screen.getByTestId('spotify-search-hint')).toHaveTextContent('Connect Spotify');
  });

  it('shows at most 10 results and pins the chosen one', async () => {
    repo.settings = connected;
    let query: URLSearchParams | undefined;
    server.use(
      http.get('https://api.spotify.com/v1/search', ({ request }) => {
        query = new URL(request.url).searchParams;
        // A misbehaving answer with more than the requested limit must still show 10 at most.
        return HttpResponse.json({ tracks: { items } });
      }),
    );
    await openEditor();
    const input = await screen.findByTestId('spotify-query');
    fireEvent.change(input, { target: { value: 'song' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    const results = await screen.findAllByTestId('spotify-result');
    expect(results).toHaveLength(10);
    expect(query?.get('limit')).toBe('10');
    expect(query?.get('type')).toBe('track');
    expect(results[0]).toHaveTextContent('Song 1 · Artist A, Artist B');

    fireEvent.click(within(results[2] as HTMLElement).getByRole('button'));
    expect(screen.getByTestId('music-pill')).toHaveTextContent('Song 3 · Spotify');
    expect(screen.getByTestId('track-pinned')).toHaveTextContent('Song 3');
  });

  it('shows a localized message when Spotify has no answer for the user', async () => {
    repo.settings = connected;
    server.use(
      http.get('https://api.spotify.com/v1/search', () =>
        HttpResponse.json({ error: { status: 403, reason: 'PREMIUM_REQUIRED' } }, { status: 403 }),
      ),
    );
    await openEditor();
    const input = await screen.findByTestId('spotify-query');
    fireEvent.change(input, { target: { value: 'song' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Premium');
  });

  it('says when nothing matches', async () => {
    repo.settings = connected;
    server.use(
      http.get('https://api.spotify.com/v1/search', () =>
        HttpResponse.json({ tracks: { items: [] } }),
      ),
    );
    await openEditor();
    fireEvent.change(await screen.findByTestId('spotify-query'), { target: { value: 'zzz' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('No tracks found.')).toBeInTheDocument();
  });
});

describe('Spotify pasted link', () => {
  const SP_ID = '4uLU6hMCjMI75M1A2tKUQC';
  const SP_URL = `https://open.spotify.com/track/${SP_ID}`;
  const connected: Settings = {
    ...DEFAULT_SETTINGS,
    spotify: {
      clientId: 'cid',
      accessToken: 'AT',
      refreshToken: 'RT',
      expiresAt: Date.now() + 3_600_000,
    },
  };
  const oembed = (status: number, body?: unknown) =>
    server.use(
      http.get('https://open.spotify.com/oembed', () =>
        body === undefined
          ? new HttpResponse(null, { status })
          : HttpResponse.json(body as Record<string, unknown>, { status }),
      ),
    );

  it('fills the title and artist from the Web API when connected', async () => {
    repo.settings = connected;
    server.use(
      http.get(`https://api.spotify.com/v1/tracks/${SP_ID}`, () =>
        HttpResponse.json({ id: SP_ID, name: 'Api Song', artists: [{ name: 'X' }, { name: 'Y' }] }),
      ),
    );
    await openEditor();
    await screen.findByTestId('spotify-query');
    fireEvent.change(screen.getByTestId('track-url'), { target: { value: SP_URL } });
    fireEvent.click(screen.getByRole('button', { name: 'Pin track' }));
    await waitFor(() => expect(screen.getByTestId('music-pill')).toHaveTextContent('Api Song'));
    expect(screen.getByTestId('track-pinned')).toHaveTextContent('Api Song');
  });

  it('falls back to oEmbed when not connected', async () => {
    oembed(200, { title: 'Embed Song' });
    await openEditor();
    fireEvent.change(screen.getByTestId('track-url'), { target: { value: SP_URL } });
    fireEvent.click(screen.getByRole('button', { name: 'Pin track' }));
    await waitFor(() => expect(screen.getByTestId('music-pill')).toHaveTextContent('Embed Song'));
  });

  it('falls back to oEmbed when the Web API call fails', async () => {
    repo.settings = connected;
    server.use(
      http.get(
        `https://api.spotify.com/v1/tracks/${SP_ID}`,
        () => new HttpResponse(null, { status: 500 }),
      ),
    );
    oembed(200, { title: 'Embed Song' });
    await openEditor();
    await screen.findByTestId('spotify-query');
    fireEvent.change(screen.getByTestId('track-url'), { target: { value: SP_URL } });
    fireEvent.click(screen.getByRole('button', { name: 'Pin track' }));
    await waitFor(() => expect(screen.getByTestId('music-pill')).toHaveTextContent('Embed Song'));
  });

  it('leaves the title empty, without an error, when nothing answers', async () => {
    server.use(http.get('https://open.spotify.com/oembed', () => HttpResponse.error()));
    await openEditor();
    fireEvent.change(screen.getByTestId('track-url'), { target: { value: SP_URL } });
    fireEvent.click(screen.getByRole('button', { name: 'Pin track' }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.getByTestId('music-pill')).toHaveTextContent('♫');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('fills the title of a track added to the fallback playlist', async () => {
    oembed(200, { title: 'Embed Song' });
    await openEditor();
    fireEvent.change(screen.getByTestId('fallback-url'), { target: { value: SP_URL } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    const item = await screen.findByTestId('fallback-track');
    await waitFor(() => expect(item).toHaveTextContent('Embed Song'));
  });
});
