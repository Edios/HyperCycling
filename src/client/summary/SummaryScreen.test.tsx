import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PLAN_SETTINGS,
  type Plan,
  type PlanProgress,
  type ProgressEntry,
} from '../../domain/plan';
import type { Player } from '../../domain/player';
import { flattenWorkout } from '../../domain/segments';
import type { SessionLog } from '../../domain/session-log';
import { DEFAULT_SETTINGS, type Settings } from '../../domain/settings';

interface Db {
  settings?: Settings;
  players: Player[];
  progress: PlanProgress[];
  logs: SessionLog[];
  playerPuts: Player[];
  progressPuts: PlanProgress[];
}
const db: Db = { players: [], progress: [], logs: [], playerPuts: [], progressPuts: [] };

vi.mock('../data/repositories', () => ({
  getRepositories: () =>
    Promise.resolve({
      workouts: { list: () => Promise.resolve([]) },
      settings: { get: () => Promise.resolve(db.settings), put: () => Promise.resolve() },
      players: {
        list: () => Promise.resolve(db.players),
        put: (p: Player) => {
          db.playerPuts.push(p);
          return Promise.resolve();
        },
      },
      planProgress: {
        get: (id: string) => Promise.resolve(db.progress.find((p) => p.planId === id)),
        put: (p: PlanProgress) => {
          db.progressPuts.push(p);
          return Promise.resolve();
        },
      },
      sessionLogs: {
        put: (l: SessionLog) => {
          db.logs.push(l);
          return Promise.resolve();
        },
      },
    }),
}));

vi.setConfig({ testTimeout: 20_000 });

import { builtinPlans, builtinWorkouts } from '../data/builtin';
import { resetSettingsForTests } from '../data/useSettings';
import { useLastResult, type LastResult } from '../training/last-result';
import { SummaryScreen } from './SummaryScreen';

const plan = builtinPlans.find(
  (p) => !p.loop && p.weeks[0]?.sessions.some((s) => s.slot === 'freestyle'),
) as Plan;
const progresWorkout = builtinWorkouts.find((w) => w.category === 'progres')!;
const freestyleWorkout = builtinWorkouts.find(
  (w) => w.category === 'freestyle' && w.id !== 'ramp-test',
)!;
const ramp = builtinWorkouts.find((w) => w.id === 'ramp-test')!;
const mirek: Player = { id: 'p1', name: 'Mirek', ftp: 270, isMe: true };
const ania: Player = { id: 'p2', name: 'Ania', ftp: 190 };

function totalOf(w: Parameters<typeof flattenWorkout>[0]): number {
  return flattenWorkout(w).reduce((s, x) => s + x.durationSec, 0);
}

function result(over: Partial<LastResult> = {}): LastResult {
  const workout = over.workout ?? progresWorkout;
  return {
    workout,
    riddenSec: totalOf(workout),
    completed: true,
    config: { background: 'basic', hud: 'solo', playerIds: [], music: false },
    players: [mirek, ania],
    startedAt: '2026-03-01T10:00:00.000Z',
    ...over,
  };
}

function freshProgress(entries: ProgressEntry[] = []): PlanProgress {
  return {
    id: plan.id,
    planId: plan.id,
    startedAt: '2026-01-01T00:00:00.000Z',
    settings: DEFAULT_PLAN_SETTINGS,
    entries,
  };
}

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
}

