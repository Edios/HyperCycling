import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Player } from '../../domain/player';
import { DEFAULT_SETTINGS, type Settings } from '../../domain/settings';

const db: { players: Player[]; settings?: Settings } = { players: [] };

vi.mock('../data/repositories', () => ({
  getRepositories: () =>
    Promise.resolve({
      players: {
        list: () => Promise.resolve(structuredClone(db.players)),
        put: (p: Player) => {
          const i = db.players.findIndex((x) => x.id === p.id);
          if (i >= 0) db.players[i] = structuredClone(p);
          else db.players.push(structuredClone(p));
          return Promise.resolve();
        },
        remove: (id: string) => {
          db.players = db.players.filter((x) => x.id !== id);
          return Promise.resolve();
        },
      },
      settings: { get: () => Promise.resolve(db.settings), put: () => Promise.resolve() },
    }),
}));

vi.setConfig({ testTimeout: 20_000 });

import { resetSettingsForTests } from '../data/useSettings';
import { PlayersScreen } from './PlayersScreen';

function renderScreen() {
  return render(
    <MemoryRouter>
      <PlayersScreen />
    </MemoryRouter>,
  );
}

function setValue(el: HTMLElement, value: string) {
  fireEvent.change(el, { target: { value } });
}

function addPlayer(name: string, ftp: string) {
  const form = screen.getByTestId('add-player-form');
  setValue(within(form).getByLabelText('Name'), name);
  setValue(within(form).getByLabelText('FTP (W)'), ftp);
  fireEvent.click(within(form).getByRole('button', { name: 'Add' }));
}

beforeEach(() => {
  db.players = [];
  db.settings = undefined;
  resetSettingsForTests();
});

describe('PlayersScreen', () => {
  it('shows an empty state and the subtitle', async () => {
    renderScreen();
    expect(await screen.findByText('Add your first player')).toBeInTheDocument();
    expect(
      screen.getByText('FTP is used to compute target watts. Update it after a test.'),
    ).toBeInTheDocument();
  });

  it('adds a player and stores it', async () => {
    renderScreen();
    await screen.findByText('Add your first player');
    addPlayer('Basia', '210');
    expect(await screen.findByText('Basia')).toBeInTheDocument();
    expect(screen.getByText('210')).toBeInTheDocument();
    expect(db.players).toHaveLength(1);
    expect(db.players[0]).toMatchObject({ name: 'Basia', ftp: 210 });
    expect(screen.queryByText('Add your first player')).not.toBeInTheDocument();
  });

  it('validates name and FTP with translated messages', async () => {
    renderScreen();
    await screen.findByText('Add your first player');
    addPlayer('Basia', '20');
    expect(await screen.findByText('FTP must be a whole number from 50 to 600')).toBeVisible();
    addPlayer('Basia', '210.5');
    expect(screen.getByText('FTP must be a whole number from 50 to 600')).toBeVisible();
    addPlayer('', '200');
    expect(await screen.findByText('Name must be 1 to 24 characters')).toBeVisible();
    addPlayer('x'.repeat(25), '200');
    expect(screen.getByText('Name must be 1 to 24 characters')).toBeVisible();
    expect(db.players).toHaveLength(0);
  });

  it('edits a player inline', async () => {
    db.players = [{ id: 'a', name: 'Ania', ftp: 190 }];
    renderScreen();
    await screen.findByText('Ania');
    fireEvent.click(screen.getByRole('button', { name: 'Edit Ania' }));
    const row = screen.getByTestId('player-edit');
    setValue(within(row).getByLabelText('Name'), 'Anka');
    setValue(within(row).getByLabelText('FTP (W)'), '250');
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(db.players[0]).toMatchObject({ name: 'Anka', ftp: 250 }));
    expect(await screen.findByText('Anka')).toBeInTheDocument();
    expect(screen.queryByTestId('player-edit')).not.toBeInTheDocument();
  });

  it('rejects invalid edits and cancel keeps the original', async () => {
    db.players = [{ id: 'a', name: 'Ania', ftp: 190 }];
    renderScreen();
    await screen.findByText('Ania');
    fireEvent.click(screen.getByRole('button', { name: 'Edit Ania' }));
    const row = screen.getByTestId('player-edit');
    setValue(within(row).getByLabelText('FTP (W)'), '700');
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('FTP must be a whole number from 50 to 600')).toBeVisible();
    expect(db.players[0]?.ftp).toBe(190);
    fireEvent.click(within(row).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Ania')).toBeInTheDocument();
    expect(screen.getByText('190')).toBeInTheDocument();
  });

  it('deletes after confirmation only', async () => {
    db.players = [
      { id: 'a', name: 'Ania', ftp: 190 },
      { id: 'b', name: 'Tomek', ftp: 310 },
    ];
    renderScreen();
    await screen.findByText('Ania');
    fireEvent.click(screen.getByRole('button', { name: 'Delete Ania' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(db.players).toHaveLength(2);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Ania' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(db.players.map((p) => p.id)).toEqual(['b']));
    await waitFor(() => expect(screen.queryByText('Ania')).not.toBeInTheDocument());
  });

  it('keeps isMe unique: selecting moves it', async () => {
    db.players = [
      { id: 'a', name: 'Ania', ftp: 190, isMe: true },
      { id: 'b', name: 'Tomek', ftp: 310 },
    ];
    renderScreen();
    await screen.findByText('Ania');
    expect(screen.getByRole('radio', { name: 'This is me: Ania' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'This is me: Tomek' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'This is me: Tomek' }));
    await waitFor(() => expect(db.players.filter((p) => p.isMe).map((p) => p.id)).toEqual(['b']));
    expect(screen.getByRole('radio', { name: 'This is me: Ania' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'This is me: Tomek' })).toBeChecked();
  });

  it('notes that watts are hidden when equipment.showsWatts is false', async () => {
    db.settings = {
      ...DEFAULT_SETTINGS,
      equipment: { ...DEFAULT_SETTINGS.equipment, showsWatts: false },
    };
    renderScreen();
    expect(await screen.findByText(/Watts are hidden/)).toBeInTheDocument();
  });
});
