// @vitest-environment-options {"url": "http://127.0.0.1:5175/"}
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { SettingsScreen } from './SettingsScreen';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const connected: Settings = {
  ...DEFAULT_SETTINGS,
  spotify: {
    clientId: 'cid',
    accessToken: 'AT',
    refreshToken: 'RT',
    expiresAt: Date.now() + 3_600_000,
  },
};

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

describe('Settings, Music section on 127.0.0.1', () => {
  it('has no localhost warning, registers this page once and enables Connect', async () => {
    renderScreen();
    await screen.findByTestId('settings-music');
    expect(screen.queryByTestId('localhost-warning')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('redirect-uri').map((n) => n.textContent)).toEqual([
      'http://127.0.0.1:5175/',
      'https://edios.github.io/Spinning-Tutor/',
    ]);
    expect(screen.getByTestId('spotify-connect')).toBeEnabled();
  });

  it('asks for a Client ID before connecting', async () => {
    renderScreen();
    fireEvent.click(await screen.findByTestId('spotify-connect'));
    expect(await screen.findByTestId('music-message')).toHaveTextContent('Enter the Client ID');
  });

  it('lists the playback devices and stores the chosen one', async () => {
    repo.settings = connected;
    server.use(
      http.get('https://api.spotify.com/v1/me/player/devices', () =>
        HttpResponse.json({
          devices: [
            { id: 'D1', name: 'Kitchen speaker', type: 'Speaker', is_active: false },
            { id: 'D2', name: 'My PC', type: 'Computer', is_active: true },
          ],
        }),
      ),
    );
    renderScreen();
    const select = (await screen.findByTestId('spotify-device')) as HTMLSelectElement;
    await waitFor(() => expect(select.options).toHaveLength(3));
    expect(select.options[2]?.textContent).toBe('My PC (Computer) · active');
    fireEvent.change(select, { target: { value: 'D1' } });
    await waitFor(() => expect(repo.settings?.spotify?.deviceId).toBe('D1'));
    fireEvent.change(select, { target: { value: '' } });
    await waitFor(() => expect(repo.settings?.spotify?.deviceId).toBeUndefined());
  });

  it('explains an empty device list and a failing request', async () => {
    repo.settings = connected;
    server.use(
      http.get('https://api.spotify.com/v1/me/player/devices', () =>
        HttpResponse.json({ devices: [] }),
      ),
    );
    renderScreen();
    expect(await screen.findByText(/No devices found/)).toBeInTheDocument();

    server.use(
      http.get('https://api.spotify.com/v1/me/player/devices', () =>
        HttpResponse.json({ error: { status: 403, reason: 'PREMIUM_REQUIRED' } }, { status: 403 }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Refresh devices' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Premium');
  });
});
