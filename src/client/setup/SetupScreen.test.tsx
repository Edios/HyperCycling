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
}
const db: Db = { players: [], progress: [], puts: [] };
const saved: Settings[] = [];

vi.mock('../data/repositories', () => ({
  getRepositories: () =>
    Promise.resolve({
      workouts: { list: () => Promise.resolve([]) },
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

const mirek: Player = { id: 'p1', name: 'Mirek', ftp: 270, isMe: true };
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

    await waitFor(() => expect(saved.length).toBeGreaterThan(0));
    const last = saved[saved.length - 1]!;
    expect(last.sounds).toBe(false);
    expect(last.coach).toBe(true);
    expect(last.lastSession).toEqual({
      background: 'basic',
      hud: 'players',
      playerIds: ['p1'],
      music: false,
    });
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

  it('Hyperride and YouTube are shown but disabled', async () => {
    renderSetup(`/setup/${scalable.id}`);
    expect(await screen.findByRole('button', { name: /Hyperride/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /YouTube/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Basic/ })).toBeEnabled();
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
