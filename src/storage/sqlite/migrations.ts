import type { Database } from 'better-sqlite3';

/** Each entry upgrades the schema from version `index` to `index + 1`. Append only, never edit. */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE workouts     (id TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE players      (id TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE planProgress (id TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE sessionLogs  (id TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE singletons   (key TEXT PRIMARY KEY, json TEXT NOT NULL);
  `,
];

export function migrate(db: Database): void {
  const current = Number(db.pragma('user_version', { simple: true }));
  if (current > MIGRATIONS.length) {
    throw new Error(
      `Database schema version ${current} is newer than supported version ${MIGRATIONS.length}`,
    );
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    const sql = MIGRATIONS[v] as string;
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}
