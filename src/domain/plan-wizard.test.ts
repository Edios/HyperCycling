import { describe, expect, it } from 'vitest';
import { builtinPlans } from '../client/data/builtin';
import { recommendPlan, type WizardAnswers } from './plan-wizard';

const base: WizardAnswers = {
  goal: 'buildForm',
  daysPerWeek: 3,
  minutes: 45,
  ftp: { kind: 'known', ftp: 230 },
};
const rec = (over: Partial<WizardAnswers>) => recommendPlan({ ...base, ...over }, builtinPlans);

describe('recommendPlan', () => {
  it.each([
    ['backToForm', 'back-to-form'],
    ['buildForm', 'build-form'],
    ['keepFit', 'keep-fit'],
    ['shortOnTime', 'quick-boost'],
  ] as const)('maps goal %s to plan %s', (goal, planId) => {
    expect(rec({ goal }).planId).toBe(planId);
  });

  it('maps days to layout and copies minutes', () => {
    expect(rec({ daysPerWeek: 2 }).settings.layout).toBe('progresFreestyle');
    expect(rec({ daysPerWeek: 3 }).settings.layout).toBe('plusFreestyle');
    expect(rec({ minutes: 30 }).settings.sessionMinutes).toBe(30);
    expect(rec({ minutes: 60 }).settings.sessionMinutes).toBe(60);
  });

  it('uses neutral difficulty and starts at week 1', () => {
    const s = rec({}).settings;
    expect(s.difficulty).toBe(0);
    expect(s.startWeek).toBe(1);
  });

  it('known FTP skips the first test', () => {
    const r = rec({ ftp: { kind: 'known', ftp: 230 } });
    expect(r.settings.skipFirstTest).toBe(true);
    expect(r.startsWithTest).toBe(false);
    expect(r.reason.key).toBe('wizard.reason.known');
  });

  it('known FTP on a plan without a week-1 test sets no flag and claims no skipped test', () => {
    const r = rec({ goal: 'keepFit', ftp: { kind: 'known', ftp: 230 } });
    expect(r.settings.skipFirstTest).toBeUndefined();
    expect(r.startsWithTest).toBe(false);
    expect(r.reason.key).toBe('wizard.reason.noTest');
  });

  it('unknown FTP keeps the test for build-form', () => {
    const r = rec({ ftp: { kind: 'unknown' } });
    expect(r.settings.skipFirstTest).toBeFalsy();
    expect(r.startsWithTest).toBe(true);
    expect(r.reason.key).toBe('wizard.reason.test');
  });

  it('unknown FTP on a plan without a week-1 test starts without one', () => {
    const r = rec({ goal: 'keepFit', ftp: { kind: 'unknown' } });
    expect(r.startsWithTest).toBe(false);
    expect(r.reason.key).toBe('wizard.reason.noTest');
  });

  it('a bike without watts falls back and says so', () => {
    const r = rec({ ftp: { kind: 'noWatts' } });
    expect(r.startsWithTest).toBe(false);
    expect(r.reason.key).toBe('wizard.reason.noWatts');
  });

  it('reason params describe the plan', () => {
    const r = rec({});
    expect(r.reason.params).toMatchObject({ days: 3, minutes: 45 });
    expect(r.reason.params.weeks).toBe(
      builtinPlans.find((p) => p.id === 'build-form')?.weeks.length,
    );
  });

  it('suggests alternatives when time does not fit the goal', () => {
    expect(rec({ goal: 'shortOnTime', minutes: 60 }).alternativePlanId).toBe('keep-fit');
    expect(rec({ goal: 'buildForm', minutes: 30 }).alternativePlanId).toBe('quick-boost');
    expect(rec({ goal: 'buildForm', minutes: 45 }).alternativePlanId).toBeUndefined();
    expect(rec({ goal: 'shortOnTime', minutes: 30 }).alternativePlanId).toBeUndefined();
  });

  it('throws when the plan list lacks the recommended plan', () => {
    expect(() => recommendPlan(base, [])).toThrow();
  });
});
