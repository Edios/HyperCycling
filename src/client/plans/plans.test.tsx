import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PLAN_SETTINGS,
  type Plan,
  type PlanProgress,
  type PlanSettings,
} from '../../domain/plan';
import type { Player } from '../../domain/player';
import { DEFAULT_SETTINGS, type Settings } from '../../domain/settings';

interface Db {
  settings?: Settings;
  progress: PlanProgress[];
  players: Player[];
  puts: { progress: PlanProgress[]; players: Player[]; settings: Settings[] };
}
const db: Db = { progress: [], players: [], puts: { progress: [], players: [], settings: [] } };

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
          db.puts.progress.push(p);
          return Promise.resolve();
        },
      },
      players: {
        list: () => Promise.resolve(db.players),
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
import { PlanGallery } from './PlanGallery';

const buildForm = builtinPlans.find((p) => p.id === 'build-form') as Plan;
const quickBoost = builtinPlans.find((p) => p.id === 'quick-boost') as Plan;

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}</div>;
}

function renderGallery() {
  return render(
    <MemoryRouter initialEntries={['/plans']}>
      <Routes>
        <Route path="/plans" element={<PlanGallery />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
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

function progressFor(plan: Plan, settings: PlanSettings): PlanProgress {
  return {
    id: plan.id,
    planId: plan.id,
    startedAt: '2026-01-01T00:00:00.000Z',
    settings,
    entries: [],
  };
}

function minutes(testId: string): number {
  return Number.parseInt(screen.getByTestId(testId).textContent ?? '', 10);
}

beforeEach(() => {
  db.settings = undefined;
  db.progress = [];
  db.players = [];
  db.puts = { progress: [], players: [], settings: [] };
  resetSettingsForTests();
});

describe('PlanGallery', () => {
  it('shows a card per plan with meta, load bars and Choose', async () => {
    renderGallery();
    const cards = await screen.findAllByTestId('plan-card');
    expect(cards).toHaveLength(builtinPlans.length);
    const card = cards.find((c) => c.dataset.plan === 'build-form') as HTMLElement;
    expect(within(card).getByRole('heading', { name: 'Build Form' })).toBeInTheDocument();
    expect(card).toHaveTextContent('8 weeks · 2× per week · 45 min');
    expect(within(card).getAllByTestId('load-bar')).toHaveLength(8);
    expect(within(card).getByRole('button', { name: /Choose/ })).toBeInTheDocument();
    expect(within(card).queryByText('Active')).not.toBeInTheDocument();
  });

  it('marks the active plan and offers Customize', async () => {
    db.settings = { ...DEFAULT_SETTINGS, activePlanId: 'build-form' };
    renderGallery();
    await waitFor(() =>
      expect(
        screen.getAllByTestId('plan-card').find((c) => c.dataset.plan === 'build-form'),
      ).toHaveAttribute('data-active', 'true'),
    );
    const card = screen
      .getAllByTestId('plan-card')
      .find((c) => c.dataset.plan === 'build-form') as HTMLElement;
    expect(within(card).getByText('Active')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /Customize/ })).toBeInTheDocument();
  });

  it('filters by level', async () => {
    renderGallery();
    await screen.findAllByTestId('plan-card');
    fireEvent.click(screen.getByRole('button', { name: 'Short' }));
    const shown = screen.getAllByTestId('plan-card');
    expect(shown).toHaveLength(builtinPlans.filter((p) => p.level === 'short').length);
    expect(shown[0]).toHaveAttribute('data-plan', quickBoost.id);
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getAllByTestId('plan-card')).toHaveLength(builtinPlans.length);
  });

  it('has a wizard button in the header', async () => {
    renderGallery();
    await screen.findAllByTestId('plan-card');
    expect(screen.getByRole('link', { name: 'Plan wizard' })).toHaveAttribute(
      'href',
      '/plans/wizard',
    );
  });

  it('Choose opens the plan screen', async () => {
    renderGallery();
    const card = (await screen.findAllByTestId('plan-card')).find(
      (c) => c.dataset.plan === 'build-form',
    ) as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: /Choose/ }));
    expect((await screen.findByTestId('where')).textContent).toBe('/plans/build-form');
  });
});

