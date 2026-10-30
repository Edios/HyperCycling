import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PLAN_SETTINGS,
  nextSession,
  type Plan,
  type PlanProgress,
  type ProgressEntry,
} from '../../domain/plan';
import type { Player } from '../../domain/player';
import { DEFAULT_SETTINGS, type Settings } from '../../domain/settings';

interface Db {
  settings?: Settings;
  progress: PlanProgress[];
  players: Player[];
  puts: { progress: PlanProgress[]; players: Player[]; settings: Settings[] };
  failProgressPut: boolean;
  /** Players returned by list() after the first call (a player created meanwhile). */
  laterPlayers?: Player[];
  listCalls: number;
}
const db: Db = {
  progress: [],
  players: [],
  puts: { progress: [], players: [], settings: [] },
  failProgressPut: false,
  listCalls: 0,
};

vi.mock('../data/repositories', () => ({
  getRepositories: () =>
    Promise.resolve({
      workouts: { list: () => Promise.resolve([]) },
      settings: {
        get: () => Promise.resolve(db.settings),
        put: (s: Settings) => {
          db.puts.settings.push(s);
          return Promise.resolve();
        },
      },
      planProgress: {
        get: (id: string) => Promise.resolve(db.progress.find((p) => p.planId === id)),
        put: (p: PlanProgress) => {
          if (db.failProgressPut) return Promise.reject(new Error('disk full'));
          db.puts.progress.push(p);
          return Promise.resolve();
        },
      },
      players: {
        list: () => {
          db.listCalls++;
          return Promise.resolve(
            db.listCalls > 1 && db.laterPlayers ? db.laterPlayers : db.players,
          );
        },
        put: (p: Player) => {
          db.puts.players.push(p);
          return Promise.resolve();
        },
      },
    }),
}));

vi.setConfig({ testTimeout: 20_000 });

import { builtinPlans } from '../data/builtin';
import { resetSettingsForTests } from '../data/useSettings';
import { PlanDetail } from './PlanDetail';

