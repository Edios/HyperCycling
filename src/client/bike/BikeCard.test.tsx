import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../../domain/settings';
import type { Player } from '../../domain/player';

const db = vi.hoisted(() => ({
  settings: undefined as Settings | undefined,
  players: [] as Player[],
}));

vi.mock('../data/repositories', () => ({
  getRepositories: () =>
    Promise.resolve({
      settings: {
        get: () => Promise.resolve(db.settings),
        put: (s: Settings) => {
          db.settings = s;
          return Promise.resolve();
        },
      },
      players: {
        list: () => Promise.resolve(db.players),
        put: (p: Player) => {
          db.players = db.players.map((x) => (x.id === p.id ? p : x));
          return Promise.resolve();
        },
      },
    }),
}));

import { DEFAULT_SETTINGS } from '../../domain/settings';
import { loadSettings, resetSettingsForTests } from '../data/useSettings';
import { setLang } from '../i18n';
import { BikeCard } from './BikeCard';

beforeEach(() => {
  setLang('en');
  resetSettingsForTests();
  db.players = [{ id: 'me', name: 'Me', ftp: 150, isMe: true }];
});
afterEach(() => {
  db.settings = undefined;
});

describe('BikeCard', () => {
  it('"Skip and ride" starts at once and is remembered', async () => {
    await loadSettings();
    const onSkipRide = vi.fn();
    render(<BikeCard onSkipRide={onSkipRide} />);
    fireEvent.click(screen.getByTestId('bike-skip-ride'));
    expect(onSkipRide).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(db.settings?.bikeSetupDone).toBe(true));
    await waitFor(() => expect(screen.queryByTestId('bike-card')).toBeNull());
    // nothing else changed
    expect(db.settings?.resistanceMode).toBe(DEFAULT_SETTINGS.resistanceMode);
  });

  it('is not offered again once done', async () => {
    db.settings = { ...DEFAULT_SETTINGS, bikeSetupDone: true };
    await loadSettings();
    render(<BikeCard onSkipRide={() => undefined} />);
    expect(screen.queryByTestId('bike-card')).toBeNull();
  });

  it('wizard: smart trainer takes two screens and saves mode, watts and FTP', async () => {
    await loadSettings();
    render(<BikeCard onSkipRide={() => undefined} />);
    fireEvent.click(screen.getByTestId('bike-open'));
    fireEvent.click(screen.getByTestId('bike-kind-smart'));
    fireEvent.click(screen.getByTestId('bike-next'));
    await waitFor(() => expect(screen.getByTestId('bike-ftp')).toHaveValue('150'));
    fireEvent.change(screen.getByTestId('bike-ftp'), { target: { value: '210' } });
    expect(screen.getByText('Step 2 of 2')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('bike-next'));
    await waitFor(() => expect(db.settings?.bikeSetupDone).toBe(true));
    expect(db.settings?.resistanceMode).toBe('smart');
    expect(db.settings?.equipment.showsWatts).toBe(true);
    expect(db.players[0]?.ftp).toBe(210);
  });

  it('wizard: knob bike gets a third screen; bad steps are refused, good ones saved; FTP can be skipped', async () => {
    await loadSettings();
    render(<BikeCard onSkipRide={() => undefined} />);
    fireEvent.click(screen.getByTestId('bike-open'));
    fireEvent.click(screen.getByTestId('bike-kind-knob'));
    fireEvent.click(screen.getByTestId('bike-next'));
    fireEvent.click(await screen.findByTestId('bike-ftp-unknown'));
    expect(screen.getByText('Step 3 of 3')).toBeInTheDocument();
    const inputs = screen.getByTestId('knob-steps').querySelectorAll('input');
    fireEvent.change(inputs[2]!, { target: { value: '1' } });
    fireEvent.click(screen.getByTestId('bike-next'));
    expect(screen.getByRole('alert')).toHaveTextContent(/five whole numbers/);
    expect(db.settings).toBeUndefined();
    fireEvent.change(inputs[2]!, { target: { value: '6' } });
    fireEvent.click(screen.getByTestId('bike-next'));
    await waitFor(() => expect(db.settings?.knobSteps).toEqual([1, 3, 6, 7, 9]));
    expect(db.settings?.resistanceMode).toBe('knob');
    expect(db.settings?.equipment.showsWatts).toBe(false);
    expect(db.players[0]?.ftp).toBe(150);
  });

  it('wizard: Skip marks it done without changing the bike', async () => {
    await loadSettings();
    render(<BikeCard onSkipRide={() => undefined} />);
    fireEvent.click(screen.getByTestId('bike-open'));
    fireEvent.click(screen.getByTestId('bike-skip'));
    await waitFor(() => expect(db.settings?.bikeSetupDone).toBe(true));
    expect(db.settings?.knobSteps).toBeUndefined();
  });
});
