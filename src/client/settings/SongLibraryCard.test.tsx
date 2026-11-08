import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../../domain/settings';

const repo = vi.hoisted(() => ({ settings: undefined as Settings | undefined }));
vi.mock('../data/repositories', () => ({
  getRepositories: () =>
    Promise.resolve({
      settings: {
        get: () => Promise.resolve(repo.settings),
        put: (s: Settings) => {
          repo.settings = s;
          return Promise.resolve();
        },
      },
    }),
}));

import { DEFAULT_SETTINGS } from '../../domain/settings';
import { resetSettingsForTests } from '../data/useSettings';
import { GetSongBpmError } from '../music/getsongbpm/client';
import { setDeezerClientForTests } from '../music/bpmLookup';
import {
  createLibraryStore,
  setLibraryStoreForTests,
  type LibraryStore,
} from '../music/library/library';
import { createTagController, setTagControllerForTests } from '../music/library/tag-controller';
import { SpotifyError } from '../music/spotify/errors';
import { resetSharedSpotifyProviderForTests } from '../music/spotify/shared';
import type { SpotifyProvider } from '../music/spotify/provider';
import { SongLibraryCard } from './SongLibraryCard';

let store: LibraryStore;
const provider = {
  listPlaylists: vi.fn(),
  playlistTracks: vi.fn(),
};

function setup(settings: Partial<Settings>) {
  repo.settings = { ...DEFAULT_SETTINGS, ...settings };
  return render(
    <MemoryRouter>
      <SongLibraryCard />
    </MemoryRouter>,
  );
}

const connected = {
  spotify: { clientId: 'cid', accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 1e7 },
};

beforeEach(() => {
  resetSettingsForTests();
  store = createLibraryStore(undefined);
  setLibraryStoreForTests(store);
  setTagControllerForTests(createTagController(() => store, { paceMs: 0 }));
  resetSharedSpotifyProviderForTests(provider as unknown as SpotifyProvider);
  provider.listPlaylists.mockReset();
  provider.playlistTracks.mockReset();
});
afterEach(() => {
  setLibraryStoreForTests();
  setTagControllerForTests();
  setDeezerClientForTests();
  resetSharedSpotifyProviderForTests();
});

describe('SongLibraryCard', () => {
  it('asks to connect Spotify first', async () => {
    setup({});
    expect(await screen.findByTestId('library-connect-hint')).toBeInTheDocument();
  });

  it('imports a chosen playlist into the local library without tagging it yet', async () => {
    provider.listPlaylists.mockResolvedValue([{ id: 'p1', name: 'Climb', total: 2 }]);
    provider.playlistTracks.mockResolvedValue([
      { id: 'a1', title: 'One', artist: 'X' },
      { id: 'b2', title: 'Two' },
    ]);
    setup(connected);
    fireEvent.click(await screen.findByRole('button', { name: 'Load my playlists' }));
    await screen.findByTestId('library-playlist');
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(screen.getAllByTestId('library-track')).toHaveLength(2));
    expect(provider.playlistTracks).toHaveBeenCalledWith('p1');
    expect(screen.getByTestId('library-message')).toHaveTextContent('Added 2 of 2 songs.');
    expect(store.get().every((t) => t.bpm === undefined)).toBe(true);
  });

  it('explains a missing playlist permission', async () => {
    provider.listPlaylists.mockRejectedValue(new SpotifyError('forbidden', { status: 403 }));
    setup(connected);
    fireEvent.click(await screen.findByRole('button', { name: 'Load my playlists' }));
    await waitFor(() =>
      expect(screen.getByTestId('library-message')).toHaveTextContent('connect it again'),
    );
  });

  it('tags in the background through Deezer only when the rider turned it on', async () => {
    store.set([{ id: 'a1', title: 'One', artist: 'X' }]);
    const deezer = {
      lookupBpm: vi
        .fn()
        .mockResolvedValue({ title: 'One', bpm: 128, url: 'https://www.deezer.com/x' }),
      searchSongs: vi.fn(),
    };
    setDeezerClientForTests(deezer);
    setup({ ...connected, deezerLookup: false });
    expect(await screen.findByTestId('library-no-provider')).toBeInTheDocument();
    expect(screen.getByTestId('library-tag')).toBeDisabled();
    expect(deezer.lookupBpm).not.toHaveBeenCalled();
  });

  it('shows progress, source and a stop with a reason, then resumes', async () => {
    store.set([
      { id: 'a1', title: 'One', artist: 'X' },
      { id: 'b2', title: 'Two', artist: 'Y' },
    ]);
    const deezer = {
      lookupBpm: vi
        .fn()
        .mockResolvedValueOnce({ title: 'One', bpm: 128, url: 'https://www.deezer.com/x' })
        .mockRejectedValueOnce(new GetSongBpmError('rate-limited', 'deezer'))
        .mockResolvedValue({ title: 'Two', bpm: 90, url: 'https://www.deezer.com/y' }),
      searchSongs: vi.fn(),
    };
    setDeezerClientForTests(deezer);
    setup({ ...connected, deezerLookup: true });
    const tag = await screen.findByTestId('library-tag');
    await waitFor(() => expect(tag).toBeEnabled());
    fireEvent.click(tag);
    await screen.findByTestId('library-stopped');
    expect(screen.getByTestId('library-stopped')).toHaveTextContent('Tagging stopped');
    expect(screen.getByTestId('library-progress')).toHaveTextContent('1 / 2');
    expect(screen.getAllByTestId('library-source')[0]).toHaveTextContent('Deezer');
    // Resume: only the song that is left is asked.
    await act(async () => {
      fireEvent.click(screen.getByTestId('library-tag'));
    });
    await waitFor(() =>
      expect(screen.getAllByTestId('library-source')[1]).toHaveTextContent('Deezer'),
    );
    expect(deezer.lookupBpm).toHaveBeenCalledTimes(3);
    expect(store.get().map((t) => t.bpm)).toEqual([128, 90]);
  });

  it('lets the rider correct a tempo by hand: it wins and is marked as typed', async () => {
    store.set([{ id: 'a1', title: 'One', bpm: 128, bpmSource: 'deezer', taggedAt: Date.now() }]);
    setup(connected);
    const input = await screen.findByTestId('library-bpm');
    fireEvent.change(input, { target: { value: '126' } });
    fireEvent.blur(input);
    expect(store.get()[0]).toMatchObject({ bpm: 126, bpmSource: 'manual' });
    expect(await screen.findByTestId('library-source')).toHaveTextContent('typed by you');
    // Nonsense is ignored.
    const again = screen.getByTestId('library-bpm');
    fireEvent.change(again, { target: { value: '9999' } });
    fireEvent.blur(again);
    expect(store.get()[0]?.bpm).toBe(126);
  });
});
