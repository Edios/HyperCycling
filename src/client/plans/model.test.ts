import { describe, expect, it } from 'vitest';
import type { Plan } from '../../domain/plan';
import { DEFAULT_SETTINGS } from '../../domain/settings';
import { builtinPlans } from '../data/builtin';
import {
  hoursPerWeek,
  loadColor,
  loadHeightPct,
  matchesFilter,
  planLoad,
  testWeeks,
} from './model';

const buildForm = builtinPlans.find((p) => p.id === 'build-form') as Plan;

describe('plans model', () => {
  it('filters by level', () => {
    expect(matchesFilter(buildForm, 'all')).toBe(true);
    expect(matchesFilter(buildForm, 'intermediate')).toBe(true);
    expect(matchesFilter(buildForm, 'beginner')).toBe(false);
  });

  it('computes a load per week', () => {
    const load = planLoad(buildForm);
    expect(load).toHaveLength(buildForm.weeks.length);
    expect(Math.max(...load)).toBeGreaterThan(0);
  });

  it('colors light weeks blue and heavy weeks warm', () => {
    expect(loadColor(5, 20, true)).toBe('var(--z3)');
    expect(loadColor(20, 20, false)).toBe('var(--z8)');
    expect(loadColor(15, 20, false)).toBe('var(--z7)');
    expect(loadColor(5, 20, false)).toBe('var(--z5)');
    expect(loadColor(0, 0, false)).toBe('var(--z5)');
  });

  it('keeps a stub height for empty weeks', () => {
    expect(loadHeightPct(0, 20)).toBe(8);
    expect(loadHeightPct(10, 20)).toBe(50);
    expect(loadHeightPct(0, 0)).toBe(8);
  });

  it('rounds weekly hours to half an hour', () => {
    expect(hoursPerWeek(45, 'progresFreestyle')).toBe(1.5);
    expect(hoursPerWeek(30, 'progresFreestyle')).toBe(1);
    expect(hoursPerWeek(60, 'plusFreestyle')).toBe(3);
  });

  it('finds the ramp-test weeks and drops them without watts', () => {
    const weeks = testWeeks(buildForm, DEFAULT_SETTINGS.equipment, 'progresFreestyle');
    expect(weeks).toContain(1);
    expect(weeks).toContain(buildForm.weeks.length);
    const none = testWeeks(
      buildForm,
      { ...DEFAULT_SETTINGS.equipment, showsWatts: false },
      'progresFreestyle',
    );
    expect(none).toEqual([]);
  });

  it('does not count week 1 as a test week when the first test is skipped', () => {
    const weeks = testWeeks(buildForm, DEFAULT_SETTINGS.equipment, 'progresFreestyle', true);
    expect(weeks).not.toContain(1);
    expect(weeks).toContain(buildForm.weeks.length);
  });
});
