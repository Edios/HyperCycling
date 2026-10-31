import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PLAN_SETTINGS, type PlanProgress, type PlanSettings } from '../../domain/plan';
import type { Player } from '../../domain/player';
import { scaleWorkout } from '../../domain/scale';
import { DEFAULT_SETTINGS, type Settings } from '../../domain/settings';
import { totalDurationSec } from '../../domain/workout';

interface Db {
  settings?: Settings;
  players: Player[];
  progress: PlanProgress[];
  puts: Player[];
  failPut?: boolean;
  workouts?: import('../../domain/workout').Workout[];
}
const db: Db = { players: [], progress: [], puts: [] };
const saved: Settings[] = [];

vi.mock('../data/repositories', () => ({
  getRepositories: () =>
    Promise.resolve({
      workouts: { list: () => Promise.resolve(db.workouts ?? []) },
      activeSession: { clear: () => Promise.resolve() },
      settings: {
        get: () => Promise.resolve(db.settings),
        put: (s: Settings) => {
          saved.push(s);
          return Promise.resolve();
        },
      },
      players: {
        list: () => Promise.resolve(db.players),
        put: (p: Player) => {
          if (db.failPut) return Promise.reject(new Error('disk'));
          db.puts.push(p);
          return Promise.resolve();
        },
      },
      planProgress: {
        get: (id: string) => Promise.resolve(db.progress.find((p) => p.planId === id)),
      },
    }),
}));

vi.setConfig({ testTimeout: 20_000 });

import { builtinWorkouts } from '../data/builtin';
import { resetSettingsForTests } from '../data/useSettings';
import { useSessionStore } from '../training/session-store';
import { SetupScreen } from './SetupScreen';

const scalable = builtinWorkouts.find((w) => w.scaling && w.musicCues.length === 0)!;
const withCues = builtinWorkouts.find((w) => w.musicCues.length > 0);

const mirek: Player = { id: 'p1', name: 'Mirek', ftp: 270 };
const ania: Player = { id: 'p2', name: 'Ania', ftp: 190 };

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}</div>;
}

