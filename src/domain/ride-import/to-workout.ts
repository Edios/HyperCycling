/**
 * Segmented ride -> a Workout like the other importers make (source "import"), ready for the
 * editor: the name from the file (or the file name), a short description with the date and the
 * maker, the tags, and the blocks. Checked against the workout schema. No raw ride data, no
 * positions, no device serial is kept.
 */

import { newId } from '../ids';
import { baseName } from '../parsers/build';
import { workoutSchema, type Block, type Workout } from '../workout';
import type { RideSeries } from './types';

const MAX_NAME = 80;
const MAX_FILE_NAME = 255;

const TEXT = {
  pl: { name: 'Jazda z pliku', ride: (date: string) => `Jazda z ${date}` },
  en: { name: 'Imported ride', ride: (date: string) => `Ride of ${date}` },
} as const;

export interface RideWorkoutOptions {
  fileName?: string;
  lang?: 'pl' | 'en';
  /** Injected clock for `updatedAt` (tests). */
  now?: Date;
}

export function rideToWorkout(
  series: RideSeries,
  blocks: Block[],
  tags: string[],
  opts: RideWorkoutOptions = {},
): Workout | undefined {
  const text = TEXT[opts.lang ?? 'en'];
  const name = (series.meta.name?.trim() || baseName(opts.fileName) || text.name).slice(
    0,
    MAX_NAME,
  );
  const started = series.meta.startedAt;
  const date = started === undefined ? undefined : new Date(started).toISOString().slice(0, 10);
  const description = [date ? text.ride(date) : undefined, series.meta.device]
    .filter(Boolean)
    .join(' · ');
  const workout: Workout = {
    id: newId(),
    name,
    description,
    category: 'freestyle',
    tags: [...new Set(tags)],
    source: opts.fileName
      ? { kind: 'import', file: opts.fileName.slice(0, MAX_FILE_NAME) }
      : { kind: 'import' },
    blocks,
    musicCues: [],
    fallbackPlaylist: [],
    schemaVersion: 1,
    updatedAt: (opts.now ?? new Date()).toISOString(),
  };
  const checked = workoutSchema.safeParse(workout);
  return checked.success ? checked.data : undefined;
}
