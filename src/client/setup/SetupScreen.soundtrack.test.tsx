import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../../domain/settings';

const db = vi.hoisted(() => ({ settings: undefined as Settings | undefined }));
vi.mock('../data/repositories', () => ({
  getRepositories: () =>
    Promise.resolve({
      workouts: { list: () => Promise.resolve([]) },
      activeSession: { clear: () => Promise.resolve() },
      settings: {
        get: () => Promise.resolve(db.settings),
        put: (s: Settings) => {
          db.settings = s;
          return Promise.resolve();
        },
      },
      players: { list: () => Promise.resolve([]), put: () => Promise.resolve() },
      planProgress: { get: () => Promise.resolve(undefined) },
    }),
}));

vi.setConfig({ testTimeout: 30_000 });

import { parseCatalog } from '../../domain/soundtrack-catalog';
import { planSoundtrack, DEFAULT_SOUNDTRACK_PREFS } from '../../domain/soundtrack-plan';
import { effectiveMusicCues } from '../../domain/workout';
import raw from '../../content/soundtrack/catalog.json';
import { builtinWorkouts } from '../data/builtin';
import { resetSettingsForTests } from '../data/useSettings';
import { resetSoundtrackSessionForTests, useSoundtrackSession } from '../soundtrack/session';
import { useSessionStore } from '../training/session-store';
import { SetupScreen } from './SetupScreen';

const catalog = parseCatalog(raw).tracks;
const workout = builtinWorkouts.find((w) => w.id === 'class-endurance-45')!;

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
}

function renderSetup(id = workout.id) {
  return render(
    <MemoryRouter initialEntries={[`/setup/${id}`]}>
      <Routes>
        <Route path="/setup/:workoutId" element={<SetupScreen />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.setItem('hypercycling.setup.advanced', '1');
  db.settings = { ...DEFAULT_SETTINGS };
  resetSettingsForTests();
  resetSoundtrackSessionForTests();
  useSessionStore.setState({ runtime: undefined });
});

describe('the ride setup with matched music', () => {
  it('offers to match music and opens the wizard on the ride as shown', async () => {
    renderSetup();
    const row = await screen.findByTestId('setup-soundtrack');
    expect(row).toHaveAttribute('data-state', 'none');
    expect(row).toHaveTextContent('Match songs to this ride.');
    expect(within(row).queryByTestId('setup-match-remove')).not.toBeInTheDocument();
    fireEvent.click(within(row).getByTestId('setup-match-music'));
    expect(await screen.findByTestId('where')).toHaveTextContent(
      `/soundtrack/${workout.id}?from=setup`,
    );
    expect(useSoundtrackSession.getState().workouts[workout.id]?.id).toBe(workout.id);
  });

  it('puts the matched music on the ride: music on, songs counted, cues in the session', async () => {
    const plan = planSoundtrack(workout, catalog, { ...DEFAULT_SOUNDTRACK_PREFS, seed: 3 });
    useSoundtrackSession.getState().setPlan(workout.id, plan);
    renderSetup();
    const row = await screen.findByTestId('setup-soundtrack');
    await waitFor(() => expect(row).toHaveAttribute('data-state', 'ready'));
    const songs = plan.sections.reduce((n, s) => n + s.picks.length, 0);
    expect(row).toHaveTextContent(`Matched: ${songs} songs.`);
    expect(within(row).getByTestId('setup-match-music')).toHaveTextContent('Change');
    expect(screen.getByRole('switch', { name: 'Music in this ride' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByTestId('where')).toHaveTextContent('/train');
    const runtime = useSessionStore.getState().runtime!;
    expect(runtime.config.music).toBe(true);
    const cues = effectiveMusicCues(runtime.workout);
    expect(cues.length).toBe(plan.sections.length);
    expect(cues.reduce((n, c) => n + 1 + (c.queue?.length ?? 0), 0)).toBe(songs);
    expect(cues.every((c) => c.track.provider === 'youtube')).toBe(true);
    // The workout itself (the library's) was not touched.
    expect(workout.musicCues).toEqual([]);
  });

  it('removes the matched music again', async () => {
    useSoundtrackSession.getState().setPlan(workout.id, planSoundtrack(workout, catalog));
    renderSetup();
    const row = await screen.findByTestId('setup-soundtrack');
    await waitFor(() => expect(row).toHaveAttribute('data-state', 'ready'));
    fireEvent.click(within(row).getByTestId('setup-match-remove'));
    await waitFor(() => expect(row).toHaveAttribute('data-state', 'none'));
    expect(useSoundtrackSession.getState().plans).toEqual({});
  });

  it('does not apply a plan made for another version of the ride, and says so', async () => {
    const plan = planSoundtrack(workout, catalog);
    useSoundtrackSession.getState().setPlan(workout.id, { ...plan, fingerprint: 'deadbeef' });
    renderSetup();
    const row = await screen.findByTestId('setup-soundtrack');
    await waitFor(() => expect(row).toHaveAttribute('data-state', 'stale'));
    expect(row).toHaveTextContent('The ride changed since you matched the music.');
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await screen.findByTestId('where');
    expect(effectiveMusicCues(useSessionStore.getState().runtime!.workout)).toHaveLength(0);
  });

  it('is not offered for an Experience (it has its own music)', async () => {
    render(
      <MemoryRouter initialEntries={['/setup/class-neon-grid-45?exp=neon-grid-45']}>
        <Routes>
          <Route path="/setup/:workoutId" element={<SetupScreen />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByTestId('setup-soundtrack')).not.toBeInTheDocument();
  });
});
