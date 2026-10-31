import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PLAN_SETTINGS,
  type Plan,
  type PlanProgress,
  type PlanSettings,
} from '../../domain/plan';
import type { Player } from '../../domain/player';
import type { Settings } from '../../domain/settings';

const log: string[] = [];
const db = {
  progress: undefined as PlanProgress | undefined,
  players: [] as Player[],
  settingsPuts: [] as Settings[],
  putProgress: [] as PlanProgress[],
  failProgress: false,
};

vi.mock('../data/repositories', () => ({
  getRepositories: () =>
    Promise.resolve({
      settings: {
        get: () => Promise.resolve(undefined),
        put: (s: Settings) => {
          log.push(`settings:${s.activePlanId ?? 'none'}`);
          db.settingsPuts.push(s);
          return Promise.resolve();
        },
      },
      planProgress: {
        get: () => Promise.resolve(db.progress),
        put: (p: PlanProgress) => {
          if (db.failProgress) return Promise.reject(new Error('disk full'));
          log.push('progress');
          db.putProgress.push(p);
          return Promise.resolve();
        },
      },
      players: {
        list: () => Promise.resolve(db.players),
        put: (p: Player) => {
          log.push('player');
          db.players = [...db.players.filter((x) => x.id !== p.id), p];
          return Promise.resolve();
        },
      },
    }),
}));

import { builtinPlans } from '../data/builtin';
import { resetSettingsForTests } from '../data/useSettings';
import { activatePlan } from './activate-plan';

const plan = builtinPlans.find((p) => p.id === 'build-form') as Plan;
const cfg: PlanSettings = { ...DEFAULT_PLAN_SETTINGS, sessionMinutes: 30 };

beforeEach(() => {
  log.length = 0;
  Object.assign(db, {
    progress: undefined,
    players: [],
    settingsPuts: [],
    putProgress: [],
    failProgress: false,
  });
  resetSettingsForTests();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('activatePlan', () => {
  it('reset mode activates first, then writes fresh progress', async () => {
    await activatePlan({ plan, settings: cfg, mode: 'reset' });
    expect(log).toEqual(['settings:build-form', 'progress']);
    expect(db.putProgress[0]).toMatchObject({ planId: 'build-form', entries: [], settings: cfg });
  });

  it('restores the previous active plan when the progress write fails', async () => {
    db.failProgress = true;
    await expect(
      activatePlan({ plan, settings: cfg, mode: 'reset', currentActiveId: 'keep-fit' }),
    ).rejects.toThrow('disk full');
    expect(db.settingsPuts.map((s) => s.activePlanId)).toEqual(['build-form', 'keep-fit']);
  });

  it('keep mode retains stored entries and only changes the settings', async () => {
    db.progress = {
      id: plan.id,
      planId: plan.id,
      startedAt: '2026-01-01T00:00:00.000Z',
      settings: DEFAULT_PLAN_SETTINGS,
      entries: [
        {
          week: 1,
          slot: 'progres',
          workoutId: 'x',
          status: 'done',
          at: '2026-01-02T00:00:00.000Z',
        },
      ],
    };
    await activatePlan({ plan, settings: cfg, mode: 'keep' });
    expect(db.putProgress[0]?.entries).toHaveLength(1);
    expect(db.putProgress[0]?.settings).toEqual(cfg);
    expect(log).toEqual(['progress', 'settings:build-form']);
  });

  it('keep mode on the already active plan does not rewrite settings', async () => {
    await activatePlan({ plan, settings: cfg, mode: 'keep', currentActiveId: plan.id });
    expect(db.settingsPuts).toHaveLength(0);
  });

  it('creates a "me" player with the given FTP before the plan is written', async () => {
    await activatePlan({ plan, settings: cfg, mode: 'reset', ftp: 230, meName: 'Me' });
    expect(db.players).toHaveLength(1);
    expect(db.players[0]).toMatchObject({ isMe: true, ftp: 230, name: 'Me' });
    expect(log[0]).toBe('player');
  });

  it('updates the existing "me" player instead of adding a second one', async () => {
    db.players = [{ id: 'p1', name: 'Ola', ftp: 180, isMe: true }];
    await activatePlan({ plan, settings: cfg, mode: 'keep', ftp: 200 });
    expect(db.players).toEqual([{ id: 'p1', name: 'Ola', ftp: 200, isMe: true }]);
  });
});
