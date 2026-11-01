import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../../domain/settings';

const db = vi.hoisted(() => ({ settings: undefined as Settings | undefined, failSave: false }));
const saved: Settings[] = [];

vi.mock('../data/repositories', () => ({
  getRepositories: () =>
    Promise.resolve({
      workouts: { list: () => Promise.resolve([]) },
      activeSession: { clear: () => Promise.resolve() },
      settings: {
        get: () => Promise.resolve(db.settings),
        put: (s: Settings) => {
          if (db.failSave) return Promise.reject(new Error('disk'));
          saved.push(s);
          return Promise.resolve();
        },
      },
      players: { list: () => Promise.resolve([]), put: () => Promise.resolve() },
      planProgress: { get: () => Promise.resolve(undefined) },
    }),
}));

import { builtinWorkouts } from '../data/builtin';
import { resetSettingsForTests } from '../data/useSettings';
import { useSessionStore } from '../training/session-store';
import { SetupScreen } from './SetupScreen';

const workout = builtinWorkouts[0]!;
const GOOD = 'https://youtu.be/dQw4w9WgXcQ?t=1m30s';

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

async function pickYoutube() {
  render(
    <MemoryRouter initialEntries={[`/setup/${workout.id}`]}>
      <Routes>
        <Route path="/setup/:workoutId" element={<SetupScreen />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: /YouTube/ }));
  return screen.getByLabelText('YouTube link');
}

beforeEach(() => {
  db.settings = undefined;
  db.failSave = false;
  saved.length = 0;
  resetSettingsForTests();
  useSessionStore.setState({ runtime: undefined });
});

describe('SetupScreen YouTube background', () => {
  it('validates the link and blocks Start until it is valid', async () => {
    const input = await pickYoutube();
    const start = screen.getByRole('button', { name: 'Start' });
    expect(start).toBeDisabled();
    fireEvent.change(input, { target: { value: 'https://example.com/x' } });
    expect(screen.getByText('This does not look like a YouTube video link.')).toBeInTheDocument();
    expect(start).toBeDisabled();
    fireEvent.change(input, { target: { value: GOOD } });
    expect(screen.queryByText('This does not look like a YouTube video link.')).toBeNull();
    expect(start).toBeEnabled();
  });

  it('starts with the link in the config; recents are deduped and capped at 10', async () => {
    db.settings = {
      ...DEFAULT_SETTINGS,
      recentYoutubeUrls: [
        'https://youtu.be/aaaaaaaaaaa',
        GOOD,
        ...Array.from({ length: 8 }, (_, i) => `https://youtu.be/bbbbbbbbbb${i}`),
      ],
    };
    const input = await pickYoutube();
    fireEvent.change(input, { target: { value: ` ${GOOD} ` } });
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await screen.findByTestId('where');
    expect(useSessionStore.getState().runtime!.config).toMatchObject({
      background: 'youtube',
      hud: 'immersive',
      youtubeUrl: GOOD,
    });
    await waitFor(() => expect(saved.length).toBeGreaterThan(0));
    const recent = saved[saved.length - 1]!.recentYoutubeUrls;
    expect(recent).toHaveLength(10);
    expect(recent[0]).toBe(GOOD);
    expect(recent.filter((u) => u === GOOD)).toHaveLength(1);
  });

  it('clicking a recent link fills the field', async () => {
    db.settings = { ...DEFAULT_SETTINGS, recentYoutubeUrls: [GOOD] };
    const input = await pickYoutube();
    fireEvent.click(screen.getByRole('button', { name: GOOD }));
    expect(input).toHaveValue(GOOD);
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled();
  });

  it('a failed settings save does not stop the session from starting', async () => {
    db.failSave = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const input = await pickYoutube();
    fireEvent.change(input, { target: { value: GOOD } });
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByTestId('where')).toHaveTextContent('/train');
    warn.mockRestore();
  });
});
