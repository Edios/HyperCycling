import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  gets: number;
  failGetNo?: number;
}
const db: Db = { players: [], progress: [], logs: [], playerPuts: [], progressPuts: [], gets: 0 };

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
        get: (id: string) => {
          db.gets += 1;
          if (db.gets === db.failGetNo) return Promise.reject(new Error('disk'));
          return Promise.resolve(db.progress.find((p) => p.planId === id));
        },
        put: (p: PlanProgress) => {
          db.progressPuts.push(p);
          db.progress = [...db.progress.filter((x) => x.planId !== p.planId), p];
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
const twenty = builtinWorkouts.find((w) => w.id === 'ftp-test-20')!;
const twoByEight = builtinWorkouts.find((w) => w.id === 'ftp-test-2x8')!;
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
  db.gets = 0;
  delete db.failGetNo;
  resetSettingsForTests();
  useLastResult.getState().clear();
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

  it('labels the big time', async () => {
    useLastResult.getState().set(result({ plan: planRef }));
    renderSummary();
    expect(await screen.findByTestId('summary-ridden-label')).toHaveTextContent('Time ridden');
  });

  describe('reload and short rides', () => {
    it('a restored result shows the summary but writes and counts nothing again', async () => {
      useLastResult.getState().set(result({ plan: planRef }));
      // Simulates the page after F5: the result comes back from session storage.
      useLastResult.setState({ result: { ...result({ plan: planRef }), restored: true } });
      renderSummary();
      await screen.findByTestId('summary-name');
      await new Promise((r) => setTimeout(r, 30));
      expect(db.logs).toHaveLength(0);
      expect(db.progressPuts).toHaveLength(0);
      noToggle();
    });

    it('a plan ride shorter than 2 minutes is not credited and says why', async () => {
      useLastResult.getState().set(result({ plan: planRef, riddenSec: 90, completed: false }));
      renderSummary();
      expect(await screen.findByTestId('count-short')).toHaveTextContent('2 minutes');
      noToggle();
      await waitFor(() => expect(db.logs).toHaveLength(1));
      expect(db.progressPuts).toHaveLength(0);
    });
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
        .set(result({ workout: freestyleWorkout, riddenSec: 130, completed: false }));
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

  describe('persistence', () => {
    const progressNow = () => db.progress.find((p) => p.planId === plan.id)!;

    it('writes the log and a done entry as soon as the summary opens', async () => {
      useLastResult.getState().set(
        result({
          plan: planRef,
          players: [mirek],
          config: { background: 'basic', hud: 'players', playerIds: ['p1'], music: false },
        }),
      );
      renderSummary();
      await toggle();
      await waitFor(() => expect(db.progressPuts).toHaveLength(1));
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
      expect(progressNow().entries).toEqual([
        expect.objectContaining({
          week: 1,
          slot: 'progres',
          workoutId: progresWorkout.id,
          status: 'done',
        }),
      ]);
    });

    it('keeps the log and the entry when the screen closes without a button', async () => {
      useLastResult.getState().set(result({ plan: planRef }));
      const { unmount } = renderSummary();
      await toggle();
      await waitFor(() => expect(db.progressPuts).toHaveLength(1));
      unmount();
      await new Promise((r) => setTimeout(r, 30));
      expect(db.logs).toHaveLength(1);
      expect(progressNow().entries).toHaveLength(1);
    });

    it('below 80 % only the log is written', async () => {
      useLastResult.getState().set(result({ plan: planRef, riddenSec: 130, completed: false }));
      renderSummary();
      await toggle();
      await waitFor(() => expect(db.logs).toHaveLength(1));
      await new Promise((r) => setTimeout(r, 30));
      expect(db.progressPuts).toHaveLength(0);
    });

    it('turning the toggle off removes the entry and on writes it again', async () => {
      useLastResult.getState().set(result({ plan: planRef }));
      renderSummary();
      const sw = await toggle();
      await waitFor(() => expect(progressNow().entries).toHaveLength(1));
      fireEvent.click(sw);
      await waitFor(() => expect(progressNow().entries).toHaveLength(0));
      fireEvent.click(sw);
      await waitFor(() => expect(progressNow().entries).toHaveLength(1));
      expect(db.logs).toHaveLength(1);
    });

    it('turning the toggle off restores the entry it replaced', async () => {
      const earlier: ProgressEntry = {
        week: 1,
        slot: 'progres',
        workoutId: 'earlier',
        status: 'done',
        at: '2026-02-01T00:00:00.000Z',
      };
      db.progress = [freshProgress([earlier])];
      useLastResult.getState().set(result({ plan: planRef }));
      renderSummary();
      const sw = await toggle();
      await waitFor(() => expect(progressNow().entries[0]?.workoutId).toBe(progresWorkout.id));
      fireEvent.click(sw);
      await waitFor(() => expect(progressNow().entries).toEqual([earlier]));
    });

    it('StrictMode writes the log and the entry once', async () => {
      useLastResult.getState().set(result({ plan: planRef }));
      renderSummary(true);
      await toggle();
      await waitFor(() => expect(db.progressPuts).toHaveLength(1));
      await new Promise((r) => setTimeout(r, 30));
      expect(db.logs).toHaveLength(1);
      expect(db.progressPuts).toHaveLength(1);
    });

    it('the buttons only navigate, even when double clicked', async () => {
      useLastResult.getState().set(result({ plan: planRef }));
      renderSummary(true);
      await toggle();
      await waitFor(() => expect(db.progressPuts).toHaveLength(1));
      const btn = screen.getByRole('button', { name: 'Back to plan' });
      fireEvent.click(btn);
      fireEvent.click(btn);
      await screen.findByTestId('where');
      await new Promise((r) => setTimeout(r, 30));
      expect(db.logs).toHaveLength(1);
      expect(db.progressPuts).toHaveLength(1);
    });

    it('Ride again goes back to setup with the same plan query', async () => {
      useLastResult.getState().set(result({ plan: { ...planRef, week: 2 } }));
      renderSummary();
      await toggle();
      fireEvent.click(screen.getByRole('button', { name: 'Ride again' }));
      expect(await screen.findByTestId('where')).toHaveTextContent(
        `/setup/${progresWorkout.id}?plan=${plan.id}&week=2&slot=progres`,
      );
    });

    it('Ride again keeps a later cycle in the query', async () => {
      useLastResult.getState().set(result({ plan: { ...planRef, cycle: 2 } }));
      renderSummary();
      await toggle();
      fireEvent.click(screen.getByRole('button', { name: 'Ride again' }));
      expect(await screen.findByTestId('where')).toHaveTextContent('&slot=progres&cycle=2');
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
      await waitFor(() => expect(db.progressPuts).toHaveLength(1));
      expect(db.progressPuts[0]!.entries[0]).toMatchObject({
        slot: 'freestyle',
        workoutId: freestyleWorkout.id,
        status: 'done',
      });
    });

    it('turning off uses the slot the on write resolved, even if the active cycle moved', async () => {
      const loop = builtinPlans.find(
        (p) => p.loop && p.weeks[0]?.sessions.some((x) => x.slot === 'freestyle'),
      ) as Plan;
      const entries: ProgressEntry[] = loop.weeks.flatMap((w, i) =>
        w.sessions
          .filter((x) => !(i === 0 && x.slot === 'freestyle'))
          .map((x) => ({
            week: i + 1,
            slot: x.slot,
            workoutId: x.workoutId,
            status: 'done' as const,
            at: '2026-02-01T00:00:00.000Z',
          })),
      );
      db.settings = { ...DEFAULT_SETTINGS, activePlanId: loop.id };
      db.progress = [{ ...freshProgress(entries), id: loop.id, planId: loop.id }];
      useLastResult.getState().set(result({ workout: freestyleWorkout }));
      renderSummary();
      const sw = await toggle();
      // Counting closes cycle 1, so a recomputed cycle would now be 2.
      await waitFor(() => expect(db.progressPuts).toHaveLength(1));
      expect(db.progressPuts[0]!.entries).toHaveLength(entries.length + 1);
      fireEvent.click(sw);
      await waitFor(() => expect(db.progressPuts).toHaveLength(2));
      expect(db.progressPuts[1]!.entries).toHaveLength(entries.length);
    });

    it('off removes nothing when the on write failed before it captured the entry', async () => {
      db.failGetNo = 2; // 1st get loads the screen, 2nd is the on write
      useLastResult.getState().set(result({ plan: planRef }));
      renderSummary();
      const sw = await toggle();
      await waitFor(() => expect(db.gets).toBeGreaterThanOrEqual(2));
      fireEvent.click(sw);
      await new Promise((r) => setTimeout(r, 50));
      expect(db.progressPuts).toHaveLength(0);
    });

    describe('looping plan', () => {
      const loop = builtinPlans.find((p) => p.loop) as Plan;
      const allDone = (): ProgressEntry[] =>
        loop.weeks.flatMap((w, i) =>
          w.sessions.map((s) => ({
            week: i + 1,
            slot: s.slot,
            workoutId: s.workoutId,
            status: 'done' as const,
            at: '2026-02-01T00:00:00.000Z',
          })),
        );
      const first = loop.weeks[0]!.sessions[0]!;
      const startedIn = (cycle: number) =>
        result({
          workout: builtinWorkouts.find((w) => w.id === first.workoutId)!,
          plan: { planId: loop.id, week: 1, slot: first.slot, cycle },
        });

      beforeEach(() => {
        db.settings = { ...DEFAULT_SETTINGS, activePlanId: loop.id };
        // Cycle 1 is closed, so cycle 2 is the active pass.
        db.progress = [{ ...freshProgress(allDone()), id: loop.id, planId: loop.id }];
      });

      it('re-riding an older cycle records that cycle, not the current one', async () => {
        useLastResult.getState().set(startedIn(1));
        renderSummary();
        await toggle();
        await waitFor(() => expect(db.progressPuts).toHaveLength(1));
        const entries = db.progressPuts[0]!.entries;
        expect(entries).toHaveLength(allDone().length);
        expect(entries.some((e) => e.cycle === 2)).toBe(false);
      });

      it('a ride started in the current cycle records that cycle', async () => {
        useLastResult.getState().set(startedIn(2));
        renderSummary();
        await toggle();
        await waitFor(() => expect(db.progressPuts).toHaveLength(1));
        expect(db.progressPuts[0]!.entries.filter((e) => e.cycle === 2)).toHaveLength(1);
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

    it('is hidden on a summary restored after a reload, so it cannot overwrite a newer FTP', async () => {
      useLastResult.setState({ result: { ...result({ workout: ramp }), restored: true } });
      renderSummary();
      await screen.findByTestId('summary-name');
      expect(screen.queryByLabelText('Best 1-minute power (W)')).not.toBeInTheDocument();
      expect(screen.queryByTestId('ftp-card')).not.toBeInTheDocument();
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

    it('20-minute test: asks for the 20-minute average and proposes 95 %', async () => {
      useLastResult.getState().set(result({ workout: twenty }));
      renderSummary();
      fireEvent.change(await screen.findByLabelText('20-minute average power (W)'), {
        target: { value: '300' },
      });
      expect(screen.getByTestId('ftp-proposal')).toHaveTextContent('285 W');
      fireEvent.click(screen.getByRole('button', { name: 'Save FTP' }));
      await waitFor(() => expect(db.playerPuts).toHaveLength(1));
      expect(db.playerPuts[0]).toEqual({ ...mirek, ftp: 285 });
    });

    it('2 x 8 test: asks for both efforts and proposes 90 % of their mean', async () => {
      useLastResult.getState().set(result({ workout: twoByEight }));
      renderSummary();
      const first = await screen.findByLabelText('Effort 1 average power (W)');
      fireEvent.change(first, { target: { value: '300' } });
      expect(screen.queryByTestId('ftp-proposal')).not.toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Effort 2 average power (W)'), {
        target: { value: '280' },
      });
      expect(screen.getByTestId('ftp-proposal')).toHaveTextContent('261 W');
    });

    it('is hidden for the 20-minute test when the equipment shows no watts', async () => {
      db.settings = {
        ...DEFAULT_SETTINGS,
        equipment: { ...DEFAULT_SETTINGS.equipment, showsWatts: false },
      };
      useLastResult.getState().set(result({ workout: twenty }));
      renderSummary();
      await screen.findByTestId('summary-name');
      expect(screen.queryByTestId('ftp-card')).not.toBeInTheDocument();
    });

    it('rounds the proposal', async () => {
      useLastResult.getState().set(result({ workout: ramp }));
      renderSummary();
      fireEvent.change(await best(), { target: { value: '333' } });
      expect(screen.getByTestId('ftp-proposal')).toHaveTextContent('250 W');
    });

    it('shows the formula with the numbers, live', async () => {
      useLastResult.getState().set(result({ workout: ramp }));
      renderSummary();
      fireEvent.change(await best(), { target: { value: '700' } });
      expect(screen.getByTestId('ftp-proposal')).toHaveTextContent('FTP = 700 × 0.75 = 525 W');
    });

    it('2 x 8 formula shows the mean of both efforts', async () => {
      useLastResult.getState().set(result({ workout: twoByEight }));
      renderSummary();
      fireEvent.change(await screen.findByLabelText('Effort 1 average power (W)'), {
        target: { value: '300' },
      });
      fireEvent.change(screen.getByLabelText('Effort 2 average power (W)'), {
        target: { value: '280' },
      });
      expect(screen.getByTestId('ftp-proposal')).toHaveTextContent(
        'FTP = (300 + 280) / 2 × 0.9 = 261 W',
      );
    });

    it('warns at once, as an error, when the result is outside 50-600', async () => {
      useLastResult.getState().set(result({ workout: ramp }));
      renderSummary();
      fireEvent.change(await best(), { target: { value: '20' } });
      const warn = screen.getByTestId('ftp-range-warning');
      expect(warn).toHaveAttribute('role', 'alert');
      expect(warn).toHaveTextContent('15 W');
      expect(warn).toHaveTextContent('50 to 600');
      fireEvent.change(await best(), { target: { value: '400' } });
      expect(screen.queryByTestId('ftp-range-warning')).toBeNull();
    });

    it('shows no proposal for a non-integer reading', async () => {
      useLastResult.getState().set(result({ workout: ramp }));
      renderSummary();
      fireEvent.change(await best(), { target: { value: '333.5' } });
      expect(screen.queryByTestId('ftp-proposal')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Save FTP' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('whole number');
      expect(db.playerPuts).toHaveLength(0);
    });

    it('asks to choose a rider when none is selected', async () => {
      db.players = [{ ...mirek, isMe: false }, ania];
      useLastResult.getState().set(result({ workout: ramp }));
      renderSummary();
      fireEvent.change(await best(), { target: { value: '200' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save FTP' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Choose a rider');
      expect(db.playerPuts).toHaveLength(0);
    });

    it('rejects an FTP outside 50-600', async () => {
      useLastResult.getState().set(result({ workout: ramp }));
      renderSummary();
      fireEvent.change(await best(), { target: { value: '1000' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save FTP' }));
      expect((await screen.findAllByRole('alert')).length).toBe(2);
      expect(screen.getAllByRole('alert')[0]).toHaveTextContent('50 to 600');
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
