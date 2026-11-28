/**
 * Messages between the page and the ride import worker, and the worker's work as a plain
 * function (so tests can run it without a Worker).
 */

import { readRideBytes } from '../../domain/ride-import/read';
import type { RideReadResult } from '../../domain/ride-import/types';

export interface RideImportRequest {
  id: number;
  fileName: string;
  /** The file's bytes, transferred (not copied) to the worker. */
  buffer: ArrayBuffer;
}

export interface RideImportResponse {
  id: number;
  result: RideReadResult;
}

export function handleRideImportRequest(req: RideImportRequest): RideImportResponse {
  return { id: req.id, result: readRideBytes(req.fileName, new Uint8Array(req.buffer)) };
}
