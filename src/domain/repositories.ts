import type { ExportBundle } from './export-bundle';
import type { PlanProgress } from './plan';
import type { Player } from './player';
import type { ActiveSession, SessionLog } from './session-log';
import type { Settings } from './settings';
import type { Workout } from './workout';

export interface CollectionRepo<T extends { id: string }> {
  list(): Promise<T[]>;
  get(id: string): Promise<T | undefined>;
  put(item: T): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface SingletonRepo<T> {
  get(): Promise<T | undefined>;
  put(v: T): Promise<void>;
  clear(): Promise<void>;
}

export interface Repositories {
  workouts: CollectionRepo<Workout>;
  players: CollectionRepo<Player>;
  planProgress: CollectionRepo<PlanProgress>;
  sessionLogs: CollectionRepo<SessionLog>;
  settings: SingletonRepo<Settings>;
  activeSession: SingletonRepo<ActiveSession>;
  exportAll(): Promise<ExportBundle>;
  replaceAll(b: ExportBundle): Promise<void>;
}