const buildForm = builtinPlans.find((p) => p.id === 'build-form') as Plan;
const quickBoost = builtinPlans.find((p) => p.id === 'quick-boost') as Plan;

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function renderDetail(planId = buildForm.id) {
  return render(
    <MemoryRouter initialEntries={[`/plans/${planId}`]}>
      <Routes>
        <Route path="/plans/:planId" element={<PlanDetail />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const doneEntry: ProgressEntry = {
  week: 1,
  slot: 'progres',
  workoutId: 'ramp-test',
  status: 'done',
  at: '2026-01-02T10:00:00.000Z',
};

function withProgress(): PlanProgress {
  return {
    id: buildForm.id,
    planId: buildForm.id,
    startedAt: '2026-01-01T00:00:00.000Z',
    settings: { ...DEFAULT_PLAN_SETTINGS, sessionMinutes: 60 },
    entries: [doneEntry],
  };
}

beforeEach(() => {
  db.settings = undefined;
  db.progress = [];
  db.players = [];
  db.puts = { progress: [], players: [], settings: [] };
  db.failProgressPut = false;
  db.laterPlayers = undefined;
  db.listCalls = 0;
  resetSettingsForTests();
});

describe('PlanDetail progress safety', () => {
  it('Continue reuses the stored entries with the new settings', async () => {
    db.settings = { ...DEFAULT_SETTINGS, activePlanId: quickBoost.id };
    db.progress = [withProgress()];
    renderDetail();
    await screen.findByTestId('preview-progres');
    fireEvent.click(screen.getByRole('radio', { name: '30 min' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start plan' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('1 session done');
    expect(db.puts.progress).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await screen.findByTestId('where');
    expect(db.puts.progress[0]?.entries).toEqual([doneEntry]);
    expect(db.puts.progress[0]?.settings.sessionMinutes).toBe(30);
    expect(db.puts.settings.at(-1)?.activePlanId).toBe('build-form');
  });

  it('Start over needs a second confirmation before erasing', async () => {
    db.progress = [withProgress()];
    renderDetail();
    await screen.findByTestId('preview-progres');
    fireEvent.click(screen.getByRole('button', { name: 'Start plan' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start over' }));
    expect(await screen.findByText(/erases your progress/)).toBeInTheDocument();
    expect(db.puts.progress).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('button', { name: 'Continue' })).toBeInTheDocument();
    expect(db.puts.progress).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Erase and start over' }));
    await screen.findByTestId('where');
    expect(db.puts.progress[0]?.entries).toEqual([]);
  });

  it('a failed save keeps the old active plan and shows an error', async () => {
    db.settings = { ...DEFAULT_SETTINGS, activePlanId: quickBoost.id };
    db.failProgressPut = true;
    renderDetail();
    await screen.findByTestId('preview-progres');
    fireEvent.click(screen.getByRole('button', { name: 'Start plan' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start Build Form' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Couldn’t save the plan');
    expect(db.puts.settings).toHaveLength(0);
    expect(screen.queryByTestId('where')).not.toBeInTheDocument();
  });

  it('FTP is not written on blur, only when committing', async () => {
    db.players = [{ id: 'me', name: 'Me', ftp: 250, isMe: true }];
    renderDetail();
    const input = await screen.findByLabelText('Your FTP (for watts)');
    fireEvent.change(input, { target: { value: '280' } });
    fireEvent.blur(input);
    expect(db.puts.players).toHaveLength(0);
  });

  it('never creates a second "me" player', async () => {
    db.players = [];
    db.laterPlayers = [{ id: 'me', name: 'Me', ftp: 250, isMe: true }];
    renderDetail();
    fireEvent.change(await screen.findByLabelText('Your FTP (for watts)'), {
      target: { value: '260' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start plan' }));
    await screen.findByTestId('where');
    expect(db.puts.players).toEqual([{ id: 'me', name: 'Me', ftp: 260, isMe: true }]);
  });

  it('changing the start week of an active plan keeps entries and the next session follows', async () => {
    db.settings = { ...DEFAULT_SETTINGS, activePlanId: buildForm.id };
    db.progress = [withProgress()];
    renderDetail();
    await screen.findByTestId('preview-progres');
    fireEvent.click(screen.getByRole('radio', { name: 'Pick a week' }));
    fireEvent.change(screen.getByLabelText('Start week'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByTestId('where');
    const saved = db.puts.progress[0] as PlanProgress;
    expect(saved.entries).toEqual([doneEntry]);
    expect(saved.settings.startWeek).toBe(3);
    expect(nextSession(buildForm, saved)?.week).toBe(3);
  });

  it('the preview follows the chosen start week', async () => {
    renderDetail();
    await screen.findByTestId('preview-progres');
    fireEvent.click(screen.getByRole('radio', { name: 'Pick a week' }));
    fireEvent.change(screen.getByLabelText('Start week'), { target: { value: '5' } });
    expect(screen.getByText('Week 5 with your settings')).toBeInTheDocument();
  });

  it('labels a looping plan in the header', async () => {
    renderDetail('keep-fit');
    expect(await screen.findByText(/looping/)).toBeInTheDocument();
  });

  it('Continue on an inactive plan keeps its stored settings and start week', async () => {
    const p = withProgress();
    p.settings = { ...DEFAULT_PLAN_SETTINGS, sessionMinutes: 60, startWeek: 3 };
    db.progress = [p];
    renderDetail();
    await screen.findByTestId('preview-progres');
    expect(screen.getByRole('radio', { name: '60 min' })).toBeChecked();
    expect(screen.getByLabelText('Start week')).toHaveValue('3');
    fireEvent.click(screen.getByRole('button', { name: 'Start plan' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    await screen.findByTestId('where');
    expect(db.puts.progress[0]?.settings).toMatchObject({ sessionMinutes: 60, startWeek: 3 });
    expect(db.puts.progress[0]?.entries).toEqual([doneEntry]);
  });

  it('a failed Start over leaves the old plan active and writes no reset', async () => {
    db.settings = { ...DEFAULT_SETTINGS, activePlanId: quickBoost.id };
    db.progress = [withProgress()];
    db.failProgressPut = true;
    renderDetail();
    await screen.findByTestId('preview-progres');
    fireEvent.click(screen.getByRole('button', { name: 'Start plan' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start over' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Erase and start over' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Couldn’t save the plan');
    expect(db.puts.progress).toHaveLength(0);
    expect(db.puts.settings.at(-1)?.activePlanId).toBe(quickBoost.id);
    expect(screen.queryByTestId('where')).not.toBeInTheDocument();
  });
});
