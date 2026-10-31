import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAN_SETTINGS, type Plan, type PlanSettings } from '../../domain/plan';
import { DEFAULT_SETTINGS } from '../../domain/settings';
import { builtinPlans, getWorkout } from '../data/builtin';
import { PlanCalendar } from './PlanCalendar';
import { sessionsPerWeek, workoutPeakLevel } from './model';

const buildForm = builtinPlans.find((p) => p.id === 'build-form') as Plan;
const watts = DEFAULT_SETTINGS.equipment;
const noWatts = { ...watts, showsWatts: false };

function renderCal(settings: Partial<PlanSettings> = {}, equipment = watts, plan = buildForm) {
  const cfg = { ...DEFAULT_PLAN_SETTINGS, ...settings };
  render(<PlanCalendar plan={plan} settings={cfg} equipment={equipment} />);
  return cfg;
}

describe('PlanCalendar', () => {
  it.each(['progresFreestyle', 'doubleProgres', 'plusFreestyle'] as const)(
    "renders one row per week with the layout's rides (%s)",
    (layout) => {
      renderCal({ layout });
      const rows = screen.getAllByTestId('calendar-week');
      expect(rows).toHaveLength(buildForm.weeks.length);
      for (const row of rows) {
        const filled =
          within(row).queryAllByTestId('calendar-session').length +
          within(row).queryAllByTestId('calendar-test').length;
        expect(filled).toBe(sessionsPerWeek(layout));
      }
    },
  );

  it('shows the week-1 FTP test of build-form with a Test label', () => {
    renderCal();
    const first = screen.getAllByTestId('calendar-week')[0] as HTMLElement;
    expect(within(first).getByTestId('calendar-test')).toHaveTextContent('Test');
  });

  it('drops the week-1 test when skipFirstTest is set but keeps the later re-test', () => {
    renderCal({ skipFirstTest: true });
    const rows = screen.getAllByTestId('calendar-week');
    expect(within(rows[0] as HTMLElement).queryByTestId('calendar-test')).toBeNull();
    expect(within(rows.at(-1) as HTMLElement).getByTestId('calendar-test')).toBeInTheDocument();
  });

  it('shows the no-watts fallback instead of any test', () => {
    renderCal({}, noWatts);
    expect(screen.queryAllByTestId('calendar-test')).toHaveLength(0);
  });

  it('colours cells by the effort level of the served workout', () => {
    renderCal({ skipFirstTest: true });
    const levels = screen
      .getAllByTestId('calendar-session')
      .map((c) => Number(c.dataset.level))
      .filter(Number.isFinite);
    expect(levels.length).toBeGreaterThan(0);
    for (const l of levels) expect(l).toBeGreaterThanOrEqual(1);
    for (const l of levels) expect(l).toBeLessThanOrEqual(10);
  });

  it('puts rides on Mon/Wed/Fri for three days a week', () => {
    renderCal({ layout: 'plusFreestyle' });
    const row = screen.getAllByTestId('calendar-week')[1] as HTMLElement;
    const cells = within(row).getAllByRole('cell');
    const filled = cells.map((c) => c.dataset.testid !== undefined);
    expect(filled).toEqual([true, false, true, false, true, false, false]);
  });

  it('puts rides on Mon/Thu for two days a week', () => {
    renderCal({ layout: 'progresFreestyle' });
    const row = screen.getAllByTestId('calendar-week')[1] as HTMLElement;
    const filled = within(row)
      .getAllByRole('cell')
      .map((c) => c.dataset.testid !== undefined);
    expect(filled).toEqual([true, false, false, true, false, false, false]);
  });

  it('shows a legend', () => {
    renderCal();
    expect(screen.getByText('FTP test')).toBeInTheDocument();
    expect(screen.getByText('Max')).toBeInTheDocument();
  });
});

describe('workoutPeakLevel', () => {
  it('is higher for threshold work than for an easy ride', () => {
    const easy =
      getWorkout('recovery-spin') ?? getWorkout(buildForm.weeks[0]!.sessions[1]!.workoutId);
    const hard = getWorkout(buildForm.weeks[6]!.sessions[0]!.workoutId);
    expect(easy && hard).toBeTruthy();
    expect(workoutPeakLevel(hard!)).toBeGreaterThanOrEqual(workoutPeakLevel(easy!));
  });
});
