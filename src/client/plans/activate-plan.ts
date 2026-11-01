import type { Plan, PlanProgress, PlanSettings } from '../../domain/plan';
import { newId } from '../../domain/ids';
import type { Player } from '../../domain/player';
import { getRepositories } from '../data/repositories';
import { updateSettings } from '../data/useSettings';

export interface ActivatePlanArgs {
  plan: Plan;
  settings: PlanSettings;
  /** `keep` retains stored entries (only the settings change); `reset` starts the plan over. */
  mode: 'keep' | 'reset';
  /** Saved to the "me" player (created when missing) before the plan is written. */
  ftp?: number;
  /** Display name for a newly created "me" player. */
  meName?: string;
  currentActiveId?: string;
}

/**
 * Writes the FTP of the isMe player (re-read from storage so there is never a second one).
 * Returns a function that puts the previous state back.
 */
async function saveFtp(ftp: number, meName: string): Promise<() => Promise<void>> {
  const repos = await getRepositories();
  const mine = (await repos.players.list()).find((p) => p.isMe);
  const player: Player = mine ? { ...mine, ftp } : { id: newId(), name: meName, ftp, isMe: true };
  await repos.players.put(player);
  return async () => {
    if (mine) await repos.players.put(mine);
    else await repos.players.remove(player.id);
  };
}

/**
 * Makes `plan` the active plan with `settings`. In reset mode the plan is activated first and the old
 * progress erased last, and the previous active plan is restored when the write fails, so a failure
 * never leaves erased progress behind. A saved FTP is rolled back too. Throws on failure.
 */
export async function activatePlan(args: ActivatePlanArgs): Promise<void> {
  const { plan, settings, mode, ftp, meName = 'Me', currentActiveId } = args;
  let activated = false;
  let undoFtp: (() => Promise<void>) | undefined;
  try {
    const repos = await getRepositories();
    if (ftp !== undefined) undoFtp = await saveFtp(ftp, meName);
    const existing = mode === 'keep' ? await repos.planProgress.get(plan.id) : undefined;
    const progress: PlanProgress = existing
      ? { ...existing, settings }
      : {
          id: plan.id,
          planId: plan.id,
          startedAt: new Date().toISOString(),
          settings,
          entries: [],
        };
    if (mode === 'reset') {
      await updateSettings({ activePlanId: plan.id });
      activated = true;
      await repos.planProgress.put(progress);
    } else {
      await repos.planProgress.put(progress);
      if (currentActiveId !== plan.id) await updateSettings({ activePlanId: plan.id });
    }
  } catch (err) {
    if (activated) {
      await updateSettings({ activePlanId: currentActiveId }).catch((e: unknown) =>
        console.warn('Restoring the active plan failed', e),
      );
    }
    await undoFtp?.().catch((e: unknown) => console.warn('Restoring the FTP failed', e));
    throw err;
  }
}
