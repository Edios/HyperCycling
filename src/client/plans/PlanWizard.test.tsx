import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Plan, PlanProgress, PlanSettings } from '../../domain/plan';
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
import { PlanWizard } from './PlanWizard';

const buildForm = builtinPlans.find((p) => p.id === 'build-form') as Plan;

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}</div>;
}

function renderWizard() {
  return render(
    <MemoryRouter initialEntries={['/plans/wizard']}>
      <Routes>
        <Route path="/plans/wizard" element={<PlanWizard />} />
        <Route path="/plans/:planId" element={<PlanDetail />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const SETTINGS: PlanSettings = {
  sessionMinutes: 45,
  difficulty: 0,
  layout: 'plusFreestyle',
  startWeek: 1,
};

function progressFor(plan: Plan, settings: PlanSettings): PlanProgress {
  return {
    id: plan.id,
    planId: plan.id,
    startedAt: '2026-01-01T00:00:00.000Z',
    settings,
    entries: [{ week: 1, slot: 'progres', status: 'done', workoutId: 'x', at: '2026-01-02' }],
  } as unknown as PlanProgress;
}

const next = () => fireEvent.click(screen.getByRole('button', { name: 'Next' }));
const back = () => fireEvent.click(screen.getByRole('button', { name: 'Back' }));

/** Goal -> time -> FTP, leaving the wizard on the FTP step. */
async function toFtpStep(goal = 'Build Form') {
  fireEvent.click(await screen.findByRole('radio', { name: new RegExp(goal) }));
  next();
  next();
}

beforeEach(() => {
  db.settings = undefined;
  db.progress = [];
  db.players = [];
  db.puts = { progress: [], players: [], settings: [] };
  resetSettingsForTests();
});

describe('PlanWizard steps', () => {
  it('shows a five-step bar and the four goals with localized plan names', async () => {
    renderWizard();
    const goals = await screen.findAllByRole('radio');
    expect(goals).toHaveLength(4);
    expect(screen.getByRole('radio', { name: /Build Form/ })).toBeInTheDocument();
    expect(screen.getAllByTestId('wizard-step')).toHaveLength(5);
    expect(screen.getAllByTestId('wizard-step')[0]).toHaveAttribute('aria-current', 'step');
    // Nothing is chosen yet, so there is nothing to go on with.
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('the time step offers 2 or 3 days and 30, 45 or 60 minutes', async () => {
    renderWizard();
    fireEvent.click(await screen.findByRole('radio', { name: /Build Form/ }));
    next();
    expect(screen.getByRole('radio', { name: '2 days' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '3 days' })).toBeInTheDocument();
    for (const m of ['30 min', '45 min', '60 min']) {
      expect(screen.getByRole('radio', { name: m })).toBeInTheDocument();
    }
    expect(screen.getByTestId('wizard-fit')).toHaveTextContent('Build Form');
  });

  it('suggests a better fitting plan for a mismatch and switches to it on request', async () => {
    renderWizard();
    fireEvent.click(await screen.findByRole('radio', { name: /Build Form/ }));
    next();
    fireEvent.click(screen.getByRole('radio', { name: '30 min' }));
    fireEvent.click(screen.getByRole('button', { name: /Quick Boost/ }));
    // The goal changed to "short on time": the fit card names the new plan.
    expect(screen.getByTestId('wizard-fit')).toHaveTextContent('Quick Boost');
  });

  it('prefills the FTP from the "me" player', async () => {
    db.players = [{ id: 'me', name: 'Me', ftp: 245, isMe: true }];
    renderWizard();
    await toFtpStep();
    await waitFor(() => expect(screen.getByRole('spinbutton')).toHaveValue(245));
  });

  it('offers a bike without watts and selects it when the setting says no watts', async () => {
    db.settings = {
      ...DEFAULT_SETTINGS,
      equipment: { ...DEFAULT_SETTINGS.equipment, showsWatts: false },
    };
    renderWizard();
    await toFtpStep();
    expect(screen.getByRole('radio', { name: /Bike without watts/ })).toBeChecked();
  });

  it('keeps the answers when going back and recomputes the plan for a new goal', async () => {
    renderWizard();
    fireEvent.click(await screen.findByRole('radio', { name: /Build Form/ }));
    next();
    fireEvent.click(screen.getByRole('radio', { name: '2 days' }));
    fireEvent.click(screen.getByRole('radio', { name: '60 min' }));
    next();
    back();
    expect(screen.getByRole('radio', { name: '2 days' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '60 min' })).toBeChecked();
    back();
    fireEvent.click(screen.getByRole('radio', { name: /Keep Fit/ }));
    next();
    expect(screen.getByRole('radio', { name: '60 min' })).toBeChecked();
    next();
    next();
    next();
    expect(screen.getByRole('heading', { level: 1, name: 'Keep Fit' })).toBeInTheDocument();
  });
});

describe('PlanWizard heart-rate step', () => {
  it('can be skipped and saves no HRmax', async () => {
    db.players = [{ id: 'me', name: 'Me', ftp: 245, isMe: true }];
    renderWizard();
    await toFtpStep();
    next();
    expect(
      screen.getByRole('heading', { level: 1, name: /heart-rate monitor/ }),
    ).toBeInTheDocument();
    next();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await screen.findByTestId('where');
    expect(db.puts.players).toHaveLength(0);
  });

  it('computes HRmax from age, previews the zones and saves it to the "me" player', async () => {
    db.players = [{ id: 'me', name: 'Me', ftp: 245, isMe: true }];
    renderWizard();
    await toFtpStep();
    next();
    fireEvent.change(screen.getByLabelText('Age'), { target: { value: '36' } });
    fireEvent.click(screen.getByRole('button', { name: 'Suggest from age' }));
    expect(screen.getByLabelText('Max heart rate')).toHaveValue(183);
    expect(screen.getByTestId('hr-preview')).toHaveTextContent('Z3');
    next();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await screen.findByTestId('where');
    expect(db.puts.players.at(-1)).toMatchObject({ isMe: true, hrMax: 183 });
  });

  it('refuses an invalid HRmax', async () => {
    renderWizard();
    await toFtpStep();
    next();
    fireEvent.change(screen.getByLabelText('Max heart rate'), { target: { value: '250' } });
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });
});

describe('PlanWizard recommendation', () => {
  it('shows the plan, a plain reason, the calendar, Start and Customize', async () => {
    renderWizard();
    await toFtpStep();
    next(); // heart-rate step (skipped)
    next();
    expect(screen.getByRole('heading', { level: 1, name: 'Build Form' })).toBeInTheDocument();
    expect(screen.getByTestId('wizard-reason')).toHaveTextContent(/20-minute test/);
    expect(screen.getByTestId('wizard-reason')).not.toHaveTextContent(/[{}]/);
    expect(screen.getByTestId('plan-calendar')).toBeInTheDocument();
    expect(screen.getAllByTestId('calendar-test').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Customize' })).toBeInTheDocument();
  });

  it('Start with no active plan activates it and goes home', async () => {
    renderWizard();
    await toFtpStep();
    next(); // heart-rate step (skipped)
    next();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect((await screen.findByTestId('where')).textContent).toBe('/');
    expect(db.puts.progress).toHaveLength(1);
    expect(db.puts.progress[0]?.planId).toBe('build-form');
    expect(db.puts.settings.at(-1)?.activePlanId).toBe('build-form');
  });

  it('creates a "me" player with the known FTP when there is none', async () => {
    renderWizard();
    await toFtpStep();
    fireEvent.click(screen.getByRole('radio', { name: /Yes, I know it/ }));
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '230' } });
    next(); // heart-rate step (skipped)
    next();
    // A known FTP drops the first test from the calendar.
    expect(screen.getByTestId('wizard-reason')).toHaveTextContent(/230|know/i);
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await screen.findByTestId('where');
    expect(db.puts.players).toHaveLength(1);
    expect(db.puts.players[0]).toMatchObject({ ftp: 230, isMe: true });
    expect(db.puts.progress[0]?.settings.skipFirstTest).toBe(true);
  });

  it('refuses to go on with an invalid FTP', async () => {
    renderWizard();
    await toFtpStep();
    fireEvent.click(screen.getByRole('radio', { name: /Yes, I know it/ }));
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '9999' } });
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('"Bike without watts" turns watts off in the settings on Start and shows no test', async () => {
    renderWizard();
    await toFtpStep();
    fireEvent.click(screen.getByRole('radio', { name: /Bike without watts/ }));
    next(); // heart-rate step (skipped)
    next();
    expect(screen.queryAllByTestId('calendar-test')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await screen.findByTestId('where');
    expect(db.puts.settings.some((s) => s.equipment.showsWatts === false)).toBe(true);
  });

  it('asks before replacing another active plan that has progress', async () => {
    const other = builtinPlans.find((p) => p.id === 'keep-fit') as Plan;
    db.settings = { ...DEFAULT_SETTINGS, activePlanId: other.id };
    db.progress = [progressFor(other, SETTINGS)];
    renderWizard();
    await toFtpStep();
    next(); // heart-rate step (skipped)
    next();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Switch plan?')).toBeInTheDocument();
    expect(db.puts.progress).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: /Start Build Form/ }));
    expect((await screen.findByTestId('where')).textContent).toBe('/');
    expect(db.puts.progress[0]?.planId).toBe('build-form');
  });

  it('asks continue or start over when the chosen plan already has progress', async () => {
    db.progress = [progressFor(buildForm, SETTINGS)];
    renderWizard();
    await toFtpStep();
    next(); // heart-rate step (skipped)
    next();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Start over' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await screen.findByTestId('where');
    expect(db.puts.progress[0]?.entries).toHaveLength(1);
  });

  it('Customize opens the plan screen with the recommended settings', async () => {
    renderWizard();
    fireEvent.click(await screen.findByRole('radio', { name: /Build Form/ }));
    next();
    fireEvent.click(screen.getByRole('radio', { name: '2 days' }));
    fireEvent.click(screen.getByRole('radio', { name: '60 min' }));
    next();
    next();
    next();
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }));
    expect(await screen.findByTestId('customize')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '60 min' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Progres + Freestyle' })).toBeChecked();
  });

  it('Customize hands over the typed FTP, which prefills the plan screen', async () => {
    renderWizard();
    await toFtpStep();
    fireEvent.click(screen.getByRole('radio', { name: /Yes, I know it/ }));
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '231' } });
    next(); // heart-rate step (skipped)
    next();
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }));
    await screen.findByTestId('customize');
    expect(screen.getByDisplayValue('231')).toBeInTheDocument();
  });

  it('Customize after "bike without watts" hides the FTP field on the plan screen', async () => {
    renderWizard();
    await toFtpStep();
    fireEvent.click(screen.getByRole('radio', { name: /Bike without watts/ }));
    next(); // heart-rate step (skipped)
    next();
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }));
    await screen.findByTestId('customize');
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('asks before changing the settings of the active plan that already has entries', async () => {
    db.settings = { ...DEFAULT_SETTINGS, activePlanId: buildForm.id };
    db.progress = [progressFor(buildForm, SETTINGS)];
    renderWizard();
    await toFtpStep();
    next(); // heart-rate step (skipped)
    next();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Continue' })).toBeInTheDocument();
    expect(db.puts.progress).toHaveLength(0);
  });

  it('starts the active plan without asking while it has no entries', async () => {
    db.settings = { ...DEFAULT_SETTINGS, activePlanId: buildForm.id };
    db.progress = [{ ...progressFor(buildForm, SETTINGS), entries: [] }];
    renderWizard();
    await toFtpStep();
    next(); // heart-rate step (skipped)
    next();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await screen.findByTestId('where');
    expect(db.puts.progress).toHaveLength(1);
  });
});
