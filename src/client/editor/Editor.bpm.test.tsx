import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../../domain/settings';
import type { Workout } from '../../domain/workout';

const repo = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  settings: undefined as Settings | undefined,
}));

vi.mock('../data/repositories', () => ({
  getRepositories: () =>
    Promise.resolve({
      workouts: {
        get: (id: string) => Promise.resolve(repo.store.get(id)),
        put: (w: { id: string }) => {
          repo.store.set(w.id, w);
          return Promise.resolve();
        },
        remove: (id: string) => {
          repo.store.delete(id);
          return Promise.resolve();
        },
        list: () => Promise.resolve([...repo.store.values()]),
      },
      settings: {
        get: () => Promise.resolve(repo.settings),
        put: (s: Settings) => {
          repo.settings = s;
          return Promise.resolve();
        },
      },
      activeSession: { get: () => Promise.resolve(undefined) },
    }),
}));

vi.setConfig({ testTimeout: 20_000 });

import { resetSettingsForTests } from '../data/useSettings';
import { resetSharedSpotifyProviderForTests } from '../music/spotify/shared';
import { EditorScreen } from './EditorScreen';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function userWorkout(): Workout {
  return {
    id: 'user-1',
    name: 'My ride',
    description: '',
    category: 'freestyle',
    tags: [],
    source: { kind: 'user' },
    blocks: [
      { kind: 'steady', id: 'a', durationSec: 300, intensity: { effort: 5 }, rpm: 90 },
      { kind: 'steady', id: 'b', durationSec: 120, intensity: { effort: 8 } },
      { kind: 'steady', id: 'c', durationSec: 60, intensity: { effort: 9 }, rpm: 120 },
      { kind: 'steady', id: 'd', durationSec: 60, intensity: { effort: 3 }, rpm: 35 },
    ],
    musicCues: [],
    fallbackPlaylist: [],
    schemaVersion: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

async function openEditor(block = 0) {
  const router = createMemoryRouter(
    [
      { path: '/editor/:workoutId', element: <EditorScreen /> },
      { path: '/settings', element: <div data-testid="settings-page" /> },
    ],
    { initialEntries: ['/editor/user-1'] },
  );
  render(<RouterProvider router={router} />);
  await screen.findByTestId('editor-screen');
  fireEvent.click(screen.getAllByTestId('editor-block')[block] as HTMLElement);
  return router;
}

const YT_URL = 'https://youtu.be/dQw4w9WgXcQ';

beforeEach(() => {
  repo.store.clear();
  repo.store.set('user-1', userWorkout());
  repo.settings = undefined;
  resetSettingsForTests();
  resetSharedSpotifyProviderForTests();
});

describe('BPM matching hint', () => {
  beforeEach(() => {
    server.use(
      http.get('https://www.youtube.com/oembed', () =>
        HttpResponse.json({ title: 'Song', author_name: 'Band' }),
      ),
    );
  });

  async function pinTrack(block = 0) {
    await openEditor(block);
    fireEvent.change(screen.getByTestId('track-url'), { target: { value: YT_URL } });
    fireEvent.click(screen.getByRole('button', { name: 'Pin track' }));
    return screen.findByTestId('track-bpm');
  }
  /** What the workout would be saved with: Save is the only place the repository is written. */
  const stored = async () => {
    const save = screen.getByRole('button', { name: 'Save' });
    if (!(save as HTMLButtonElement).disabled) fireEvent.click(save);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    return (repo.store.get('user-1') as Workout).musicCues[0]?.track.bpm;
  };

  it('tells which tempo to look for before a track is pinned (90 RPM -> 180 BPM)', async () => {
    await openEditor();
    expect(screen.getByTestId('bpm-target')).toHaveTextContent('90 RPM');
    expect(screen.getByTestId('bpm-target')).toHaveTextContent('180 BPM');
    expect(screen.queryByTestId('track-bpm')).not.toBeInTheDocument();
  });

  it('judges a typed BPM against the block cadence', async () => {
    const bpm = await pinTrack();
    fireEvent.change(bpm, { target: { value: '180' } });
    expect(screen.getByTestId('bpm-match')).toHaveTextContent('Fits the cadence');
    fireEvent.change(bpm, { target: { value: '90' } });
    expect(screen.getByTestId('bpm-match')).toHaveTextContent('half time');
    fireEvent.change(bpm, { target: { value: '128' } });
    expect(screen.getByTestId('bpm-nomatch')).toBeInTheDocument();
  });

  it('does not announce an error while typing, only after leaving the field', async () => {
    const bpm = await pinTrack();
    fireEvent.change(bpm, { target: { value: '1' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.change(bpm, { target: { value: '999' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.blur(bpm);
    expect(screen.getByRole('alert')).toHaveTextContent('40-220 BPM');
    expect(screen.queryByTestId('bpm-match')).not.toBeInTheDocument();
  });

  it.each(['0x50', '1e2', '12abc', '-90'])('rejects %s', async (text) => {
    const bpm = await pinTrack();
    fireEvent.change(bpm, { target: { value: text } });
    fireEvent.blur(bpm);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(await stored()).toBeUndefined();
  });

  it('stores the rounded value once, on blur, and undo restores the field', async () => {
    const bpm = await pinTrack();
    fireEvent.change(bpm, { target: { value: '1' } });
    fireEvent.change(bpm, { target: { value: '17' } });
    fireEvent.change(bpm, { target: { value: '172.4' } });
    expect(await stored()).toBeUndefined();
    fireEvent.blur(bpm);
    expect(await stored()).toBe(172);
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(screen.getByTestId('track-bpm')).toHaveValue(''));
    expect(await stored()).toBeUndefined();
  });

  it('tap tempo fills the field and stores it after a pause', async () => {
    const bpm = await pinTrack();
    const now = vi.spyOn(performance, 'now');
    let t = 1000;
    for (let i = 0; i < 6; i++) {
      now.mockReturnValue(t);
      fireEvent.click(screen.getByRole('button', { name: 'Tap tempo' }));
      t += 500;
    }
    now.mockRestore();
    expect(bpm).toHaveValue('120');
    // Nothing is stored while tapping; the value lands after a pause.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1000));
    });
    expect(await stored()).toBe(120);
  });

  it('keeps the BPM when the same URL is pinned again', async () => {
    const bpm = await pinTrack();
    fireEvent.change(bpm, { target: { value: '180' } });
    fireEvent.blur(bpm);
    expect(await stored()).toBe(180);
    fireEvent.click(screen.getByRole('button', { name: 'Pin track' }));
    await waitFor(() => expect(screen.getByTestId('track-bpm')).toHaveValue('180'));
    expect(await stored()).toBe(180);
  });

  it('shows a sensible hint for a sprint cadence (120 RPM has no exact target)', async () => {
    await openEditor(2);
    const hint = screen.getByTestId('bpm-target');
    expect(hint).toHaveTextContent('about 120 BPM (half time)');
    expect(hint).not.toHaveTextContent('240');
  });

  it('shows no dangling half-time clause for a very slow cadence (35 RPM)', async () => {
    await openEditor(3);
    const hint = screen.getByTestId('bpm-target');
    expect(hint).toHaveTextContent('about 70 BPM.');
    expect(hint.textContent).not.toContain('undefined');
    expect(hint.textContent).not.toContain(' - ');
  });

  it('shows no hint without a cadence, and no match verdict', async () => {
    await openEditor(1);
    expect(screen.queryByTestId('bpm-target')).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId('track-url'), { target: { value: YT_URL } });
    fireEvent.click(screen.getByRole('button', { name: 'Pin track' }));
    const bpm = await screen.findByTestId('track-bpm');
    fireEvent.change(bpm, { target: { value: '128' } });
    expect(screen.queryByTestId('bpm-match')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bpm-nomatch')).not.toBeInTheDocument();
  });
});
