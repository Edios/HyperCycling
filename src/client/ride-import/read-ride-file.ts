/**
 * Reads a ride file (.fit, .tcx, .gpx, each also as .gz) in a Web Worker and puts it on the
 * 1 Hz axis, so a big file never freezes the page.
 * The size is checked before the file is read; the worker gets the bytes by transfer and is
 * stopped after the answer, an error or a 10 second timeout. Nothing is sent over the network.
 */

import { rideFileKind, uploadLimit } from '../../domain/ride-import/read';
import type { RideImportResult } from '../../domain/ride-import/types';
import type { RideImportRequest, RideImportResponse } from './protocol';

export const RIDE_IMPORT_TIMEOUT_MS = 10_000;

/** The part of a Worker this module uses (a fake in tests). */
export interface WorkerLike {
  onmessage: ((event: MessageEvent<RideImportResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: RideImportRequest, transfer: Transferable[]): void;
  terminate(): void;
}

export interface FileLike {
  name: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface ReadRideFileOptions {
  timeoutMs?: number;
  createWorker?: () => WorkerLike;
}

function startWorker(): WorkerLike {
  return new Worker(new URL('./ride-import.worker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as WorkerLike;
}

let nextId = 1;

export async function readRideFile(
  file: FileLike,
  options: ReadRideFileOptions = {},
): Promise<RideImportResult> {
  const kind = rideFileKind(file.name);
  if (!kind) return { ok: false, error: { code: 'unsupportedType' } };
  const limit = uploadLimit(kind);
  if (file.size > limit) return { ok: false, error: { code: 'tooLarge', limit } };

  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    return { ok: false, error: { code: 'readFailed' } };
  }

  let worker: WorkerLike;
  try {
    worker = (options.createWorker ?? startWorker)();
  } catch {
    return { ok: false, error: { code: 'workerFailed' } };
  }

  const id = nextId++;
  return new Promise<RideImportResult>((resolve) => {
    const finish = (result: RideImportResult) => {
      clearTimeout(timer);
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      resolve(result);
    };
    const timer = setTimeout(
      () => finish({ ok: false, error: { code: 'timeout' } }),
      options.timeoutMs ?? RIDE_IMPORT_TIMEOUT_MS,
    );
    worker.onmessage = (event) => {
      if (event.data.id === id) finish(event.data.result);
    };
    worker.onerror = () => finish({ ok: false, error: { code: 'workerFailed' } });
    worker.postMessage({ id, fileName: file.name, buffer }, [buffer]);
  });
}
