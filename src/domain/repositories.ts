import type { ExportBundle } from './export-bundle';
import type { PlanProgress } from './plan';
import type { Player } from './player';
import type { RideRecord } from './ride';
import type { ActiveSession, SessionLog } from './session-log';
import type { Settings } from './settings';
import type { SongFeedbackRecord } from './song-feedback';
import type { OwnTrackRecord } from './soundtrack-own';
import type { SoundtrackPlanRecord } from './soundtrack-store';
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
  /**
   * Recorded rides with sensor data (T6). Kept out of exportAll / replaceAll: heart rate is health
   * data, so it never travels in the general backup (a ride is exported on its own).
   */
  rides: CollectionRepo<RideRecord>;
  /**
   * The music plan the rider confirmed, one per workout (id = workout id). Unlike rides it is not
   * health data, so it travels in exportAll / replaceAll (a backup of an older build has none:
   * replaceAll then leaves the plans alone).
   */
  soundtrackPlans: CollectionRepo<SoundtrackPlanRecord>;
  /**
   * The rider's own songs (a YouTube link and a typed tempo, id = `own-` + video id). Like the
   * plans, they travel in exportAll / replaceAll, and a backup without them leaves them alone.
   */
  ownTracks: CollectionRepo<OwnTrackRecord>;
  /** The owner's per-song thumbs during rides (spec §9 J); travels in the backup like the plans. */
  songFeedback: CollectionRepo<SongFeedbackRecord>;
  settings: SingletonRepo<Settings>;
  activeSession: SingletonRepo<ActiveSession>;
  exportAll(): Promise<ExportBundle>;
  replaceAll(b: ExportBundle): Promise<void>;
}
