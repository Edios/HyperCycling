import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../../domain/settings';
import type { CatalogTrack } from '../../domain/soundtrack-catalog';

vi.mock('../data/repositories', () => ({
  getRepositories: () =>
    Promise.resolve({
      workouts: { list: () => Promise.resolve([]) },
      settings: {
        get: () => Promise.resolve({ ...DEFAULT_SETTINGS } as Settings),
        put: () => Promise.resolve(),
      },
    }),
}));

const catalog = vi.hoisted(() => ({
  load: undefined as unknown as () => Promise<readonly CatalogTrack[]>,
  calls: 0,
}));
vi.mock('../data/soundtrack-catalog', () => ({
  loadSoundtrackCatalog: () => {
    catalog.calls += 1;
    return catalog.load();
  },
}));

import { resetSettingsForTests } from '../data/useSettings';
import { setLang } from '../i18n';
import { resetSoundtrackSessionForTests } from './session';
import { SoundtrackWizard } from './SoundtrackWizard';

function renderWizard() {
  return render(
    <MemoryRouter initialEntries={['/soundtrack/class-endurance-45?from=select']}>
      <Routes>
        <Route path="/soundtrack/:workoutId" element={<SoundtrackWizard />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  catalog.calls = 0;
  resetSettingsForTests();
  resetSoundtrackSessionForTests();
  setLang('en');
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('the song catalog in the wizard', () => {
  it('waits for the songs, with the next button off', async () => {
    let done: (c: readonly CatalogTrack[]) => void = () => undefined;
    catalog.load = () =>
      new Promise((resolve) => {
        done = resolve;
      });
    renderWizard();
    expect(await screen.findByText('Loading songs…')).toBeInTheDocument();
    expect(screen.getByTestId('soundtrack-next')).toBeDisabled();
    done([]);
    await waitFor(() => expect(screen.queryByText('Loading songs…')).not.toBeInTheDocument());
    expect(screen.getByTestId('soundtrack-next')).toBeEnabled();
  });

  it('says so when the songs cannot be loaded, and loads them again on a retry', async () => {
    catalog.load = () => Promise.reject(new Error('offline'));
    renderWizard();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the song catalog.');
    expect(screen.getByTestId('soundtrack-next')).toBeDisabled();
    catalog.load = () => Promise.resolve([]);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(catalog.calls).toBe(2);
    expect(screen.getByTestId('soundtrack-next')).toBeEnabled();
  });

  it('plans nothing with no songs and says what is missing, instead of crashing', async () => {
    catalog.load = () => Promise.resolve([]);
    renderWizard();
    await waitFor(() => expect(screen.getByTestId('soundtrack-next')).toBeEnabled());
    expect(screen.getByTestId('soundtrack-hint')).toHaveTextContent(
      'No kind has songs at this tempo',
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Short gaps ok' }));
    fireEvent.click(screen.getByTestId('soundtrack-next'));
    await screen.findByRole('heading', { name: 'We suggest these songs' });
    expect(screen.getByTestId('soundtrack-warnings')).toHaveTextContent('Silence in');
    expect(screen.getAllByText(/No song fits here/).length).toBeGreaterThan(0);
  });
});
