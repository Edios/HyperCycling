import Database from 'better-sqlite3';
import type { CollectionRepo, Repositories, SingletonRepo } from '../../domain/repositories';
import type { ActiveSession } from '../../domain/session-log';
import type { Settings } from '../../domain/settings';
import { byId, schemas, validate, validateBundle } from '../validation';
import { migrate } from './migrations';

// Server-only module: never import it from client code (native addon).

const TABLES = ['workouts', 'players', 'planProgress', 'sessionLogs'] as const;
type Table = (typeof TABLES)[number];

export type SqliteRepositories = Repositories & { close(): void };

export function createSqliteRepositories(dbPath: string): SqliteRepositories {
  const db = new Database(dbPath);
  try {
    if (dbPath !== ':memory:') db.pragma('journal_mode = WAL');
    migrate(db);
  } catch (err) {
    db.close();
    throw err;
  }

  const stmts = Object.fromEntries(
    TABLES.map((t) => [
      t,
      {
        all: db.prepare(`SELECT json FROM ${t} ORDER BY id`),
        one: db.prepare(`SELECT json FROM ${t} WHERE id = ?`),
        upsert: db.prepare(
          `INSERT INTO ${t} (id, json, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
        ),
        del: db.prepare(`DELETE FROM ${t} WHERE id = ?`),
        clear: db.prepare(`DELETE FROM ${t}`),
      },
    ]),
  ) as unknown as Record<
    Table,
    {
      all: Database.Statement;
      one: Database.Statement;
      upsert: Database.Statement;
      del: Database.Statement;
      clear: Database.Statement;
    }
  >;
  const singletonGet = db.prepare('SELECT json FROM singletons WHERE key = ?');
  const singletonPut = db.prepare(
    `INSERT INTO singletons (key, json) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET json = excluded.json`,
  );
  const singletonDel = db.prepare('DELETE FROM singletons WHERE key = ?');

  const parseRow = <T>(row: unknown): T => JSON.parse((row as { json: string }).json) as T;
  const now = (): string => new Date().toISOString();

  function collection<T extends { id: string }>(
    table: Table,
    parse: (v: unknown) => T,
  ): CollectionRepo<T> {
    const s = stmts[table];
    return {
      list: async () =>
        s.all
          .all()
          .map((r) => parseRow<T>(r))
          .sort(byId),
      // all methods are async so failures surface as rejections, never synchronous throws
      get: async (id) => {
        const row = s.one.get(id);
        return row === undefined ? undefined : parseRow<T>(row);
      },
      put: async (item) => {
        const valid = parse(item);
        s.upsert.run(valid.id, JSON.stringify(valid), now());
      },
      remove: async (id) => {
        s.del.run(id);
      },
    };
  }

  function singleton<T extends Settings | ActiveSession>(
    key: 'settings' | 'activeSession',
    parse: (v: unknown) => T,
  ): SingletonRepo<T> {
    return {
      get: async () => {
        const row = singletonGet.get(key);
        return row === undefined ? undefined : parseRow<T>(row);
      },
      put: async (v) => {
        singletonPut.run(key, JSON.stringify(parse(v)));
      },
      clear: async () => {
        singletonDel.run(key);
      },
    };
  }

  const workouts = collection('workouts', (v) => validate('workout', schemas.workouts, v));
  const players = collection('players', (v) => validate('player', schemas.players, v));
  const planProgress = collection('planProgress', (v) =>
    validate('plan progress', schemas.planProgress, v),
  );
  const sessionLogs = collection('sessionLogs', (v) =>
    validate('session log', schemas.sessionLogs, v),
  );
  const settings = singleton('settings', (v) => validate('settings', schemas.settings, v));

  const replace = db.transaction((b: ReturnType<typeof validateBundle>) => {
    for (const t of TABLES) {
      stmts[t].clear.run();
      for (const item of b[t]) stmts[t].upsert.run(item.id, JSON.stringify(item), now());
    }
    if (b.settings) singletonPut.run('settings', JSON.stringify(b.settings));
    else singletonDel.run('settings');
  });

  return {
    workouts,
    players,
    planProgress,
    sessionLogs,
    settings,
    activeSession: singleton('activeSession', (v) =>
      validate('active session', schemas.activeSession, v),
    ),

    async exportAll() {
      const read = db.transaction(() => ({
        workouts: db.prepare('SELECT json FROM workouts').all(),
        players: db.prepare('SELECT json FROM players').all(),
        planProgress: db.prepare('SELECT json FROM planProgress').all(),
        sessionLogs: db.prepare('SELECT json FROM sessionLogs').all(),
        settings: singletonGet.get('settings'),
      }));
      const r = read();
      const rows = <T extends { id: string }>(x: unknown[]): T[] =>
        x.map((row) => parseRow<T>(row)).sort(byId);
      return {
        app: 'spinning-tutor',
        schemaVersion: 1,
        exportedAt: now(),
        workouts: rows(r.workouts),
        players: rows(r.players),
        planProgress: rows(r.planProgress),
        sessionLogs: rows(r.sessionLogs),
        settings: r.settings === undefined ? null : parseRow<Settings>(r.settings),
      };
    },

    async replaceAll(input) {
      const b = validateBundle(input); // fully validated before the transaction starts
      replace(b);
    },

    close() {
      db.close();
    },
  };
}
