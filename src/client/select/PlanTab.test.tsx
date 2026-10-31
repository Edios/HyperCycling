import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PLAN_SETTINGS,
  type Plan,
  type PlanProgress,
  type PlanSettings,
  type ProgressEntry,
} from '../../domain/plan';
import type { SessionLog } from '../../domain/session-log';
import { DEFAULT_SETTINGS, type Settings } from '../../domain/settings';

interface Db {
  settings?: Settings;
  progress: PlanProgress[];
  logs: SessionLog[];
}
const db: Db = { progress: [], logs: [] };

vi.mock('../data/repositories', () => ({
  getRepositories: () =>
    Promise.resolve({
      workouts: { list: () => Promise.resolve([]) },
      settings: { get: () => Promise.resolve(db.settings), put: () => Promise.resolve() },
      planProgress: {
        get: (id: string) => Promise.resolve(db.progress.find((p) => p.planId === id)),
      },
      sessionLogs: { list: () => Promise.resolve(db.logs) },
    }),
}));

vi.setConfig({ testTimeout: 20_000 });

import { builtinPlans, builtinWorkouts } from '../data/builtin';
import { resetSettingsForTests } from '../data/useSettings';
import { PlanTab } from './PlanTab';

const plan = builtinPlans.find((p) => !p.loop) as Plan;

function progressFor(
  entries: ProgressEntry[],
  p: Plan = plan,
  settings: PlanSettings = DEFAULT_PLAN_SETTINGS,
): PlanProgress {
  return {
    id: p.id,
    planId: p.id,
    startedAt: '2026-01-01T00:00:00.000Z',
    settings,
    entries,
  };
}

function entry(
  week: number,
  slot: 'progres' | 'freestyle',
  status: 'done' | 'skipped' = 'done',
  p: Plan = plan,
) {
  const workoutId =
    p.weeks[week - 1]?.sessions.find((s) => s.slot === slot)?.workoutId ?? 'unknown';
  return { week, slot, workoutId, status, at: '2026-01-02T10:00:00.000Z' } as ProgressEntry;
}

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
}

function renderTab() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<PlanTab />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  db.settings = undefined;
  db.progress = [];
  db.logs = [];
  resetSettingsForTests();
});

