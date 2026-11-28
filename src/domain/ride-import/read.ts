/**
 * The entry point for ride files: picks the reader by the file name, checks the size limit and
 * returns a RawRide or a coded error. Runs in a Web Worker (see `src/client/ride-import`), but is
 * a plain function, so it is tested here without one. Nothing leaves the device.
 */

import { readFitRide } from '../fit/read-ride';
import type { RideFormat, RideReadResult } from './types';

const MB = 1024 * 1024;

/** Largest file per format (a 4 hour FIT file is about 0.5-1.5 MB). */
export const RIDE_FILE_LIMITS: Record<RideFormat, number> = {
  fit: 20 * MB,
  tcx: 50 * MB,
  gpx: 50 * MB,
};

/** Formats this build can read (TCX and GPX come next). */
const READERS: Partial<Record<RideFormat, (bytes: Uint8Array) => RideReadResult>> = {
  fit: readFitRide,
};

/** The ride format of a file name, or undefined when it is not a ride file we read. */
export function rideFormatOf(fileName: string): RideFormat | undefined {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase();
  return ext !== undefined && ext in READERS ? (ext as RideFormat) : undefined;
}

/** Reads a ride file's bytes. Never throws. */
export function readRideBytes(fileName: string, bytes: Uint8Array): RideReadResult {
  const format = rideFormatOf(fileName);
  const read = format && READERS[format];
  if (!format || !read) return { ok: false, error: { code: 'unsupportedType' } };
  if (bytes.length === 0) return { ok: false, error: { code: 'empty' } };
  const limit = RIDE_FILE_LIMITS[format];
  if (bytes.length > limit) return { ok: false, error: { code: 'tooLarge', limit } };
  try {
    return read(bytes);
  } catch {
    // The readers do not throw by design; this is the last line of defence for a hostile file.
    return { ok: false, error: { code: 'parseFailed' } };
  }
}
