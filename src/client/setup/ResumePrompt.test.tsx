import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanProgress } from '../../domain/plan';
import type { Player } from '../../domain/player';
import { scaleWorkout } from '../../domain/scale';
import type { ActiveSession } from '../../domain/session-log';

interface Db {
  active?: ActiveSession;
  progress?: PlanProgress;
  players: Player[];
  cleared: number;
}
const db: Db = { players: [], cleared: 0 };

vi.mock('../data/repositories', () => ({
  getRepositories: () =>
    Promise.resolve({
      workouts: { list: () => Promise.resolve([]), get: () => Promise.resolve(undefined) },
      settings: { get: () => Promise.resolve(undefined), put: () => Promise.resolve() },
      players: { list: () => Promise.resolve(db.players) },
      planProgress: { get: () => Promise.resolve(db.progress) },
      activeSession: {
        get: () => Promise.resolve(db.active),
        clear: () => {
          db.cleared++;
          db.active = undefined;
          return Promise.resolve();
        },
      },
    }),
}));

vi.setConfig({ testTimeout: 20_000 });

import { flattenWorkout } from '../../domain/segments';
import { DEFAULT_SETTINGS } from '../../domain/settings';
import { builtinWorkouts } from '../data/builtin';
import { resetSettingsForTests } from '../data/useSettings';
import { formatClock } from '../training/format';
import { useSessionStore } from '../training/session-store';
import { ResumePrompt } from './ResumePrompt';

const workout = builtinWorkouts[0]!;
const second = flattenWorkout(workout, DEFAULT_SETTINGS.effortTable)[1]!;
const elapsed = second.startSec + 10;
const ania: Player = { id: 'p2', name: 'Ania', ftp: 190 };

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}</div>;
}

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <ResumePrompt />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

function active(over: Partial<ActiveSession> = {}, ageMs = 12 * 60_000): ActiveSession {
  return {
    workoutId: workout.id,
    config: { background: 'basic', hud: 'players', playerIds: ['p2', 'gone'], music: false },
    snapshot: { segmentIndex: 1, workoutElapsedSec: elapsed, status: 'running' },
    savedAt: new Date(Date.now() - ageMs).toISOString(),
    ...over,
  };
}

beforeEach(() => {
  db.active = undefined;
  db.progress = undefined;
  db.players = [ania];
  db.cleared = 0;
  resetSettingsForTests();
  useSessionStore.setState({ runtime: undefined });
});

describe('ResumePrompt', () => {
  it('shows nothing without an interrupted session', async () => {
    renderApp();
    await screen.findByTestId('where');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('offers a fresh session with name, age and position, and Resume loads it paused', async () => {
    db.active = active();
    renderApp();
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Finish the session?');
    expect(dialog).toHaveTextContent(`${workout.name} was interrupted 12 min ago.`);
    expect(screen.getByTestId('resume-progress')).toHaveTextContent(
      new RegExp(`^Block 2 of [0-9]+ · ${formatClock(elapsed, { round: 'floor' })} of `),
    );
    expect(dialog).toHaveTextContent('Resumes paused');
    expect(screen.getByTestId('profile-chart')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(await screen.findByText('/train')).toBeInTheDocument();
    const s = useSessionStore.getState();
    expect(s.state.status).toBe('paused');
    expect(s.state.segmentIndex).toBe(1);
    expect(s.state.workoutElapsedSec).toBeCloseTo(elapsed, 0);
    // Unknown players are dropped, known ones kept.
    expect(s.runtime?.players).toEqual([ania]);
    expect(s.runtime?.config.playerIds).toEqual(['p2']);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(db.cleared).toBe(0);
  });

  it('Discard clears the stored session and stays put', async () => {
    db.active = active();
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(db.cleared).toBe(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/');
    expect(useSessionStore.getState().runtime).toBeUndefined();
  });

  it('a stale session is cleared silently', async () => {
    db.active = active({}, 3 * 3600_000);
    renderApp();
    await waitFor(() => expect(db.cleared).toBe(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a session whose workout is gone is cleared silently', async () => {
    db.active = active({ workoutId: 'no-such-workout' });
    renderApp();
    await waitFor(() => expect(db.cleared).toBe(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a session that carries its workout survives the original being deleted', async () => {
    const copy = { ...workout, id: 'deleted-user-workout', source: { kind: 'user' as const } };
    db.active = active({ workoutId: copy.id, workout: copy });
    renderApp();
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(db.cleared).toBe(0);
  });

  const scalable = builtinWorkouts.find((w) => w.scaling)!;
  const atStart = { segmentIndex: 0, workoutElapsedSec: 0, status: 'paused' as const };
  const planRef = { planId: 'plan-x', week: 1, slot: 'progres' as const };
  const planProgress = (sessionMinutes: 30 | 45 | 60): PlanProgress => ({
    id: 'plan-x',
    planId: 'plan-x',
    startedAt: '2026-01-01T00:00:00.000Z',
    settings: { sessionMinutes, difficulty: 0, layout: 'progresFreestyle', startWeek: 1 },
    entries: [],
  });

  it('resumes the stored workout even when the plan settings changed since', async () => {
    const ridden = scaleWorkout(scalable, { targetMinutes: 30, difficultyPct: 5 });
    db.progress = planProgress(60);
    db.active = active({
      workoutId: scalable.id,
      workout: ridden,
      plan: planRef,
      snapshot: atStart,
      config: { background: 'basic', hud: 'solo', playerIds: [], music: false },
    });
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }));
    await screen.findByText('/train');
    expect(useSessionStore.getState().runtime?.workout).toEqual(ridden);
  });

  it('without a stored workout rebuilds it from the plan settings', async () => {
    db.progress = planProgress(30);
    db.active = active({
      workoutId: scalable.id,
      plan: planRef,
      snapshot: atStart,
      config: { background: 'basic', hud: 'solo', playerIds: [], music: false },
    });
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }));
    await screen.findByText('/train');
    expect(useSessionStore.getState().runtime?.workout).toEqual(
      scaleWorkout(scalable, { targetMinutes: 30, difficultyPct: 0 }),
    );
  });

  it('clears a snapshot that lies outside its segment', async () => {
    db.active = active({ snapshot: { segmentIndex: 1, workoutElapsedSec: 0, status: 'paused' } });
    renderApp();
    await waitFor(() => expect(db.cleared).toBe(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('hides when a session starts while it is open', async () => {
    db.active = active();
    renderApp();
    await screen.findByRole('dialog');
    act(() => {
      useSessionStore.setState({
        runtime: { workout, segments: [], config: active().config, players: [] },
      });
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
