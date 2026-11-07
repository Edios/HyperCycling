import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    }),
}));

import { DEFAULT_SETTINGS } from '../../domain/settings';
import { loadSettings, resetSettingsForTests } from '../data/useSettings';
import { setLang } from '../i18n';
import { KnobPrompt } from './KnobPrompt';

function storedWithoutMode(): Settings {
  const s = { ...DEFAULT_SETTINGS };
  delete s.resistanceMode;
  return s;
}

beforeEach(() => {
  setLang('en');
  resetSettingsForTests();
});
afterEach(() => {
  db.settings = undefined;
});

describe('KnobPrompt (one-time question for existing profiles)', () => {
  it('asks a profile stored before stepped effort, and Yes picks the knob', async () => {
    db.settings = storedWithoutMode();
    await loadSettings();
    render(<KnobPrompt />);
    expect(screen.getByRole('dialog')).toHaveTextContent(/manual resistance knob/i);
    fireEvent.click(screen.getByRole('button', { name: 'Yes, manual knob' }));
    await waitFor(() => expect(db.settings?.resistanceMode).toBe('knob'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('No keeps smooth ramps and is remembered', async () => {
    db.settings = storedWithoutMode();
    await loadSettings();
    render(<KnobPrompt />);
    fireEvent.click(screen.getByRole('button', { name: 'No, smart trainer' }));
    await waitFor(() => expect(db.settings?.resistanceMode).toBe('smart'));
  });

  it('does not ask a fresh profile', async () => {
    await loadSettings();
    render(<KnobPrompt />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not ask again once answered', async () => {
    db.settings = { ...DEFAULT_SETTINGS, resistanceMode: 'smart' };
    await loadSettings();
    render(<KnobPrompt />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
