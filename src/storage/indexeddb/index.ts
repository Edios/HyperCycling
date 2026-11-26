import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { APP_ID } from '../../domain/export-bundle';
import type { PlanProgress } from '../../domain/plan';
import type { Player } from '../../domain/player';
import type { RideRecord } from '../../domain/ride';
import type { CollectionRepo, Repositories, SingletonRepo } from '../../domain/repositories';
import type { ActiveSession, SessionLog } from '../../domain/session-log';
import type { Settings } from '../../domain/settings';
import type { OwnTrackRecord } from '../../domain/soundtrack-own';
import type { SoundtrackPlanRecord } from '../../domain/soundtrack-store';
import type { Workout } from '../../domain/workout';
import { byId, schemas, validate, validateBundle } from '../validation';

/**
 * 1: first schema. 2: `rides` store (T6). 3: `soundtrackPlans` store (Soundtrack Match).
 * 4: `ownTracks` store (the rider's own songs, Soundtrack Match PR 6).
 *
 * Upgrades are one way: a browser that opened version 2 cannot be opened by an older build
 * (VersionError). If a change is ever rolled back, never lower this number or remove an upgrade
 * step; ship the rollback as a new, higher version instead. The same holds for the SQLite
 * migrations (an older server refuses a newer database).
 */
const DB_VERSION = 4;
const COLLECTIONS = ['workouts', 'players', 'planProgress', 'sessionLogs'] as const;
type CollectionName = (typeof COLLECTIONS)[number] | 'rides' | 'soundtrackPlans' | 'ownTracks';
/** Exported, and replaced only when a backup has them. */
const SHARED = ['soundtrackPlans', 'ownTracks'] as const;

interface TutorDb extends DBSchema {
  workouts: { key: string; value: Workout };
  players: { key: string; value: Player };
  planProgress: { key: string; value: PlanProgress };
  sessionLogs: { key: string; value: SessionLog };
  rides: { key: string; value: RideRecord };
  soundtrackPlans: { key: string; value: SoundtrackPlanRecord };
  ownTracks: { key: string; value: OwnTrackRecord };
  singletons: { key: string; value: Settings | ActiveSession };
}

type Db = IDBPDatabase<TutorDb>;

function collection<T extends { id: string }>(
  db: Db,
  name: CollectionName,
  parse: (v: unknown) => T,
): CollectionRepo<T> {
  // The store name is a union; the typed idb API cannot index it generically.
  const store = (mode: IDBTransactionMode) =>
    db.transaction(name, mode).objectStore(name) as unknown as {
      getAll(): Promise<T[]>;
      get(id: string): Promise<T | undefined>;
      put(v: T): Promise<unknown>;
      delete(id: string): Promise<void>;
    };
  return {
    async list() {
      return (await store('readonly').getAll()).sort(byId);
    },
    get: (id) => store('readonly').get(id),
    async put(item) {
      const valid = parse(item);
      await store('readwrite').put(valid);
    },
    async remove(id) {
      await store('readwrite').delete(id);
    },
  };
}

function singleton<T extends Settings | ActiveSession>(
  db: Db,
  key: 'settings' | 'activeSession',
  parse: (v: unknown) => T,
): SingletonRepo<T> {
  return {
    async get() {
      return (await db.get('singletons', key)) as T | undefined;
    },
    async put(v) {
      await db.put('singletons', parse(v), key);
    },
    async clear() {
      await db.delete('singletons', key);
    },
  };
}

