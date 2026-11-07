// jsdom's default address is http://localhost:3000/, which is exactly the case to warn about.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
import { resetSharedSpotifyProviderForTests } from '../music/spotify/shared';
import { loopbackUrl } from './MusicSection';
import { SettingsScreen } from './SettingsScreen';

function renderScreen() {
  return render(
    <MemoryRouter>
      <SettingsScreen />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  repo.settings = undefined;
  resetSettingsForTests();
  resetSharedSpotifyProviderForTests();
});

describe('Settings, Music section on localhost', () => {
  it('warns that Spotify rejects localhost, links to 127.0.0.1 and disables Connect', async () => {
    renderScreen();
    const warning = await screen.findByTestId('localhost-warning');
    expect(warning).toHaveTextContent('does not accept "localhost"');
    const href = screen.getByTestId('loopback-link').getAttribute('href');
    expect(href).toBe(`http://127.0.0.1:${location.port}${location.pathname}${location.hash}`);
    expect(screen.getByTestId('spotify-connect')).toBeDisabled();
  });

  it('lists the redirect URIs with copy buttons, plus the Premium and user notes', async () => {
    renderScreen();
    await screen.findByTestId('settings-music');
    const uris = screen.getAllByTestId('redirect-uri').map((n) => n.textContent);
    expect(uris).toEqual([
      `${location.origin}${import.meta.env.BASE_URL}`,
      'http://127.0.0.1:5175/',
      'https://hypercycling.app/',
    ]);
    expect(screen.getAllByRole('button', { name: /^Copy/ })).toHaveLength(3);
    expect(screen.getByText(/User Management/)).toBeInTheDocument();
    expect(screen.getByText(/Spotify Premium/)).toBeInTheDocument();
    expect(screen.getByText(/No client secret is needed/, { selector: 'li' })).toBeInTheDocument();
  });

  it('copies a URI to the clipboard', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderScreen();
    await screen.findByTestId('settings-music');
    fireEvent.click(screen.getAllByRole('button', { name: /^Copy/ })[1] as HTMLElement);
    expect(writeText).toHaveBeenCalledWith('http://127.0.0.1:5175/');
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('saves the Client ID and shows the env default as the placeholder', async () => {
    vi.stubEnv('VITE_SPOTIFY_CLIENT_ID', 'envdefault123');
    try {
      renderScreen();
      const input = (await screen.findByTestId('spotify-client-id')) as HTMLInputElement;
      expect(input.placeholder).toContain('envdefault123');
      fireEvent.change(input, { target: { value: ' myclientid ' } });
      fireEvent.blur(input);
      await waitFor(() => expect(repo.settings?.spotify?.clientId).toBe('myclientid'));
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('keeps the tokens out of view and lets the user disconnect', async () => {
    repo.settings = {
      ...DEFAULT_SETTINGS,
      spotify: { clientId: 'cid', accessToken: 'AT', refreshToken: 'RT', deviceId: 'D1' },
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ devices: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    try {
      renderScreen();
      expect(await screen.findByTestId('spotify-status')).toHaveTextContent('Connected');
      expect(document.body.textContent).not.toContain('AT');
      fireEvent.click(screen.getByTestId('spotify-disconnect'));
      await waitFor(() =>
        expect(screen.getByTestId('spotify-status')).toHaveTextContent('Not connected'),
      );
      expect(repo.settings?.spotify?.refreshToken).toBeUndefined();
      expect(repo.settings?.spotify?.clientId).toBe('cid');
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('Settings, Deezer lookup', () => {
  it('is off by default, explains the script it loads, and persists the choice', async () => {
    renderScreen();
    const toggle = (await screen.findByRole('switch', {
      name: /Deezer tempo lookup/,
    })) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(screen.getByTestId('deezer-lookup-hint')).toHaveTextContent(
      'Loads a script from api.deezer.com; off by default',
    );
    fireEvent.click(toggle);
    await waitFor(() => expect(repo.settings?.deezerLookup).toBe(true));
    fireEvent.click(toggle);
    await waitFor(() => expect(repo.settings?.deezerLookup).toBe(false));
  });
});

describe('Settings, GetSongBPM key', () => {
  it('saves the key on blur, hides it, credits the service, and clears it when emptied', async () => {
    renderScreen();
    const input = (await screen.findByTestId('getsongbpm-key')) as HTMLInputElement;
    expect(input.type).toBe('password');
    fireEvent.change(input, { target: { value: '  abc123  ' } });
    fireEvent.blur(input);
    await waitFor(() => expect(repo.settings?.getSongBpmKey).toBe('abc123'));
    const link = screen.getByRole('link', { name: 'Data: GetSongBPM' });
    expect(link).toHaveAttribute('href', 'https://getsongbpm.com');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    await waitFor(() => expect(repo.settings?.getSongBpmKey).toBeUndefined());
  });
});

describe('loopbackUrl', () => {
  it('keeps port, path, query and hash', () => {
    expect(
      loopbackUrl({
        protocol: 'http:',
        port: '5175',
        pathname: '/',
        search: '?dev',
        hash: '#/settings',
      }),
    ).toBe('http://127.0.0.1:5175/?dev#/settings');
  });

  it('omits an empty port', () => {
    expect(
      loopbackUrl({ protocol: 'https:', port: '', pathname: '/x/', search: '', hash: '' }),
    ).toBe('https://127.0.0.1/x/');
  });
});
