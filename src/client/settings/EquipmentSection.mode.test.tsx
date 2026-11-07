import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../../domain/settings';

const db = vi.hoisted(() => ({ settings: undefined as Settings | undefined }));

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
      players: { list: () => Promise.resolve([]), put: () => Promise.resolve() },
    }),
}));

import { DEFAULT_SETTINGS } from '../../domain/settings';
import { loadSettings, resetSettingsForTests } from '../data/useSettings';
import { setLang } from '../i18n';
import { EquipmentSection } from './EquipmentSection';

beforeEach(() => {
  setLang('en');
  resetSettingsForTests();
});
afterEach(() => {
  db.settings = undefined;
});

describe('resistance mode setting', () => {
  it('shows an old stored profile (no field) as Smooth and saves a new choice', async () => {
    const old = { ...DEFAULT_SETTINGS };
    delete old.resistanceMode;
    db.settings = old;
    await loadSettings();
    render(
      <MemoryRouter>
        <EquipmentSection />
      </MemoryRouter>,
    );
    const group = screen.getByRole('radiogroup', { name: 'Ramps' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Smooth/ })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: /Manual knob/ }));
    await waitFor(() => expect(db.settings?.resistanceMode).toBe('knob'));
  });

  it('a fresh profile starts on the manual knob', async () => {
    await loadSettings();
    render(
      <MemoryRouter>
        <EquipmentSection />
      </MemoryRouter>,
    );
    expect(screen.getByRole('radio', { name: /Manual knob/ })).toBeChecked();
  });
});