function renderSetup(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/setup/:workoutId" element={<SetupScreen />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

function progress(settings: PlanSettings): PlanProgress {
  return {
    id: 'plan-x',
    planId: 'plan-x',
    startedAt: '2026-01-01T00:00:00.000Z',
    settings,
    entries: [],
  };
}

beforeEach(() => {
  db.settings = undefined;
  db.players = [mirek, ania];
  db.progress = [];
  db.puts = [];
  db.failPut = false;
  db.workouts = undefined;
  saved.length = 0;
  resetSettingsForTests();
  useSessionStore.setState({ runtime: undefined });
});

describe('SetupScreen', () => {
  it('shows the workout summary and badge from the plan', async () => {
    db.progress = [progress(DEFAULT_PLAN_SETTINGS)];
    renderSetup(`/setup/${scalable.id}?plan=plan-x&week=3&slot=progres`);
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(scalable.name);
    expect(screen.getByTestId('setup-badge')).toHaveTextContent('Progres · week 3');
    expect(screen.getByTestId('profile-chart')).toBeInTheDocument();
    expect(screen.getByTestId('setup-time')).toBeInTheDocument();
  });

  it('without a plan there is no badge', async () => {
    renderSetup(`/setup/${scalable.id}`);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByTestId('setup-badge')).not.toBeInTheDocument();
  });

  it('Start builds the runtime scaled by the plan settings and saves the choices', async () => {
    const settings: PlanSettings = { ...DEFAULT_PLAN_SETTINGS, sessionMinutes: 30, difficulty: 5 };
    db.progress = [progress(settings)];
    renderSetup(`/setup/${scalable.id}?plan=plan-x&week=2&slot=freestyle`);

    fireEvent.click(await screen.findByRole('button', { name: /Mirek/ }));
    fireEvent.click(screen.getByRole('switch', { name: 'Beeps' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));

    expect(await screen.findByTestId('where')).toHaveTextContent('/train');
    const runtime = useSessionStore.getState().runtime!;
    const expected = scaleWorkout(scalable, { targetMinutes: 30, difficultyPct: 5 });
    expect(runtime.workout).toEqual(expected);
    expect(totalDurationSec(runtime.workout)).not.toBe(totalDurationSec(scalable));
    expect(runtime.config).toEqual({
      background: 'basic',
      hud: 'players',
      playerIds: ['p1'],
      music: false,
    });
    expect(runtime.players).toEqual([mirek]);
    expect(runtime.plan).toEqual({ planId: 'plan-x', week: 2, slot: 'freestyle' });
    expect(runtime.segments.length).toBeGreaterThan(0);

    // R19: the choices belong to this ride; the saved defaults are not touched.
    expect(runtime.options).toMatchObject({ sounds: false, coach: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(saved).toEqual([]);
  });

  it('preselects the me rider, or the only rider', async () => {
    db.players = [mirek, ania];
    db.players = [{ ...mirek, isMe: true }, ania];
    const first = renderSetup(`/setup/${scalable.id}`);
    expect(await screen.findByRole('button', { name: /Mirek/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: /Ania/ })).toHaveAttribute('aria-pressed', 'false');
    first.unmount();
    resetSettingsForTests();
    db.players = [ania];
    renderSetup(`/setup/${scalable.id}`);
    expect(await screen.findByRole('button', { name: /Ania/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('says why With players is unavailable and where players show on Hyperride', async () => {
    renderSetup(`/setup/${scalable.id}`);
    expect(await screen.findByTestId('layout-hint')).toHaveTextContent(/Select a rider/);
    fireEvent.click(screen.getByRole('button', { name: /Hyperride/ }));
    expect(screen.getByTestId('layout-hint')).toHaveTextContent(/Immersive and Column/);
    fireEvent.click(screen.getByRole('button', { name: /Mirek/ }));
    expect(screen.getByTestId('layout-hint')).toHaveTextContent(/Cockpit and Time in the tunnel/);
  });

  it('shows the reason under a disabled Music toggle', async () => {
    renderSetup(`/setup/${scalable.id}`);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByTestId('music-hint')).toHaveTextContent(/no pinned tracks/i);
  });

  it('says the choices are for this ride only', async () => {
    renderSetup(`/setup/${scalable.id}`);
    expect(await screen.findByText(/this ride only/i)).toBeInTheDocument();
  });

  it('a freestyle start without plan or players is solo and unscaled', async () => {
    renderSetup(`/setup/${scalable.id}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }));
    await screen.findByTestId('where');
    const runtime = useSessionStore.getState().runtime!;
    expect(runtime.workout).toEqual(scalable);
    expect(runtime.config.hud).toBe('solo');
    expect(runtime.plan).toBeUndefined();
  });

  it('a preselected rider does not switch the layout away from the Settings default', async () => {
    db.players = [{ ...mirek, isMe: true }, ania];
    renderSetup(`/setup/${scalable.id}`);
    expect(await screen.findByRole('button', { name: /Mirek/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('radio', { name: 'Solo' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await screen.findByTestId('where');
    expect(useSessionStore.getState().runtime!.config).toMatchObject({
      hud: 'solo',
      playerIds: ['p1'],
    });
  });

  it('music starts on when Settings has it on by default and the workout has cues', async () => {
    if (!withCues) return;
    db.settings = {
      ...DEFAULT_SETTINGS,
      lastSession: { background: 'basic', hud: 'solo', playerIds: [], music: true },
    };
    renderSetup(`/setup/${withCues.id}`);
    expect(await screen.findByRole('switch', { name: 'Music' })).toBeChecked();
  });

  it('prefills players and toggles from the last session', async () => {
    db.settings = {
      ...DEFAULT_SETTINGS,
      coach: false,
      lastSession: { background: 'basic', hud: 'players', playerIds: ['p2', 'gone'], music: false },
    };
    renderSetup(`/setup/${scalable.id}`);
    expect(await screen.findByRole('button', { name: /Ania/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: /Mirek/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('switch', { name: 'On-screen cues' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'With players' })).toBeChecked();
  });

  it('layout: Solo overrides the auto choice and Basic hides the overlay layouts', async () => {
    renderSetup(`/setup/${scalable.id}`);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByRole('radio', { name: 'With players' })).toBeDisabled();
    for (const name of ['Immersive', 'Column', 'Cockpit', 'Time in the tunnel']) {
      expect(screen.queryByRole('radio', { name })).not.toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: /Mirek/ }));
    expect(screen.getByRole('radio', { name: 'With players' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Solo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await screen.findByTestId('where');
    expect(useSessionStore.getState().runtime!.config).toMatchObject({
      hud: 'solo',
      playerIds: ['p1'],
    });
  });

  it('Hyperride, YouTube and Basic are all selectable', async () => {
    renderSetup(`/setup/${scalable.id}`);
    expect(await screen.findByRole('button', { name: /Hyperride/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /YouTube/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Basic/ })).toBeEnabled();
  });

  it('offers the world only for Hyperride and saves the choice on start', async () => {
    renderSetup(`/setup/${scalable.id}`);
    await screen.findByRole('button', { name: /Hyperride/ });
    expect(screen.queryByRole('radio', { name: 'Road' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Hyperride/ }));
    expect(screen.getByRole('radio', { name: 'Neon tunnel' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Road' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await screen.findByTestId('where');
    expect(useSessionStore.getState().runtime!.options?.world).toBe('road');
    await new Promise((r) => setTimeout(r, 20));
    expect(saved).toEqual([]);
  });

  it('Hyperride offers the overlay layouts (Immersive by default); players disable two', async () => {
    renderSetup(`/setup/${scalable.id}`);
    fireEvent.click(await screen.findByRole('button', { name: /Hyperride/ }));
    expect(screen.getByRole('radio', { name: 'Immersive' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Cockpit' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /Mirek/ }));
    expect(screen.getByRole('radio', { name: 'Cockpit' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Time in the tunnel' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'Column' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await screen.findByTestId('where');
    expect(useSessionStore.getState().runtime!.config).toMatchObject({
      background: 'hyperride',
      hud: 'column',
      playerIds: ['p1'],
    });
  });

  it('music is disabled when the workout has no cues, enabled when it has', async () => {
    renderSetup(`/setup/${scalable.id}`);
    expect(await screen.findByRole('switch', { name: 'Music' })).toBeDisabled();
    if (!withCues) return;
    renderSetup(`/setup/${withCues.id}`);
    await waitFor(() => expect(screen.getAllByRole('switch', { name: 'Music' })).toHaveLength(2));
    const second = screen.getAllByRole('switch', { name: 'Music' })[1]!;
    expect(second).toBeEnabled();
    fireEvent.click(second);
    fireEvent.click(screen.getAllByRole('button', { name: 'Start' })[1]!);
    await screen.findByTestId('where');
    expect(useSessionStore.getState().runtime!.config.music).toBe(true);
  });

  it('adding a player validates name and FTP, saves it and selects it', async () => {
    renderSetup(`/setup/${scalable.id}`);
    fireEvent.click(await screen.findByRole('button', { name: '+ Add' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add rider' }));
    expect(screen.getByText('Enter a name of 1 to 24 characters.')).toBeInTheDocument();
    expect(screen.getByText('FTP must be a whole number from 50 to 600.')).toBeInTheDocument();
    expect(db.puts).toHaveLength(0);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Kasia' } });
    fireEvent.change(screen.getByLabelText('FTP (W)'), { target: { value: '700' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add rider' }));
    expect(screen.queryByText('Enter a name of 1 to 24 characters.')).not.toBeInTheDocument();
    expect(screen.getByText('FTP must be a whole number from 50 to 600.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('FTP (W)'), { target: { value: '220' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add rider' }));
    const chip = await screen.findByRole('button', { name: /Kasia/ });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(db.puts).toHaveLength(1);
    expect(db.puts[0]).toMatchObject({ name: 'Kasia', ftp: 220 });
  });

  it('a double submit saves the rider once', async () => {
    renderSetup(`/setup/${scalable.id}`);
    fireEvent.click(await screen.findByRole('button', { name: '+ Add' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Kasia' } });
    fireEvent.change(screen.getByLabelText('FTP (W)'), { target: { value: '220' } });
    const form = screen.getByTestId('add-player-form');
    fireEvent.submit(form);
    fireEvent.submit(form);
    await screen.findByRole('button', { name: /Kasia/ });
    expect(db.puts).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /Kasia/ })).toHaveLength(1);
  });

  it('after a failed save the form can be submitted again', async () => {
    db.failPut = true;
    renderSetup(`/setup/${scalable.id}`);
    fireEvent.click(await screen.findByRole('button', { name: '+ Add' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Kasia' } });
    fireEvent.change(screen.getByLabelText('FTP (W)'), { target: { value: '220' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add rider' }));
    await screen.findByText('The rider could not be saved. Try again.');
    db.failPut = false;
    fireEvent.click(screen.getByRole('button', { name: 'Add rider' }));
    await screen.findByRole('button', { name: /Kasia/ });
    expect(db.puts).toHaveLength(1);
  });

  it('a failed save shows an error and does not add or select the rider', async () => {
    db.failPut = true;
    renderSetup(`/setup/${scalable.id}`);
    fireEvent.click(await screen.findByRole('button', { name: '+ Add' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Kasia' } });
    fireEvent.change(screen.getByLabelText('FTP (W)'), { target: { value: '220' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add rider' }));
    expect(await screen.findByText('The rider could not be saved. Try again.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Kasia/ })).not.toBeInTheDocument();
  });

  it('allows at most 10 riders in a session', async () => {
    db.players = Array.from({ length: 11 }, (_, i) => ({
      id: `q${i}`,
      name: `Rider${i}`,
      ftp: 200,
    }));
    renderSetup(`/setup/${scalable.id}`);
    await screen.findByRole('heading', { level: 1 });
    for (let i = 0; i < 10; i++) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`Rider${i} `) }));
    }
    expect(screen.getByRole('button', { name: /Rider10 / })).toBeDisabled();
  });

  it('an unknown workout goes back home', async () => {
    renderSetup('/setup/nope');
    expect(await screen.findByTestId('where')).toHaveTextContent('/');
  });
});

describe('SetupScreen edit link (H3)', () => {
  it('own workouts offer Edit; built-ins do not', async () => {
    db.workouts = [{ ...scalable, id: 'mine-1', name: 'Mine', source: { kind: 'user' } }];
    renderSetup('/setup/mine-1');
    const edit = await screen.findByRole('link', { name: 'Edit' });
    expect(edit).toHaveAttribute('href', '/editor/mine-1');
  });

  it('a built-in has no Edit link', async () => {
    renderSetup(`/setup/${scalable.id}`);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
  });
});
