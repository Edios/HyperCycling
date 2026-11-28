/**
 * Messages between the page and the ride import worker, and the worker's work as a plain
 * function (so tests can run it without a Worker).
 */

import { importRideBytes } from '../../domain/ride-import/read';
import type { RideImportResult } from '../../domain/ride-import/types';

export interface RideImportRequest {
  id: number;
  fileName: string;
  /** The file's bytes, transferred (not copied) to the worker. */
  buffer: ArrayBuffer;
}

export interface RideImportResponse {
  id: number;
  result: RideImportResult;
}

export async function handleRideImportRequest(req: RideImportRequest): Promise<RideImportResponse> {
  return { id: req.id, result: await importRideBytes(req.fileName, new Uint8Array(req.buffer)) };
}

/** The buffers of the series' columns, to hand back without a copy. */
export function transferablesOf(res: RideImportResponse): ArrayBuffer[] {
  if (!res.result.ok) return [];
  const s = res.result.series;
  return [s.power, s.cadence, s.heartRate, s.speed, s.altitude, s.distance].map(
    (c) => c.buffer as ArrayBuffer,
  );
}
