/**
 * What a ride file (.fit, later .tcx and .gpx) says about the ride, before any clean-up: the
 * samples as the device wrote them (any rate, any gaps), the timer, the laps and a few hints.
 * Every reader produces this; one normalisation step turns it into an even 1 Hz series.
 *
 * Kept out on purpose: device serials, product names, the rider's gender. Positions stay here only
 * so the later steps can work out speed and grade; nothing in this module stores them.
 */

export type RideFormat = 'fit' | 'tcx' | 'gpx';

/** One reading. A field the device did not write (or wrote as "invalid") is left out. */
export interface RawSample {
  /** Unix time in ms. */
  t: number;
  /** Watts. */
  power?: number;
  /** Revolutions per minute (may have a fraction). */
  cadence?: number;
  /** Beats per minute. */
  heartRate?: number;
  /** Metres per second. */
  speed?: number;
  /** Metres above sea level. */
  altitude?: number;
  /** Metres from the start. */
  distance?: number;
  /** Degrees. */
  lat?: number;
  lon?: number;
}

/** The ride's timer: started or stopped at a moment (pauses are the stopped stretches). */
export interface TimerEvent {
  t: number;
  running: boolean;
}

export interface RawLap {
  /** Unix ms. */
  start: number;
  end: number;
}

export type RideSport = 'cycling' | 'running' | 'other';

export interface RideMeta {
  sport?: RideSport;
  /** Indoor or virtual cycling (a trainer). */
  indoor?: boolean;
  /** Unix ms of the start (the file's own value, or the first sample). */
  startedAt?: number;
  /** The maker in general terms ("Garmin", "Wahoo"), never a model or serial. */
  device?: string;
  /** The activity's name, when the file has one. */
  name?: string;
  /** The file's own totals, for a sanity check against the samples. */
  totalTimerSec?: number;
  totalElapsedSec?: number;
  totalDistanceM?: number;
}

/** Values from the device's profile: suggestions for the import form, never saved silently. */
export interface RideHints {
  ftpW?: number;
  hrMaxBpm?: number;
  weightKg?: number;
  age?: number;
}

export interface RawRide {
  format: RideFormat;
  /** In time order. */
  samples: RawSample[];
  /** In time order; empty when the file has no timer events. */
  timer: TimerEvent[];
  laps: RawLap[];
  meta: RideMeta;
  hints: RideHints;
}

export type RideImportErrorCode =
  /** Not a ride file we read (by its name). */
  | 'unsupportedType'
  | 'empty'
  /** Over the size limit for its format (`limit` in bytes). */
  | 'tooLarge'
  /** The bytes are not a FIT file at all, or nothing in it can be read. */
  | 'fitCorrupt'
  /** A FIT plan, course or other non-activity file (`fileType` says which). */
  | 'fitNotActivity'
  /** No timed readings in the file. */
  | 'noSamples'
  /** More readings than a 12 hour ride can have. */
  | 'tooLong'
  /** A reader failed in a way it should not (a bug or a hostile file). */
  | 'parseFailed'
  /** The browser could not read the file. */
  | 'readFailed'
  /** The worker took too long. */
  | 'timeout'
  /** The worker crashed or could not start. */
  | 'workerFailed';

export interface RideImportError {
  code: RideImportErrorCode;
  /** For `tooLarge`: the limit in bytes. */
  limit?: number;
  /** For `fitNotActivity`: the FIT file type number. */
  fileType?: number;
}

export type RideImportWarning =
  /** A FIT checksum did not match, but the records could be read. */
  | 'fitChecksum'
  /** The FIT file ends early or has an unreadable message; what came before it is kept. */
  | 'fitIncomplete'
  /** Some readings had no time and were left out. */
  | 'samplesWithoutTime'
  /** The file is a run or another sport; the import still works. */
  | 'notCycling';

export type RideReadResult =
  | { ok: true; ride: RawRide; warnings: RideImportWarning[] }
  | { ok: false; error: RideImportError };
