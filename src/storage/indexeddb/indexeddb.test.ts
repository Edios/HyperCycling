import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bundle as sampleBundle, ride, runRepositoryContract, workout } from '../contract';
import { createIndexedDbRepositories } from './index';

let n = 0;
runRepositoryContract('indexeddb', () => createIndexedDbRepositories(`test-db-${++n}`));

describe('indexeddb replaceAll rollback', () => {
  afterEach(() => vi.restoreAllMocks());

  it('leaves data unchanged when a put fails inside the transaction', async () => {
    const repos = await createIndexedDbRepositories(`rollback-db-${++n}`);
    await repos.workouts.put(workout('keep'));
    await repos.players.put({ id: 'old', name: 'Old', ftp: 200 });
    const before = await repos.exportAll();

    let calls = 0;
    const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['put']>
    ) {
      if (++calls === 3) throw new Error('boom');
      return original.apply(this, args);
    });

    await expect(repos.replaceAll(sampleBundle())).rejects.toThrow('boom');
    vi.restoreAllMocks();

    const after = await repos.exportAll();
    expect({ ...after, exportedAt: '' }).toEqual({ ...before, exportedAt: '' });
    repos.close();
  });
});

describe('indexeddb version 1 → 2 (rides store, T6)', () => {
  it('adds the rides store and keeps the existing data', async () => {
    const name = `upgrade-db-${++n}`;
    // A database as version 1 left it: the first collections and singletons, with data.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        for (const s of ['workouts', 'players', 'planProgress', 'sessionLogs']) {
          d.createObjectStore(s, { keyPath: 'id' });
        }
        d.createObjectStore('singletons');
      };
      req.onsuccess = () => {
        const d = req.result;
        const tx = d.transaction('players', 'readwrite');
        tx.objectStore('players').put({ id: 'p1', name: 'Ola', ftp: 200 });
        tx.oncomplete = () => {
          d.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
    const repos = await createIndexedDbRepositories(name);
    expect(await repos.players.get('p1')).toEqual({ id: 'p1', name: 'Ola', ftp: 200 });
    expect(await repos.rides.list()).toEqual([]);
    await repos.rides.put(ride('r1'));
    expect(await repos.rides.get('r1')).toEqual(ride('r1'));
    repos.close();
  });
});
