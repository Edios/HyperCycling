import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../domain/settings';
import { runRepositoryContract } from '../contract';
import { createSqliteRepositories } from './index';

const opened: { close(): void }[] = [];
const track = <T extends { close(): void }>(r: T): T => {
  opened.push(r);
  return r;
};
const dir = mkdtempSync(join(tmpdir(), 'spinning-tutor-'));

afterAll(() => {
  for (const r of opened) r.close();
  rmSync(dir, { recursive: true, force: true });
});

runRepositoryContract('sqlite', () => Promise.resolve(track(createSqliteRepositories(':memory:'))));

function pragma(path: string, name: string): unknown {
  const db = new Database(path, { readonly: true });
  try {
    return db.pragma(name, { simple: true });
  } finally {
    db.close();
  }
}

describe('sqlite migrations and persistence', () => {
  it('migrates user_version 0 to the current schema and creates tables', () => {
    const path = join(dir, 'fresh.db');
    new Database(path).close();
    expect(pragma(path, 'user_version')).toBe(0);

    createSqliteRepositories(path).close();

    expect(pragma(path, 'user_version')).toBe(1);
    const check = new Database(path, { readonly: true });
    const tables = check
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => (r as { name: string }).name);
    check.close();
    expect(tables).toEqual(
      expect.arrayContaining(['workouts', 'players', 'planProgress', 'sessionLogs', 'singletons']),
    );
  });

  it('uses WAL mode for file databases', () => {
    const path = join(dir, 'wal.db');
    createSqliteRepositories(path).close();
    expect(pragma(path, 'journal_mode')).toBe('wal');
  });

  it('keeps data when an existing file is reopened', async () => {
    const path = join(dir, 'persist.db');
    const first = createSqliteRepositories(path);
    await first.players.put({ id: 'p1', name: 'Ola', ftp: 200 });
    await first.settings.put(DEFAULT_SETTINGS);
    first.close();

    const second = track(createSqliteRepositories(path));
    expect(await second.players.get('p1')).toEqual({ id: 'p1', name: 'Ola', ftp: 200 });
    expect(await second.settings.get()).toEqual(DEFAULT_SETTINGS);
    expect(pragma(path, 'user_version')).toBe(1);
  });

  it('refuses a database from a newer schema version', () => {
    const path = join(dir, 'future.db');
    const raw = new Database(path);
    raw.pragma('user_version = 99');
    raw.close();
    expect(() => createSqliteRepositories(path)).toThrow(/newer/i);
  });
});
