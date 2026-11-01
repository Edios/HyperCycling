import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bundle as sampleBundle, runRepositoryContract, workout } from '../contract';
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
