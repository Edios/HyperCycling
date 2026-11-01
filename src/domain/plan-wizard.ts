import type { Plan, PlanSettings } from './plan';
import { ftpTestKindOf } from './ftp-test';

export type WizardGoal = 'backToForm' | 'buildForm' | 'keepFit' | 'shortOnTime';
export type FtpAnswer = { kind: 'known'; ftp: number } | { kind: 'unknown' } | { kind: 'noWatts' };

export interface WizardAnswers {
  goal: WizardGoal;
  daysPerWeek: 2 | 3;
  minutes: 30 | 45 | 60;
  ftp: FtpAnswer;
}

export interface Recommendation {
  planId: string;
  settings: PlanSettings;
  startsWithTest: boolean;
  reason: { key: string; params: Record<string, string | number> };
  alternativePlanId?: string;
}

export const GOAL_PLAN: Record<WizardGoal, string> = {
  backToForm: 'back-to-form',
  buildForm: 'build-form',
  keepFit: 'keep-fit',
  shortOnTime: 'quick-boost',
};

function alternativeFor(goal: WizardGoal, minutes: number): string | undefined {
  if (goal === 'shortOnTime' && minutes === 60) return 'keep-fit';
  if (goal === 'buildForm' && minutes === 30) return 'quick-boost';
  return undefined;
}

function weekOneHasTest(plan: Plan): boolean {
  return (
    plan.weeks[0]?.sessions.some(
      (s) => s.slot === 'progres' && ftpTestKindOf(s.workoutId) !== undefined,
    ) ?? false
  );
}

/** Maps the wizard answers onto one built-in plan plus its `PlanSettings`; no plan generation. */
export function recommendPlan(answers: WizardAnswers, plans: readonly Plan[]): Recommendation {
  const planId = GOAL_PLAN[answers.goal];
  const plan = plans.find((p) => p.id === planId);
  if (!plan) throw new Error(`Built-in plan not found: ${planId}`);

  const hasTest = weekOneHasTest(plan);
  // Skipping only means something when the plan opens with a test.
  const skip = answers.ftp.kind === 'known' && hasTest;
  const settings: PlanSettings = {
    sessionMinutes: answers.minutes,
    difficulty: 0,
    layout: answers.daysPerWeek === 2 ? 'progresFreestyle' : 'plusFreestyle',
    startWeek: 1,
    ...(skip ? { skipFirstTest: true } : {}),
  };

  let key: string;
  let startsWithTest = false;
  if (answers.ftp.kind === 'noWatts') key = 'wizard.reason.noWatts';
  else if (skip) key = 'wizard.reason.known';
  else if (hasTest) {
    key = 'wizard.reason.test';
    startsWithTest = true;
  } else key = 'wizard.reason.noTest';

  const alternativePlanId = alternativeFor(answers.goal, answers.minutes);
  return {
    planId,
    settings,
    startsWithTest,
    reason: {
      key,
      params: { weeks: plan.weeks.length, days: answers.daysPerWeek, minutes: answers.minutes },
    },
    ...(alternativePlanId ? { alternativePlanId } : {}),
  };
}
