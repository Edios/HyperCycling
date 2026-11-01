import { beforeEach, describe, expect, it } from 'vitest';
import type { ExportBundle } from '../domain/export-bundle';
import type { PlanProgress } from '../domain/plan';
import type { Player } from '../domain/player';
import type { CollectionRepo, Repositories } from '../domain/repositories';
import type { ActiveSession, SessionLog } from '../domain/session-log';
import { DEFAULT_SETTINGS, type SessionConfig, type Settings } from '../domain/settings';
import type { Workout } from '../domain/workout';

const session: SessionConfig = {
  background: 'basic',
  hud: 'solo',
  playerIds: ['p1'],
  music: false,
};

export function workout(id: string, name = `Workout ${id}`): Workout {
  return {
    id,
    name,
    description: 'fixture',
    category: 'progres',
    tags: ['test'],
    source: { kind: 'user' },
    blocks: [
      { kind: 'steady', id: `${id}-warm`, durationSec: 300, intensity: { effort: 2 } },
      {
        kind: 'repeat',
        id: `${id}-rep`,
        times: 3,
        blocks: [
          {
            kind: 'steady',
            id: `${id}-hard`,
            durationSec: 60,
            intensity: { ftpPct: 105 },
            cue: 'Push!',
          },
          { kind: 'steady', id: `${id}-easy`, durationSec: 60, intensity: { effort: 2 } },
        ],
      },
    ],
    musicCues: [
      {
        blockId: `${id}-hard`,
        rep: 2,
        track: { provider: 'youtube', id: 'abc', title: 'Song', startAtSec: 10 },
      },
    ],
    fallbackPlaylist: [],
    schemaVersion: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const player = (id: string, name: string, ftp: number): Player => ({ id, name, ftp });

const progress = (id: string): PlanProgress => ({
  id,
  planId: id,
  startedAt: '2026-01-01T00:00:00.000Z',
  settings: { sessionMinutes: 45, difficulty: 0, layout: 'progresFreestyle', startWeek: 1 },
  entries: [
    { week: 1, slot: 'progres', workoutId: 'w1', status: 'done', at: '2026-01-02T00:00:00.000Z' },
  ],
});

const log = (id: string): SessionLog => ({
  id,
  workoutId: 'w1',
  startedAt: '2026-01-01T10:00:00.000Z',
  endedAt: '2026-01-01T10:30:00.000Z',
  riddenSec: 1800,
  completed: true,
  playerIds: ['p1'],
  config: session,
});

const settings = (): Settings => ({ ...DEFAULT_SETTINGS, basicTheme: 'light', sounds: false });

const active = (): ActiveSession => ({
  workoutId: 'w1',
  config: session,
  snapshot: { segmentIndex: 2, workoutElapsedSec: 130, status: 'paused' },
  savedAt: '2026-01-01T10:15:00.000Z',
  plan: { planId: 'plan1', week: 2, slot: 'freestyle' },
});

export function bundle(): ExportBundle {
  return {
    app: 'spinning-tutor',
    schemaVersion: 1,
    exportedAt: '2026-01-01T00:00:00.000Z',
    workouts: [workout('w1'), workout('w2')],
    players: [player('p1', 'Ola', 200), player('p2', 'Bartek', 250)],
    planProgress: [progress('plan1')],
    sessionLogs: [log('l1')],
    settings: settings(),
  };
}

const withoutExportedAt = (b: ExportBundle): Omit<ExportBundle, 'exportedAt'> => {
  const rest: Partial<ExportBundle> = { ...b };
  delete rest.exportedAt;
  return rest as Omit<ExportBundle, 'exportedAt'>;
};

interface CollectionCase {
  label: string;
  repo: (r: Repositories) => CollectionRepo<{ id: string }>;
  make: (id: string) => { id: string };
  changed: (id: string) => { id: string };
  bad: (id: string) => { id: string };
}

// Repos are typed per collection; the contract only needs the shared `{ id }` shape.
const collections: CollectionCase[] = [
  {
    label: 'workouts',
    repo: (r) => r.workouts,
    make: (id) => workout(id),
    changed: (id) => workout(id, 'Renamed'),
    bad: (id) => ({ ...workout(id), name: '' }),
  },
  {
    label: 'players',
    repo: (r) => r.players,
    make: (id) => player(id, 'Ola', 200),
    changed: (id) => player(id, 'Ola', 300),
    bad: (id) => player(id, 'Ola', 9999),
  },
  {
    label: 'planProgress',
    repo: (r) => r.planProgress,
    make: (id) => progress(id),
    changed: (id) => ({ ...progress(id), entries: [] }),
    bad: (id) => ({ ...progress(id), planId: '' }),
  },
  {
    label: 'sessionLogs',
    repo: (r) => r.sessionLogs,
    make: (id) => log(id),
    changed: (id) => ({ ...log(id), riddenSec: 5 }),
    bad: (id) => ({ ...log(id), riddenSec: -1 }),
  },
];

/** Behaviour every storage backend must share. */
export function runRepositoryContract(name: string, makeRepos: () => Promise<Repositories>): void {
  describe(`repository contract: ${name}`, () => {
    let repos: Repositories;
    beforeEach(async () => {
      repos = await makeRepos();
    });

    for (const c of collections) {
      describe(c.label, () => {
        const repo = () => c.repo(repos);

        it('starts empty and returns undefined for unknown ids', async () => {
          expect(await repo().list()).toEqual([]);
          expect(await repo().get('nope')).toBeUndefined();
        });

        it('puts and gets an item round trip', async () => {
          await repo().put(c.make('a'));
          expect(await repo().get('a')).toEqual(c.make('a'));
        });

        it('overwrites an item with the same id', async () => {
          await repo().put(c.make('a'));
          await repo().put(c.changed('a'));
          expect(await repo().get('a')).toEqual(c.changed('a'));
          expect(await repo().list()).toHaveLength(1);
        });

        it('lists sorted by id', async () => {
          for (const id of ['c', 'a', 'b']) await repo().put(c.make(id));
          expect((await repo().list()).map((x) => x.id)).toEqual(['a', 'b', 'c']);
        });

        it('removes an item and tolerates removing an unknown id', async () => {
          await repo().put(c.make('a'));
          await repo().remove('a');
          expect(await repo().get('a')).toBeUndefined();
          await expect(repo().remove('a')).resolves.toBeUndefined();
        });

        it('rejects an invalid item and writes nothing', async () => {
          await expect(repo().put(c.bad('x'))).rejects.toThrow();
          expect(await repo().get('x')).toBeUndefined();
          expect(await repo().list()).toEqual([]);
        });

        it('does not replace a stored item with an invalid one', async () => {
          await repo().put(c.make('x'));
          await expect(repo().put(c.bad('x'))).rejects.toThrow();
          expect(await repo().get('x')).toEqual(c.make('x'));
        });
      });
    }

    describe('settings singleton', () => {
      it('is undefined until set, round trips, overwrites and clears', async () => {
        expect(await repos.settings.get()).toBeUndefined();
        await repos.settings.put(settings());
        expect(await repos.settings.get()).toEqual(settings());
        await repos.settings.put(DEFAULT_SETTINGS);
        expect(await repos.settings.get()).toEqual(DEFAULT_SETTINGS);
        await repos.settings.clear();
        expect(await repos.settings.get()).toBeUndefined();
      });
      it('rejects invalid settings and keeps the stored value', async () => {
        await repos.settings.put(settings());
        await expect(repos.settings.put({ ...settings(), effectsIntensity: 5 })).rejects.toThrow();
        expect(await repos.settings.get()).toEqual(settings());
      });
      it('clear on an empty singleton does not throw', async () => {
        await expect(repos.settings.clear()).resolves.toBeUndefined();
      });
    });

    describe('activeSession singleton', () => {
      it('round trips and clears', async () => {
        expect(await repos.activeSession.get()).toBeUndefined();
        await repos.activeSession.put(active());
        expect(await repos.activeSession.get()).toEqual(active());
        await repos.activeSession.clear();
        expect(await repos.activeSession.get()).toBeUndefined();
      });
      it('rejects an invalid active session and writes nothing', async () => {
        const invalid = { ...active(), snapshot: { ...active().snapshot, segmentIndex: -1 } };
        await expect(repos.activeSession.put(invalid)).rejects.toThrow();
        expect(await repos.activeSession.get()).toBeUndefined();
      });
      it('is independent from settings', async () => {
        await repos.settings.put(settings());
        await repos.activeSession.put(active());
        await repos.settings.clear();
        expect(await repos.activeSession.get()).toEqual(active());
      });
    });

    describe('exportAll / replaceAll', () => {
      it('exports an empty store with null settings', async () => {
        const b = await repos.exportAll();
        expect(b).toMatchObject({
          app: 'spinning-tutor',
          schemaVersion: 1,
          workouts: [],
          players: [],
          planProgress: [],
          sessionLogs: [],
          settings: null,
        });
        expect(typeof b.exportedAt).toBe('string');
      });

      it('exports everything that was stored', async () => {
        const src = bundle();
        await repos.workouts.put(workout('w2'));
        await repos.workouts.put(workout('w1'));
        for (const p of src.players) await repos.players.put(p);
        for (const p of src.planProgress) await repos.planProgress.put(p);
        for (const l of src.sessionLogs) await repos.sessionLogs.put(l);
        await repos.settings.put(settings());
        await repos.activeSession.put(active());
        const out = await repos.exportAll();
        expect(withoutExportedAt(out)).toEqual(withoutExportedAt(src));
      });

      it('export then replaceAll on a fresh store then export is deep equal', async () => {
        await repos.replaceAll(bundle());
        const first = await repos.exportAll();
        const fresh = await makeRepos();
        await fresh.replaceAll(first);
        const second = await fresh.exportAll();
        expect(withoutExportedAt(second)).toEqual(withoutExportedAt(first));
        expect(withoutExportedAt(second)).toEqual(withoutExportedAt(bundle()));
      });

      it('replaceAll removes items absent from the bundle and clears settings when null', async () => {
        await repos.replaceAll(bundle());
        await repos.workouts.put(workout('extra'));
        await repos.sessionLogs.put(log('extra'));
        await repos.replaceAll({
          ...bundle(),
          workouts: [workout('w1')],
          players: [],
          sessionLogs: [],
          planProgress: [],
          settings: null,
        });
        expect((await repos.workouts.list()).map((w) => w.id)).toEqual(['w1']);
        expect(await repos.players.list()).toEqual([]);
        expect(await repos.sessionLogs.list()).toEqual([]);
        expect(await repos.planProgress.list()).toEqual([]);
        expect(await repos.settings.get()).toBeUndefined();
      });

      it('rejects an invalid bundle and leaves existing data untouched', async () => {
        await repos.replaceAll(bundle());
        const before = withoutExportedAt(await repos.exportAll());
        const broken = bundle();
        broken.players = [player('p9', 'Zed', 200), player('p10', 'Bad', 9999)];
        broken.workouts = [];
        await expect(repos.replaceAll(broken)).rejects.toThrow();
        expect(withoutExportedAt(await repos.exportAll())).toEqual(before);
      });

      it('rejects a bundle with the wrong schemaVersion', async () => {
        await repos.replaceAll(bundle());
        const before = withoutExportedAt(await repos.exportAll());
        const wrong = { ...bundle(), schemaVersion: 2 } as unknown as ExportBundle;
        await expect(repos.replaceAll(wrong)).rejects.toThrow();
        expect(withoutExportedAt(await repos.exportAll())).toEqual(before);
      });

      it('rejects duplicate ids in a bundle collection and leaves data untouched', async () => {
        await repos.replaceAll(bundle());
        const before = withoutExportedAt(await repos.exportAll());
        const dup = bundle();
        dup.players = [player('p1', 'Ola', 200), player('p1', 'Other', 210)];
        await expect(repos.replaceAll(dup)).rejects.toThrow(/duplicate id "p1" in players/);
        expect(withoutExportedAt(await repos.exportAll())).toEqual(before);
      });

      it('clears the active session when replacing data', async () => {
        await repos.activeSession.put(active());
        await repos.replaceAll(bundle());
        expect(await repos.activeSession.get()).toBeUndefined();
      });
    });
  });
}