function renderSummary(strict = false) {
  const tree = (
    <MemoryRouter initialEntries={['/summary']}>
      <Routes>
        <Route path="/summary" element={<SummaryScreen />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

const planRef = { planId: plan.id, week: 1, slot: 'progres' as const };

beforeEach(() => {
  db.settings = { ...DEFAULT_SETTINGS, activePlanId: plan.id };
  db.players = [mirek, ania];
  db.progress = [freshProgress()];
  db.logs = [];
  db.playerPuts = [];
  db.progressPuts = [];
  resetSettingsForTests();
  useLastResult.getState().clear();
});

// Unmounting persists in a deferred handler; let it finish before the next test resets the db.
afterEach(async () => {
  cleanup();
  await new Promise((r) => setTimeout(r, 20));
});

const toggle = () => screen.findByRole('switch', { name: 'Count toward plan' });
const noToggle = () =>
  expect(screen.queryByRole('switch', { name: 'Count toward plan' })).not.toBeInTheDocument();

describe('SummaryScreen', () => {
  it('shows name, status, floored ridden time, chart and players', async () => {
    useLastResult.getState().set(result({ riddenSec: 125.9, completed: false, plan: planRef }));
    renderSummary();
    expect(await screen.findByTestId('summary-name')).toHaveTextContent(progresWorkout.name);
    expect(screen.getByTestId('summary-status')).toHaveTextContent('Ended early');
    expect(screen.getByTestId('summary-ridden')).toHaveTextContent('2:05');
    expect(screen.getByTestId('profile-chart')).toBeInTheDocument();
    expect(screen.getByText('Mirek')).toBeInTheDocument();
    expect(screen.getByText('Ania')).toBeInTheDocument();
  });

  it('redirects home without a result', async () => {
    renderSummary();
    expect(await screen.findByTestId('where')).toHaveTextContent('/');
  });

  describe('count toward plan', () => {
    it('plan session at 100 % defaults on and shows plan, week and slot', async () => {
      useLastResult.getState().set(result({ plan: planRef }));
      renderSummary();
      expect(await toggle()).toBeChecked();
      expect(screen.getByTestId('count-detail')).toHaveTextContent(
        `${plan.name} · week 1 · Progres`,
      );
    });

    it('plan session below 80 % defaults off', async () => {
      const total = totalOf(progresWorkout);
      useLastResult
        .getState()
        .set(result({ plan: planRef, riddenSec: total * 0.5, completed: false }));
      renderSummary();
      expect(await toggle()).not.toBeChecked();
    });

    it('exactly 80 % defaults on', async () => {
      const total = totalOf(progresWorkout);
      useLastResult
        .getState()
        .set(result({ plan: planRef, riddenSec: total * 0.8, completed: false }));
      renderSummary();
      expect(await toggle()).toBeChecked();
    });

    it('freestyle outside the plan counts when the open week has a free freestyle slot', async () => {
      useLastResult.getState().set(result({ workout: freestyleWorkout }));
      renderSummary();
      expect(await toggle()).toBeChecked();
      expect(screen.getByTestId('count-detail')).toHaveTextContent('Freestyle');
    });

    it('freestyle outside the plan below 80 % defaults off', async () => {
      useLastResult
        .getState()
        .set(result({ workout: freestyleWorkout, riddenSec: 10, completed: false }));
      renderSummary();
      expect(await toggle()).not.toBeChecked();
    });

    it('is hidden for freestyle when the freestyle slot is already done', async () => {
      const done = (slot: 'progres' | 'freestyle'): ProgressEntry => ({
        week: 1,
        slot,
        workoutId: 'x',
        status: 'done',
        at: '2026-01-02T00:00:00.000Z',
      });
      db.progress = [freshProgress([done('freestyle')])];
      useLastResult.getState().set(result({ workout: freestyleWorkout }));
      renderSummary();
      await screen.findByTestId('summary-name');
      noToggle();
    });

    it('is hidden for a progres workout ridden outside the plan', async () => {
      useLastResult.getState().set(result({ workout: progresWorkout }));
      renderSummary();
      await screen.findByTestId('summary-name');
      noToggle();
    });

    it('is hidden without an active plan', async () => {
      db.settings = { ...DEFAULT_SETTINGS };
      useLastResult.getState().set(result({ workout: freestyleWorkout }));
      renderSummary();
      await screen.findByTestId('summary-name');
      noToggle();
    });
  });

  describe('leaving', () => {
    it('Back to plan writes the log and a done entry when the toggle is on', async () => {
      useLastResult.getState().set(
        result({
          plan: planRef,
          players: [mirek],
          config: { background: 'basic', hud: 'players', playerIds: ['p1'], music: false },
        }),
      );
      renderSummary();
      await toggle();
      fireEvent.click(screen.getByRole('button', { name: 'Back to plan' }));
      expect(await screen.findByTestId('where')).toHaveTextContent('/');
      expect(db.logs).toHaveLength(1);
      const log = db.logs[0]!;
      expect(log).toMatchObject({
        workoutId: progresWorkout.id,
        startedAt: '2026-03-01T10:00:00.000Z',
        riddenSec: totalOf(progresWorkout),
        completed: true,
        playerIds: ['p1'],
        config: { background: 'basic', hud: 'players', playerIds: ['p1'], music: false },
      });
      expect(log.id).toBeTruthy();
      expect(Number.isNaN(Date.parse(log.endedAt))).toBe(false);
      expect(db.progressPuts).toHaveLength(1);
      expect(db.progressPuts[0]!.entries).toEqual([
        expect.objectContaining({
          week: 1,
          slot: 'progres',
          workoutId: progresWorkout.id,
          status: 'done',
        }),
      ]);
    });

    it('with the toggle off only the log is written', async () => {
      useLastResult.getState().set(result({ plan: planRef }));
      renderSummary();
      fireEvent.click(await toggle());
      fireEvent.click(screen.getByRole('button', { name: 'Back to plan' }));
      await screen.findByTestId('where');
      expect(db.logs).toHaveLength(1);
      expect(db.progressPuts).toHaveLength(0);
    });

    it('a double click writes exactly once, also under StrictMode', async () => {
      useLastResult.getState().set(result({ plan: planRef }));
      renderSummary(true);
      await toggle();
      const btn = screen.getByRole('button', { name: 'Back to plan' });
      fireEvent.click(btn);
      fireEvent.click(btn);
      await screen.findByTestId('where');
      await new Promise((r) => setTimeout(r, 30));
      expect(db.logs).toHaveLength(1);
      expect(db.progressPuts).toHaveLength(1);
    });

    it('StrictMode alone does not write before leaving', async () => {
      useLastResult.getState().set(result({ plan: planRef }));
      renderSummary(true);
      await toggle();
      await new Promise((r) => setTimeout(r, 30));
      expect(db.logs).toHaveLength(0);
    });

    it('leaving by navigation persists once with the toggle as shown', async () => {
      useLastResult.getState().set(result({ plan: planRef }));
      const { unmount } = renderSummary();
      fireEvent.click(await toggle());
      unmount();
      await waitFor(() => expect(db.logs).toHaveLength(1));
      expect(db.progressPuts).toHaveLength(0);
      expect(useLastResult.getState().result).toBeUndefined();
    });

    it('Ride again goes back to setup with the same plan query', async () => {
      useLastResult.getState().set(result({ plan: { ...planRef, week: 2 } }));
      renderSummary();
      await toggle();
      fireEvent.click(screen.getByRole('button', { name: 'Ride again' }));
      expect(await screen.findByTestId('where')).toHaveTextContent(
        `/setup/${progresWorkout.id}?plan=${plan.id}&week=2&slot=progres`,
      );
      expect(db.logs).toHaveLength(1);
    });

    it('Ride again without a plan has no query', async () => {
      useLastResult.getState().set(result({ workout: freestyleWorkout }));
      renderSummary();
      await toggle();
      fireEvent.click(screen.getByRole('button', { name: 'Ride again' }));
      expect(await screen.findByTestId('where')).toHaveTextContent(`/setup/${freestyleWorkout.id}`);
    });

    it('counting a freestyle ride records the freestyle slot of the open week', async () => {
      useLastResult.getState().set(result({ workout: freestyleWorkout }));
      renderSummary();
      await toggle();
      fireEvent.click(screen.getByRole('button', { name: 'Back to plan' }));
      await screen.findByTestId('where');
      expect(db.progressPuts[0]!.entries[0]).toMatchObject({
        slot: 'freestyle',
        workoutId: freestyleWorkout.id,
        status: 'done',
      });
    });
  });

  describe('FTP test', () => {
    const best = () => screen.findByLabelText('Best 1-minute power (W)');

    it('is hidden for ordinary workouts', async () => {
      useLastResult.getState().set(result());
      renderSummary();
      await screen.findByTestId('summary-name');
      expect(screen.queryByLabelText('Best 1-minute power (W)')).not.toBeInTheDocument();
    });

    it('is hidden when the equipment shows no watts', async () => {
      db.settings = {
        ...DEFAULT_SETTINGS,
        equipment: { ...DEFAULT_SETTINGS.equipment, showsWatts: false },
      };
      useLastResult.getState().set(result({ workout: ramp }));
      renderSummary();
      await screen.findByTestId('summary-name');
      expect(screen.queryByLabelText('Best 1-minute power (W)')).not.toBeInTheDocument();
    });

    it('proposes 75 % for the isMe player and saves it', async () => {
      useLastResult.getState().set(result({ workout: ramp }));
      renderSummary();
      fireEvent.change(await best(), { target: { value: '400' } });
      expect(screen.getByTestId('ftp-proposal')).toHaveTextContent('300 W');
      fireEvent.click(screen.getByRole('button', { name: 'Save FTP' }));
      await waitFor(() => expect(db.playerPuts).toHaveLength(1));
      expect(db.playerPuts[0]).toEqual({ ...mirek, ftp: 300 });
    });

    it('rounds the proposal', async () => {
      useLastResult.getState().set(result({ workout: ramp }));
      renderSummary();
      fireEvent.change(await best(), { target: { value: '333' } });
      expect(screen.getByTestId('ftp-proposal')).toHaveTextContent('250 W');
    });

    it('rejects an FTP outside 50-600', async () => {
      useLastResult.getState().set(result({ workout: ramp }));
      renderSummary();
      fireEvent.change(await best(), { target: { value: '1000' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save FTP' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('50 to 600');
      expect(db.playerPuts).toHaveLength(0);
    });

    it('asks for a rider when nobody is marked as me', async () => {
      db.players = [{ ...mirek, isMe: false }, ania];
      useLastResult.getState().set(result({ workout: ramp }));
      renderSummary();
      fireEvent.change(await best(), { target: { value: '200' } });
      fireEvent.change(screen.getByLabelText('Rider'), { target: { value: 'p2' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save FTP' }));
      await waitFor(() => expect(db.playerPuts).toHaveLength(1));
      expect(db.playerPuts[0]).toEqual({ ...ania, ftp: 150 });
    });
  });
});