describe('PlanTab', () => {
  it('without an active plan offers to choose one', async () => {
    renderTab();
    const build = await screen.findByRole('link', { name: 'Build my plan' });
    expect(build).toHaveAttribute('href', '/plans/wizard');
    expect(screen.getByRole('link', { name: 'Browse plans' })).toHaveAttribute('href', '/plans');
    expect(screen.queryByRole('button', { name: 'Ride' })).not.toBeInTheDocument();
  });

  it('in progress shows header, counts, next session and weeks list', async () => {
    db.settings = { ...DEFAULT_SETTINGS, activePlanId: plan.id };
    db.progress = [progressFor([entry(1, 'progres'), entry(1, 'freestyle', 'skipped')])];
    renderTab();

    expect(await screen.findByRole('heading', { level: 1, name: plan.name })).toBeInTheDocument();
    expect(screen.getByText(/Next session · week 2/)).toBeInTheDocument();
    expect(screen.getByTestId('plan-done')).toHaveTextContent(/^2 of 12 sessions$/);
    expect(screen.getByRole('button', { name: 'Ride' })).toBeEnabled();

    const weeks = screen.getByTestId('weeks-list');
    expect(within(weeks).getAllByRole('listitem')).toHaveLength(plan.weeks.length);
    expect(screen.getByTestId('week-2')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByTestId('week-1-progres')).toHaveAttribute('data-status', 'done');
    expect(screen.getByTestId('week-1-freestyle')).toHaveAttribute('data-status', 'skipped');
    expect(screen.getByTestId('week-3-progres')).toHaveAttribute('data-status', 'open');
  });

  it('a fresh plan without stored progress starts at week 1', async () => {
    db.settings = { ...DEFAULT_SETTINGS, activePlanId: plan.id };
    renderTab();
    expect(await screen.findByText(/Next session · week 1/)).toBeInTheDocument();
    expect(screen.getByTestId('plan-done')).toHaveTextContent(/^0 of \d+ sessions$/);
  });

  it('Ride opens setup with the plan, week and slot in the query', async () => {
    db.settings = { ...DEFAULT_SETTINGS, activePlanId: plan.id };
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Ride' }));
    const where = (await screen.findByTestId('where')).textContent ?? '';
    expect(where).toMatch(new RegExp(`^/setup/[^?]+\\?plan=${plan.id}&week=1&slot=progres$`));
  });

  it('a finished plan says so and offers to choose another', async () => {
    db.settings = { ...DEFAULT_SETTINGS, activePlanId: plan.id };
    const entries: ProgressEntry[] = [];
    plan.weeks.forEach((w, i) => w.sessions.forEach((s) => entries.push(entry(i + 1, s.slot))));
    db.progress = [progressFor(entries)];
    renderTab();
    expect(await screen.findByText('Plan complete')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ride' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Choose a plan' })).toHaveAttribute('href', '/plans');
  });

  it('Swap on a freestyle slot lists freestyle workouts and rides the chosen one', async () => {
    db.settings = { ...DEFAULT_SETTINGS, activePlanId: plan.id };
    db.progress = [progressFor([entry(1, 'progres')])];
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Swap' }));
    const dialog = await screen.findByRole('dialog');
    const choices = within(dialog).getAllByRole('button', { name: /min/ });
    expect(choices.length).toBeGreaterThan(10);
    fireEvent.click(choices[0] as HTMLElement);
    await waitFor(() => expect(screen.getByTestId('where')).toBeInTheDocument());
    expect(screen.getByTestId('where').textContent).toMatch(
      new RegExp(`^/setup/[^?]+\\?plan=${plan.id}&week=1&slot=freestyle$`),
    );
  });

  it('Swap on a progres slot is disabled when the week has no alternative', async () => {
    db.settings = { ...DEFAULT_SETTINGS, activePlanId: plan.id };
    renderTab();
    const swap = await screen.findByRole('button', { name: 'Swap' });
    const week = plan.weeks[0];
    const alt = week?.progresAlt;
    const progres = week?.sessions.find((s) => s.slot === 'progres')?.workoutId;
    if (alt === undefined || alt === progres) {
      expect(swap).toBeDisabled();
      // The reason is visible text, not only a tooltip.
      expect(screen.getByTestId('swap-hint')).toHaveTextContent(/no alternative/i);
    } else {
      expect(swap).toBeEnabled();
      expect(screen.queryByTestId('swap-hint')).toBeNull();
    }
  });

  it('shows the last ridden session', async () => {
    db.settings = { ...DEFAULT_SETTINGS, activePlanId: plan.id };
    const w = builtinWorkouts[0];
    if (!w) throw new Error('no workouts');
    db.logs = [
      {
        id: 'l1',
        workoutId: w.id,
        startedAt: '2026-01-05T10:00:00.000Z',
        endedAt: '2026-01-05T10:45:00.000Z',
        riddenSec: 2700,
        completed: true,
        playerIds: [],
        config: { background: 'basic', hud: 'solo', playerIds: [], music: false },
      },
    ];
    renderTab();
    expect(await screen.findByText(new RegExp(`Last: .*${w.name}`))).toBeInTheDocument();
  });

  it('badge follows the slot, not the workout category', async () => {
    db.settings = { ...DEFAULT_SETTINGS, activePlanId: plan.id };
    db.progress = [progressFor([entry(1, 'progres')])];
    renderTab();
    const card = await screen.findByTestId('next-session');
    expect(within(card).getByText('Freestyle')).toBeInTheDocument();
    expect(within(card).queryByText('Progres')).not.toBeInTheDocument();
  });

  it('Swap on a progres slot offers the week alternative when there is one', async () => {
    const bf = builtinPlans.find((p) => p.id === 'build-form') as Plan;
    const alt = bf.weeks[0]?.progresAlt as string;
    db.settings = { ...DEFAULT_SETTINGS, activePlanId: bf.id };
    db.progress = [progressFor([], bf)];
    renderTab();
    const swap = await screen.findByRole('button', { name: 'Swap' });
    expect(swap).toBeEnabled();
    fireEvent.click(swap);
    const dialog = await screen.findByRole('dialog');
    const choices = within(dialog).getAllByRole('button', { name: /min/ });
    expect(choices).toHaveLength(1);
    fireEvent.click(choices[0] as HTMLElement);
    expect((await screen.findByTestId('where')).textContent).toBe(
      `/setup/${alt}?plan=build-form&week=1&slot=progres`,
    );
  });

  it('doubleProgres layout serves the progres alternative in the second slot', async () => {
    const bf = builtinPlans.find((p) => p.id === 'build-form') as Plan;
    const alt = bf.weeks[0]?.progresAlt as string;
    db.settings = { ...DEFAULT_SETTINGS, activePlanId: bf.id };
    db.progress = [
      progressFor([entry(1, 'progres', 'done', bf)], bf, {
        ...DEFAULT_PLAN_SETTINGS,
        layout: 'doubleProgres',
      }),
    ];
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Ride' }));
    expect((await screen.findByTestId('where')).textContent).toBe(
      `/setup/${alt}?plan=build-form&week=1&slot=freestyle`,
    );
  });

  it('a looping plan starts its next cycle after a full pass', async () => {
    const loop = builtinPlans.find((p) => p.loop) as Plan;
    db.settings = { ...DEFAULT_SETTINGS, activePlanId: loop.id };
    const entries: ProgressEntry[] = [];
    loop.weeks.forEach((w, i) =>
      w.sessions.forEach((s) => entries.push(entry(i + 1, s.slot, 'done', loop))),
    );
    db.progress = [progressFor(entries, loop)];
    renderTab();
    expect(await screen.findByText(/Next session · week 1/)).toBeInTheDocument();
    expect(screen.queryByText('Plan complete')).not.toBeInTheDocument();
    expect(screen.getByTestId('week-1')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByTestId('plan-done')).toHaveTextContent(/^0 of \d+ sessions$/);
  });
});
