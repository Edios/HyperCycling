import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PLAN_SETTINGS, type Plan, type PlanProgress } from '../../domain/plan';
import { DEFAULT_SETTINGS, type Settings } from '../../domain/settings';

interface Db {
  settings?: Settings;
  progress: PlanProgress[];
}
const db: Db = { progress: [] };

vi.mock('../data/repositories', () => ({
  getRepositories: () =>
    Promise.resolve({
      workouts: { list: () => Promise.resolve([]) },
      settings: { get: () => Promise.resolve(db.settings), put: () => Promise.resolve() },
      planProgress: {
        get: (id: string) => Promise.resolve(db.progress.find((p) => p.planId === id)),
      },
      sessionLogs: { list: () => Promise.resolve([]) },
    }),
}));

vi.setConfig({ testTimeout: 20_000 });

import { builtinPlans } from '../data/builtin';
import { resetSettingsForTests } from '../data/useSettings';
import { PlanTab } from './PlanTab';

const bf = builtinPlans.find((p) => p.id === 'build-form') as Plan;

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
  resetSettingsForTests();
  db.progress = [
    {
      id: bf.id,
      planId: bf.id,
      startedAt: '2026-01-01T00:00:00.000Z',
      settings: DEFAULT_PLAN_SETTINGS,
      entries: [],
    },
  ];
});

describe('PlanTab and the FTP test', () => {
  it('week 1 of Build Form really is the 20-minute FTP test', () => {
    expect(bf.weeks[0]?.sessions.find((x) => x.slot === 'progres')?.workoutId).toBe('ftp-test-20');
  });

  it('with watts the next session is the FTP test', async () => {
    db.settings = { ...DEFAULT_SETTINGS, activePlanId: bf.id };
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Ride' }));
    expect((await screen.findByTestId('where')).textContent).toBe(
      '/setup/ftp-test-20?plan=build-form&week=1&slot=progres',
    );
  });

  it('without watts the next session and the weeks list use the alternative', async () => {
    db.settings = {
      ...DEFAULT_SETTINGS,
      activePlanId: bf.id,
      equipment: { ...DEFAULT_SETTINGS.equipment, showsWatts: false },
    };
    renderTab();
    const week1 = await screen.findByTestId('week-1-progres');
    expect(week1).not.toHaveTextContent(/FTP test/i);
    expect(screen.getByTestId('week-8-progres')).not.toHaveTextContent(/FTP test/i);
    fireEvent.click(screen.getByRole('button', { name: 'Ride' }));
    expect((await screen.findByTestId('where')).textContent).toBe(
      '/setup/sweet-spot-2x10?plan=build-form&week=1&slot=progres',
    );
  });
});
