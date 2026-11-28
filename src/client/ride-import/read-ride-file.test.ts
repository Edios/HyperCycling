import { describe, expect, it, vi } from 'vitest';
import { encodeRideToFit } from '../../domain/fit/encode-ride';
import { summarizeRide, type RideRecord } from '../../domain/ride';
import { handleRideImportRequest, type RideImportRequest } from './protocol';
import { readRideFile, type FileLike, type WorkerLike } from './read-ride-file';

function fitBytes(): Uint8Array {
  const samples = {
    timeMs: [1000, 2000],
    power: [200, 210],
    cadence: [90, 91],
    heartRate: [120, 121],
    targetW: [200, 200],
    segmentIndex: [0, 0],
  };
  const ride: RideRecord = {
    id: 'r',
    schemaVersion: 1,
    sessionLogId: 'r',
    workoutId: 'w',
    startedAt: '2026-11-22T08:00:00.000Z',
    endedAt: '2026-11-22T08:00:03.000Z',
    sampleSec: 1,
    ftp: null,
    hrMax: null,
    samples,
    events: [],
    blocks: [],
    summary: summarizeRide(samples, [], null),
  };
  return encodeRideToFit(ride);
}

function file(name: string, bytes: Uint8Array, size = bytes.length): FileLike {
  return {
    name,
    size,
    arrayBuffer: () => Promise.resolve(bytes.slice().buffer),
  };
}

/** A worker that answers like the real one, after a microtask, unless told otherwise. */
function fakeWorker(mode: 'answer' | 'silent' | 'crash' | 'otherId' = 'answer') {
  const posted: { message: RideImportRequest; transfer: Transferable[] }[] = [];
  const worker: WorkerLike & { terminated: boolean } = {
    onmessage: null,
    onerror: null,
    terminated: false,
    postMessage(message, transfer) {
      posted.push({ message, transfer });
      queueMicrotask(() => {
        if (mode === 'crash') worker.onerror?.(new ErrorEvent('error'));
        if (mode === 'otherId') {
          const reply = handleRideImportRequest(message);
          worker.onmessage?.(new MessageEvent('message', { data: { ...reply, id: -1 } }));
        }
        if (mode === 'answer') {
          worker.onmessage?.(
            new MessageEvent('message', { data: handleRideImportRequest(message) }),
          );
        }
      });
    },
    terminate() {
      worker.terminated = true;
    },
  };
  return { worker, posted };
}

describe('readRideFile', () => {
  it('reads a FIT file in the worker, hands over the bytes and stops the worker', async () => {
    const { worker, posted } = fakeWorker();
    const r = await readRideFile(file('ride.fit', fitBytes()), { createWorker: () => worker });
    expect(r.ok && r.ride.samples.map((s) => s.power)).toEqual([200, 210]);
    expect(posted[0]?.message.fileName).toBe('ride.fit');
    expect(posted[0]?.transfer).toEqual([posted[0]?.message.buffer]);
    expect(worker.terminated).toBe(true);
  });

  it('checks the type and size before reading the file or starting a worker', async () => {
    const createWorker = vi.fn();
    const arrayBuffer = vi.fn();
    expect(await readRideFile({ name: 'a.zwo', size: 10, arrayBuffer }, { createWorker })).toEqual({
      ok: false,
      error: { code: 'unsupportedType' },
    });
    const big = await readRideFile(
      { name: 'a.fit', size: 21 * 1024 * 1024, arrayBuffer },
      { createWorker },
    );
    expect(big).toEqual({ ok: false, error: { code: 'tooLarge', limit: 20 * 1024 * 1024 } });
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(createWorker).not.toHaveBeenCalled();
  });

  it('reports a file the browser cannot read, and a worker that cannot start', async () => {
    const unreadable: FileLike = {
      name: 'a.fit',
      size: 10,
      arrayBuffer: () => Promise.reject(new Error('gone')),
    };
    expect(await readRideFile(unreadable)).toEqual({ ok: false, error: { code: 'readFailed' } });
    const noWorker = () => {
      throw new Error('no workers here');
    };
    expect(await readRideFile(file('a.fit', fitBytes()), { createWorker: noWorker })).toEqual({
      ok: false,
      error: { code: 'workerFailed' },
    });
  });

  it('gives up on a crashed worker or after the timeout, and stops it', async () => {
    const crashed = fakeWorker('crash');
    expect(
      await readRideFile(file('a.fit', fitBytes()), { createWorker: () => crashed.worker }),
    ).toEqual({ ok: false, error: { code: 'workerFailed' } });
    expect(crashed.worker.terminated).toBe(true);

    for (const mode of ['silent', 'otherId'] as const) {
      const slow = fakeWorker(mode);
      const r = await readRideFile(file('a.fit', fitBytes()), {
        createWorker: () => slow.worker,
        timeoutMs: 20,
      });
      expect(r).toEqual({ ok: false, error: { code: 'timeout' } });
      expect(slow.worker.terminated).toBe(true);
    }
  });
});