export async function createIndexedDbRepositories(
  dbName = 'spinning-tutor',
): Promise<Repositories & { close(): void }> {
  const db = await openDB<TutorDb>(dbName, DB_VERSION, {
    blocking(_current, _blocked, event) {
      // another tab wants to upgrade or delete the database: let go of it
      (event.target as IDBDatabase).close();
    },
    upgrade(d, oldVersion) {
      // Versions only add stores: existing data is never touched.
      if (oldVersion < 1) {
        for (const name of COLLECTIONS) d.createObjectStore(name, { keyPath: 'id' });
        d.createObjectStore('singletons');
      }
      if (oldVersion < 2) d.createObjectStore('rides', { keyPath: 'id' });
      if (oldVersion < 3) d.createObjectStore('soundtrackPlans', { keyPath: 'id' });
      if (oldVersion < 4) d.createObjectStore('ownTracks', { keyPath: 'id' });
    },
  });

  return {
    close: () => db.close(),
    workouts: collection(db, 'workouts', (v) => validate('workout', schemas.workouts, v)),
    players: collection(db, 'players', (v) => validate('player', schemas.players, v)),
    planProgress: collection(db, 'planProgress', (v) =>
      validate('plan progress', schemas.planProgress, v),
    ),
    sessionLogs: collection(db, 'sessionLogs', (v) =>
      validate('session log', schemas.sessionLogs, v),
    ),
    rides: collection(db, 'rides', (v) => validate('ride', schemas.rides, v)),
    soundtrackPlans: collection(db, 'soundtrackPlans', (v) =>
      validate('soundtrack plan', schemas.soundtrackPlans, v),
    ),
    ownTracks: collection(db, 'ownTracks', (v) => validate('own song', schemas.ownTracks, v)),
    settings: singleton(db, 'settings', (v) => validate('settings', schemas.settings, v)),
    activeSession: singleton(db, 'activeSession', (v) =>
      validate('active session', schemas.activeSession, v),
    ),

    async exportAll() {
      const tx = db.transaction([...COLLECTIONS, ...SHARED, 'singletons'], 'readonly');
      const [workouts, players, planProgress, sessionLogs, soundtrackPlans, ownTracks, settings] =
        await Promise.all([
          tx.objectStore('workouts').getAll(),
          tx.objectStore('players').getAll(),
          tx.objectStore('planProgress').getAll(),
          tx.objectStore('sessionLogs').getAll(),
          tx.objectStore('soundtrackPlans').getAll(),
          tx.objectStore('ownTracks').getAll(),
          tx.objectStore('singletons').get('settings'),
        ]);
      return {
        app: APP_ID,
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        workouts: workouts.sort(byId),
        players: players.sort(byId),
        planProgress: planProgress.sort(byId),
        sessionLogs: sessionLogs.sort(byId),
        soundtrackPlans: soundtrackPlans.sort(byId),
        ownTracks: ownTracks.sort(byId),
        settings: (settings as Settings | undefined) ?? null,
      };
    },

    async replaceAll(input) {
      const b = validateBundle(input); // fully validated before any write
      const tx = db.transaction([...COLLECTIONS, ...SHARED, 'singletons'], 'readwrite');
      const writes: Promise<unknown>[] = [];
      try {
        for (const name of COLLECTIONS) {
          const store = tx.objectStore(name);
          writes.push(store.clear());
          for (const item of b[name]) writes.push(store.put(item as never));
        }
        // Plans: a backup of an older build has none, and then the plans stay as they are.
        if (b.soundtrackPlans) {
          const plans = tx.objectStore('soundtrackPlans');
          writes.push(plans.clear());
          for (const item of b.soundtrackPlans) writes.push(plans.put(item));
        }
        if (b.ownTracks) {
          const own = tx.objectStore('ownTracks');
          writes.push(own.clear());
          for (const item of b.ownTracks) writes.push(own.put(item));
        }
        const singletons = tx.objectStore('singletons');
        writes.push(
          b.settings ? singletons.put(b.settings, 'settings') : singletons.delete('settings'),
        );
        // a saved session may point at data that no longer exists
        writes.push(singletons.delete('activeSession'));
        await Promise.all(writes);
        await tx.done;
      } catch (err) {
        // a synchronous throw would otherwise let the transaction commit the earlier clear()
        try {
          tx.abort();
        } catch {
          /* already finished or aborted */
        }
        await Promise.allSettled([...writes, tx.done]); // swallow the abort rejections
        throw err;
      }
    },
  };
}
