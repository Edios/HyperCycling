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
        get: (id: string) => Promise.resolve(structuredClone(db.players.find((x) => x.id === id))),
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
      settings: {
        get: () => Promise.resolve(db.settings),
        put: (v: Settings) => {
          db.settings = v;
          return Promise.resolve();
        },
      },
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

async function addPlayer(name: string, ftp: string) {
  // Submit is disabled while the previous one is still saving.
  await waitFor(() =>
    expect(
      within(screen.getByTestId('add-player-form')).getByRole('button', { name: 'Add' }),
    ).toBeEnabled(),
  );
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
    await addPlayer('Basia', '210');
    expect(await screen.findByText('Basia')).toBeInTheDocument();
    expect(screen.getByText('210')).toBeInTheDocument();
    expect(db.players).toHaveLength(1);
    expect(db.players[0]).toMatchObject({ name: 'Basia', ftp: 210 });
    expect(screen.queryByText('Add your first player')).not.toBeInTheDocument();
  });

  it('computes HRmax from age and stores it', async () => {
    renderScreen();
    await screen.findByText('Add your first player');
    const form = screen.getByTestId('add-player-form');
    setValue(within(form).getByLabelText('Name'), 'Basia');
    setValue(within(form).getByLabelText('FTP (W)'), '210');
    setValue(within(form).getByLabelText('Age (not stored)'), '36');
    fireEvent.click(within(form).getByRole('button', { name: 'Calculate' }));
    expect(within(form).getByLabelText('Max heart rate (bpm)')).toHaveValue(183);
    fireEvent.click(within(form).getByRole('button', { name: 'Add' }));
    await screen.findByText('Basia');
    expect(db.players[0]).toMatchObject({ hrMax: 183 });
    expect(db.players[0]).not.toHaveProperty('age');
  });

  it('a double submit in the same tick stores the player once', async () => {
    renderScreen();
    await screen.findByText('Add your first player');
    const form = screen.getByTestId('add-player-form');
    setValue(within(form).getByLabelText('Name'), 'Basia');
    setValue(within(form).getByLabelText('FTP (W)'), '210');
    const el = form.querySelector('form')!;
    fireEvent.submit(el);
    fireEvent.submit(el);
    await screen.findByText('Basia');
    expect(db.players).toHaveLength(1);
  });

  it('validates name and FTP with translated messages', async () => {
    renderScreen();
    await screen.findByText('Add your first player');
    await addPlayer('Basia', '20');
    expect(await screen.findByText('FTP must be a whole number from 50 to 600')).toBeVisible();
    await addPlayer('Basia', '210.5');
    expect(screen.getByText('FTP must be a whole number from 50 to 600')).toBeVisible();
    await addPlayer('', '200');
    expect(await screen.findByText('Name must be 1 to 24 characters')).toBeVisible();
    await addPlayer('x'.repeat(25), '200');
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
    expect(
      screen.getByRole('button', { name: 'This is me: Ania', pressed: true }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'This is me: Tomek', pressed: false }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'This is me: Tomek' }));
    await waitFor(() => expect(db.players.filter((p) => p.isMe).map((p) => p.id)).toEqual(['b']));
    expect(
      screen.getByRole('button', { name: 'This is me: Ania', pressed: false }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'This is me: Tomek', pressed: true }),
    ).toBeInTheDocument();
  });

  it('notes that watts are hidden when equipment.showsWatts is false', async () => {
    db.settings = {
      ...DEFAULT_SETTINGS,
      equipment: { ...DEFAULT_SETTINGS.equipment, showsWatts: false },
    };
    renderScreen();
    expect(await screen.findByText(/Watts are hidden/)).toBeInTheDocument();
  });

  it('repairs data with more than one me on load', async () => {
    db.players = [
      { id: 'a', name: 'Ania', ftp: 190, isMe: true },
      { id: 'b', name: 'Tomek', ftp: 310, isMe: true },
    ];
    renderScreen();
    await screen.findByText('Ania');
    await waitFor(() => expect(db.players.filter((p) => p.isMe).map((p) => p.id)).toEqual(['a']));
    expect(screen.getAllByRole('button', { pressed: true, name: /This is me/ })).toHaveLength(1);
  });

  it('editing never writes a stale isMe', async () => {
    db.players = [
      { id: 'a', name: 'Ania', ftp: 190 },
      { id: 'b', name: 'Tomek', ftp: 310 },
    ];
    renderScreen();
    await screen.findByText('Ania');
    fireEvent.click(screen.getByRole('button', { name: 'Edit Ania' }));
    // Another tab makes Ania "me" while the edit form is open.
    db.players[0] = { id: 'a', name: 'Ania', ftp: 190, isMe: true };
    const row = screen.getByTestId('player-edit');
    setValue(within(row).getByLabelText('FTP (W)'), '200');
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(db.players[0]).toMatchObject({ ftp: 200, isMe: true }));
  });

  it('Escape cancels the edit and focus returns to the Edit button', async () => {
    db.players = [{ id: 'a', name: 'Ania', ftp: 190 }];
    renderScreen();
    await screen.findByText('Ania');
    fireEvent.click(screen.getByRole('button', { name: 'Edit Ania' }));
    const row = screen.getByTestId('player-edit');
    await waitFor(() => expect(within(row).getByLabelText('Name')).toHaveFocus());
    fireEvent.keyDown(within(row).getByLabelText('Name'), { key: 'Escape' });
    expect(screen.queryByTestId('player-edit')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Ania' })).toHaveFocus());
  });

  it('limits the name input to 24 characters', async () => {
    renderScreen();
    await screen.findByText('Add your first player');
    expect(within(screen.getByTestId('add-player-form')).getByLabelText('Name')).toHaveAttribute(
      'maxlength',
      '24',
    );
  });

  it('deleting a player prunes it from the last session', async () => {
    db.players = [
      { id: 'a', name: 'Ania', ftp: 190 },
      { id: 'b', name: 'Tomek', ftp: 310 },
    ];
    db.settings = {
      ...DEFAULT_SETTINGS,
      lastSession: { background: 'basic', hud: 'solo', playerIds: ['a', 'b'], music: false },
    };
    renderScreen();
    await screen.findByText('Ania');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete Ania' })).toBeEnabled());
    // Wait for settings to load into the store before deleting.
    await waitFor(() => expect(db.settings?.lastSession?.playerIds).toEqual(['a', 'b']));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Ania' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(db.settings?.lastSession?.playerIds).toEqual(['b']));
  });
});
