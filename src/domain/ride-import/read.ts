/**
 * The entry point for ride files: picks the reader by the file name (.fit, .tcx, .gpx, each also
 * as .gz), checks the size limits, unpacks gzip, reads the ride and puts it on the 1 Hz axis.
 * Runs in a Web Worker (see `src/client/ride-import`), but is plain code, so it is tested here
 * without one. Nothing leaves the device.
 */

import { readFitRide } from '../fit/read-ride';
import { readGpxRide } from './gpx';
import { normalizeRide } from './normalize';
import { readTcxRide } from './tcx';
import type { RideFormat, RideImportResult, RideReadResult } from './types';

const MB = 1024 * 1024;

/** Largest file per format, unpacked (a 4 hour FIT file is about 0.5-1.5 MB, a TCX 5-15 MB). */
export const RIDE_FILE_LIMITS: Record<RideFormat, number> = {
  fit: 20 * MB,
  tcx: 50 * MB,
  gpx: 50 * MB,
};
/** Largest .gz file before unpacking. */
export const GZIP_FILE_LIMIT = 20 * MB;

const utf8 = new TextDecoder('utf-8');

const READERS: Record<RideFormat, (bytes: Uint8Array) => RideReadResult> = {
  fit: readFitRide,
  tcx: (bytes) => readTcxRide(utf8.decode(bytes)),
  gpx: (bytes) => readGpxRide(utf8.decode(bytes)),
};

export interface RideFileKind {
  format: RideFormat;
  gzip: boolean;
}

/** The ride format of a file name (`ride.fit`, `export.tcx.gz`), or undefined. */
export function rideFileKind(fileName: string): RideFileKind | undefined {
  const m = /\.(fit|tcx|gpx)(\.gz)?$/i.exec(fileName);
  if (!m) return undefined;
  return { format: (m[1] as string).toLowerCase() as RideFormat, gzip: m[2] !== undefined };
}

/** The most bytes a file of this name may have as uploaded. */
export function uploadLimit(kind: RideFileKind): number {
  return kind.gzip ? GZIP_FILE_LIMIT : RIDE_FILE_LIMITS[kind.format];
}

/** Reads a ride file's (unpacked) bytes into a RawRide. Never throws. */
export function readRideBytes(fileName: string, bytes: Uint8Array): RideReadResult {
  const kind = rideFileKind(fileName);
  if (!kind) return { ok: false, error: { code: 'unsupportedType' } };
  if (bytes.length === 0) return { ok: false, error: { code: 'empty' } };
  const limit = RIDE_FILE_LIMITS[kind.format];
  if (bytes.length > limit) return { ok: false, error: { code: 'tooLarge', limit } };
  try {
    return READERS[kind.format](bytes);
  } catch {
    // The readers do not throw by design; this is the last line of defence for a hostile file.
    return { ok: false, error: { code: 'parseFailed' } };
  }
}

/** Unpacks gzip, stopping as soon as the output passes `limit` (a "zip bomb" stays small). */
export async function gunzip(
  bytes: Uint8Array,
  limit: number,
): Promise<
  | { ok: true; bytes: Uint8Array }
  | { ok: false; code: 'gzipUnsupported' | 'gzipFailed' | 'tooLarge' }
> {
  if (typeof DecompressionStream === 'undefined') return { ok: false, code: 'gzipUnsupported' };
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    const stream = new Blob([bytes as BlobPart])
      .stream()
      .pipeThrough(new DecompressionStream('gzip'));
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        return { ok: false, code: 'tooLarge' };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, code: 'gzipFailed' };
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return { ok: true, bytes: out };
}

/** The whole import of one file: limits, gzip, reading and the 1 Hz series. Never throws. */
export async function importRideBytes(
  fileName: string,
  bytes: Uint8Array,
): Promise<RideImportResult> {
  const kind = rideFileKind(fileName);
  if (!kind) return { ok: false, error: { code: 'unsupportedType' } };
  if (bytes.length === 0) return { ok: false, error: { code: 'empty' } };
  const upload = uploadLimit(kind);
  if (bytes.length > upload) return { ok: false, error: { code: 'tooLarge', limit: upload } };

  let plain = bytes;
  if (kind.gzip) {
    const limit = RIDE_FILE_LIMITS[kind.format];
    const unpacked = await gunzip(bytes, limit);
    if (!unpacked.ok) {
      return {
        ok: false,
        error: unpacked.code === 'tooLarge' ? { code: 'tooLarge', limit } : { code: unpacked.code },
      };
    }
    plain = unpacked.bytes;
  }

  const read = readRideBytes(fileName.replace(/\.gz$/i, ''), plain);
  if (!read.ok) return read;
  try {
    const normal = normalizeRide(read.ride);
    if (!normal.ok) return normal;
    return { ...normal, warnings: [...read.warnings, ...normal.warnings] };
  } catch {
    return { ok: false, error: { code: 'parseFailed' } };
  }
}
