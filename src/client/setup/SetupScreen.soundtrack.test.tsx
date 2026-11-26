import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../../domain/settings';

const db = vi.hoisted(() => ({
  settings: undefined as Settings | undefined,
  saved: new Map<string, unknown>(),
  removed: [] as string[],
}));
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
      soundtrackPlans: {
        get: (id: string) => Promise.resolve(db.saved.get(id)),
        put: (r: { id: string }) => {
          db.saved.set(r.id, r);
          return Promise.resolve();
        },
        remove: (id: string) => {
          db.removed.push(id);
          db.saved.delete(id);
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
import { planRecord } from '../../domain/soundtrack-store';
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

/** The ride's music on (a plan read from the device leaves it as the last ride had it). */
function musicOnInThisRide(): void {
  const sw = screen.getByRole('switch', { name: 'Music in this ride' });
  if (!(sw as HTMLInputElement).checked) fireEvent.click(sw);
}

beforeEach(() => {
  localStorage.setItem('hypercycling.setup.advanced', '1');
  db.settings = { ...DEFAULT_SETTINGS };
  db.saved.clear();
  db.removed.length = 0;
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

  it('finds the plan saved on this device when the ride is opened again', async () => {
    const plan = planSoundtrack(workout, catalog, { ...DEFAULT_SOUNDTRACK_PREFS, seed: 4 });
    db.saved.set(workout.id, planRecord(plan, new Date('2026-11-23T09:00:00.000Z')));
    renderSetup();
    const row = await screen.findByTestId('setup-soundtrack');
    await waitFor(() => expect(row).toHaveAttribute('data-state', 'ready'));
    const songs = plan.sections.reduce((n, s) => n + s.picks.length, 0);
    expect(row).toHaveTextContent(`Matched: ${songs} songs.`);
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await screen.findByTestId('where');
    const cues = effectiveMusicCues(useSessionStore.getState().runtime!.workout);
    expect(cues.length).toBe(plan.sections.length);
  });

  it('plays the saved order again, or draws a new one for this ride only', async () => {
    const plan = planSoundtrack(workout, catalog, { ...DEFAULT_SOUNDTRACK_PREFS, seed: 4 });
    const record = planRecord(plan, new Date('2026-11-23T09:00:00.000Z'));
    db.saved.set(workout.id, record);
    renderSetup();
    const row = await screen.findByTestId('setup-soundtrack');
    await waitFor(() => expect(row).toHaveAttribute('data-state', 'ready'));
    musicOnInThisRide();
    const order = within(row).getByRole('radiogroup', { name: 'Song order' });
    expect(within(order).getByRole('radio', { name: 'Last order' })).toBeChecked();
    expect(row).toHaveTextContent('The saved order of songs plays again.');
    const ids = () =>
      useSoundtrackSession
        .getState()
        .plans[workout.id]!.sections.flatMap((x) => x.picks.map((p) => p.ref.id));
    const savedIds = ids();

    fireEvent.click(within(order).getByRole('radio', { name: 'New order' }));
    await waitFor(() => expect(ids()).not.toEqual(savedIds));
    expect(row).toHaveTextContent(
      'A new order of songs for this ride. You can save it after the ride.',
    );
    expect(db.saved.get(workout.id)).toBe(record);
    const firstDraw = ids();
    fireEvent.click(within(row).getByRole('button', { name: 'Draw another' }));
    await waitFor(() => expect(ids()).not.toEqual(firstDraw));

    fireEvent.click(within(order).getByRole('radio', { name: 'Last order' }));
    await waitFor(() => expect(ids()).toEqual(savedIds));
    expect(within(row).queryByRole('button', { name: 'Draw another' })).not.toBeInTheDocument();
  });

  it('offers no song order choice while the music of this ride is off', async () => {
    const plan = planSoundtrack(workout, catalog, { ...DEFAULT_SOUNDTRACK_PREFS, seed: 4 });
    db.saved.set(workout.id, planRecord(plan, new Date('2026-11-23T09:00:00.000Z')));
    renderSetup();
    const row = await screen.findByTestId('setup-soundtrack');
    await waitFor(() => expect(row).toHaveAttribute('data-state', 'ready'));
    musicOnInThisRide();
    expect(within(row).getByRole('radiogroup', { name: 'Song order' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'Music in this ride' }));
    await waitFor(() =>
      expect(within(row).queryByRole('radiogroup', { name: 'Song order' })).not.toBeInTheDocument(),
    );
  });

  it('offers no song order choice for music not saved on this device', async () => {
    useSoundtrackSession
      .getState()
      .setPlan(workout.id, planSoundtrack(workout, catalog, { ...DEFAULT_SOUNDTRACK_PREFS }));
    renderSetup();
    const row = await screen.findByTestId('setup-soundtrack');
    await waitFor(() => expect(row).toHaveAttribute('data-state', 'ready'));
    expect(within(row).queryByRole('radiogroup', { name: 'Song order' })).not.toBeInTheDocument();
  });

  it('removing the matched music removes the saved plan too, for good', async () => {
    const plan = planSoundtrack(workout, catalog);
    db.saved.set(workout.id, planRecord(plan, new Date('2026-11-23T09:00:00.000Z')));
    renderSetup();
    const row = await screen.findByTestId('setup-soundtrack');
    await waitFor(() => expect(row).toHaveAttribute('data-state', 'ready'));
    fireEvent.click(within(row).getByTestId('setup-match-remove'));
    await waitFor(() => expect(row).toHaveAttribute('data-state', 'none'));
    await waitFor(() => expect(db.removed).toEqual([workout.id]));
    expect(db.saved.size).toBe(0);
  });

  it('asks to match again when the saved plan is for another version of the ride', async () => {
    const plan = planSoundtrack(workout, catalog);
    db.saved.set(
      workout.id,
      planRecord({ ...plan, fingerprint: '00000000' }, new Date('2026-11-23T09:00:00.000Z')),
    );
    renderSetup();
    const row = await screen.findByTestId('setup-soundtrack');
    await waitFor(() => expect(row).toHaveAttribute('data-state', 'stale'));
    expect(within(row).getByTestId('setup-match-music')).toHaveTextContent('Match again');
    expect(row).toHaveTextContent('Match it again.');
  });

  it('says so when the songs could not be saved on this device', async () => {
    useSoundtrackSession.setState({ saveFailed: true });
    useSoundtrackSession.getState().setPlan(workout.id, planSoundtrack(workout, catalog));
    renderSetup();
    expect(await screen.findByTestId('setup-soundtrack-unsaved')).toHaveTextContent(
      'could not be saved on this device',
    );
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

  it('says that an own song of the plan was removed (not that the ride changed)', async () => {
    const plan = planSoundtrack(workout, catalog);
    const at = plan.sections.findIndex((x) => x.picks.length > 0);
    const sections = plan.sections.map((x, i) =>
      i === at
        ? {
            ...x,
            picks: x.picks.map((p, j) =>
              j === 0 ? { ...p, ref: { kind: 'own' as const, id: 'own-abcdefghijk' } } : p,
            ),
          }
        : x,
    );
    useSoundtrackSession.getState().setPlan(workout.id, { ...plan, sections });
    renderSetup();
    const row = await screen.findByTestId('setup-soundtrack');
    await waitFor(() => expect(row).toHaveAttribute('data-state', 'stale'));
    expect(row).toHaveTextContent('A song of yours in this music was removed from My songs.');
    expect(row).not.toHaveTextContent('The ride changed');
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