describe('PlanDetail', () => {
  it('shows the header, load chart with light and test week labels, and week 1 previews', async () => {
    renderDetail();
    expect(await screen.findByRole('heading', { level: 1, name: 'Build Form' })).toBeVisible();
    expect(screen.getByTestId('plan-hours')).toHaveTextContent('~1.5 h');
    const labels = screen.getAllByTestId('load-label').map((l) => l.textContent);
    expect(labels).toHaveLength(8);
    expect(labels[0]).toBe('W1 · test');
    expect(labels[7]).toBe('W8 · test');
    expect(labels[1]).toBe('W2');
    expect(screen.getByTestId('preview-progres')).toHaveTextContent('Progres');
    expect(screen.getByTestId('preview-freestyle')).toHaveTextContent('Freestyle');
    expect(screen.getAllByTestId('profile-chart')).toHaveLength(2);
  });

  it('changing the session length changes the preview minutes', async () => {
    renderDetail();
    await screen.findByTestId('preview-progres');
    fireEvent.click(screen.getByRole('radio', { name: '45 min' }));
    const at45 = minutes('preview-freestyle-minutes');
    const ramp45 = minutes('preview-progres-minutes');
    fireEvent.click(screen.getByRole('radio', { name: '30 min' }));
    const at30 = minutes('preview-freestyle-minutes');
    expect(at30).toBeLessThan(at45);
    // Week 1 is the ramp test: tests are never scaled to the session length.
    expect(minutes('preview-progres-minutes')).toBe(ramp45);
    expect(screen.getByTestId('plan-hours')).toHaveTextContent('~1 h');
  });

  it('the double-progres layout shows two Progres previews', async () => {
    renderDetail();
    await screen.findByTestId('preview-progres');
    fireEvent.click(screen.getByRole('radio', { name: '2 × Progres' }));
    expect(screen.getByTestId('preview-freestyle')).toHaveTextContent('Progres');
  });

  it('Start plan stores fresh progress with the settings and activates the plan', async () => {
    renderDetail();
    await screen.findByTestId('preview-progres');
    fireEvent.click(screen.getByRole('radio', { name: '30 min' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Harder +5%' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start plan' }));
    expect((await screen.findByTestId('where')).textContent).toBe('/');
    expect(db.puts.progress).toHaveLength(1);
    expect(db.puts.progress[0]).toMatchObject({
      planId: 'build-form',
      entries: [],
      settings: { sessionMinutes: 30, difficulty: 5, layout: 'progresFreestyle', startWeek: 1 },
    });
    expect(db.puts.settings.at(-1)?.activePlanId).toBe('build-form');
  });

  it('asks for confirmation when another plan is active and keeps its progress', async () => {
    db.settings = { ...DEFAULT_SETTINGS, activePlanId: quickBoost.id };
    db.progress = [progressFor(quickBoost, DEFAULT_PLAN_SETTINGS)];
    renderDetail();
    await screen.findByTestId('preview-progres');
    fireEvent.click(screen.getByRole('button', { name: 'Start plan' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Quick Boost');
    expect(db.puts.progress).toHaveLength(0);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(db.puts.progress).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Start plan' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start Build Form' }));
    expect((await screen.findByTestId('where')).textContent).toBe('/');
    expect(db.puts.progress.map((p) => p.planId)).toEqual(['build-form']);
    expect(db.puts.settings.at(-1)?.activePlanId).toBe('build-form');
  });

  it('Save changes on the active plan updates its settings and keeps the entries', async () => {
    db.settings = { ...DEFAULT_SETTINGS, activePlanId: buildForm.id };
    const existing = progressFor(buildForm, { ...DEFAULT_PLAN_SETTINGS, sessionMinutes: 60 });
    existing.entries = [
      {
        week: 1,
        slot: 'progres',
        workoutId: 'ramp-test',
        status: 'done',
        at: '2026-01-02T10:00:00.000Z',
      },
    ];
    db.progress = [existing];
    renderDetail();
    await screen.findByTestId('preview-progres');
    expect(screen.getByRole('radio', { name: '60 min' })).toBeChecked();
    expect(screen.queryByRole('button', { name: 'Start plan' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: '30 min' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect((await screen.findByTestId('where')).textContent).toBe('/');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(db.puts.progress[0]?.settings.sessionMinutes).toBe(30);
    expect(db.puts.progress[0]?.entries).toHaveLength(1);
  });

  it('picks a start week', async () => {
    renderDetail();
    await screen.findByTestId('preview-progres');
    fireEvent.click(screen.getByRole('radio', { name: 'Pick a week' }));
    fireEvent.change(screen.getByLabelText('Start week'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start plan' }));
    await screen.findByTestId('where');
    expect(db.puts.progress[0]?.settings.startWeek).toBe(3);
  });

  it('edits the FTP of the "me" player', async () => {
    db.players = [
      { id: 'a', name: 'Other', ftp: 200 },
      { id: 'me', name: 'Me', ftp: 250, isMe: true },
    ];
    renderDetail();
    const input = await screen.findByLabelText('Your FTP (for watts)');
    expect(input).toHaveValue(250);
    expect(screen.getByText(/20-Minute FTP Test/)).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '270' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start plan' }));
    await screen.findByTestId('where');
    expect(db.puts.players).toEqual([{ id: 'me', name: 'Me', ftp: 270, isMe: true }]);
  });

  it('rejects an FTP outside 50 to 600', async () => {
    renderDetail();
    const input = await screen.findByLabelText('Your FTP (for watts)');
    fireEvent.change(input, { target: { value: '5' } });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start plan' })).toBeDisabled();
  });

  it('hides the FTP field and swaps the FTP test when the bike shows no watts', async () => {
    db.settings = {
      ...DEFAULT_SETTINGS,
      equipment: { ...DEFAULT_SETTINGS.equipment, showsWatts: false },
    };
    renderDetail();
    await screen.findByTestId('preview-progres');
    expect(screen.queryByLabelText('Your FTP (for watts)')).not.toBeInTheDocument();
    expect(screen.getByTestId('preview-progres')).not.toHaveTextContent(/FTP test/i);
    expect(screen.getAllByTestId('load-label').map((l) => l.textContent)).not.toContain(
      'W1 · test',
    );
  });

  it('unknown plan id shows a message', async () => {
    renderDetail('nope');
    expect(await screen.findByText('Plan not found.')).toBeInTheDocument();
  });
});
