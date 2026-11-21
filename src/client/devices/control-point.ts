/**
 * Fitness Machine Control Point client: one command in flight, each waits for its 0x80 response
 * indication (matched by request op code) before the next is written. `timeoutMs` counts from the
 * start of the write, so a write that hangs counts like a missing response: it is retried once,
 * then the command fails with ControlPointTimeoutError.
 * Status notifications may arrive before the response; they do not go through here.
 */

import { toBytes, type BleBytes } from '../../domain/ble/bytes';
import { GattTimeoutError } from './gatt-queue';
import { parseControlPointResponse, type ControlPointResponse } from '../../domain/ble/ftms';

export class ControlPointTimeoutError extends Error {
  constructor(readonly opcode: number) {
    super(`Control Point: no response to op code 0x${opcode.toString(16).padStart(2, '0')}`);
    this.name = 'ControlPointTimeoutError';
  }
}

export class ControlPointAbortedError extends Error {
  constructor(reason: string) {
    super(`Control Point: ${reason}`);
    this.name = 'ControlPointAbortedError';
  }
}

const RESULT_NAMES: Record<number, ControlPointResponse['result']> = {
  0x01: 'success',
  0x02: 'notSupported',
  0x03: 'invalidParameter',
  0x04: 'operationFailed',
  0x05: 'controlNotPermitted',
};

/** A 1-byte result code, or 2 bytes "request op code, result code", without the 0x80 header. */
function bareResponse(data: BleBytes, opcode: number): ControlPointResponse | null {
  const bytes = toBytes(data);
  const code =
    bytes.length === 1
      ? bytes[0]
      : bytes.length === 2 && bytes[0] === opcode
        ? bytes[1]
        : undefined;
  if (code === undefined) return null;
  const result = RESULT_NAMES[code];
  if (!result) return null;
  return { requestOpcode: opcode, result, resultCode: code, parameters: new Uint8Array(0) };
}

export interface ControlPointClient {
  /** Writes one command and resolves with the trainer's response (any result code). */
  send(command: Uint8Array): Promise<ControlPointResponse>;
  /** Feed every indication received on the Control Point characteristic. */
  handleIndication(data: BleBytes): void;
  /** Fails the command in flight and every queued one (link lost, device closed). */
  abort(reason: string): void;
}

export interface ControlPointOptions {
  write(bytes: Uint8Array): Promise<void>;
  timeoutMs?: number;
  retries?: number;
  /** Called for indications that are not a pending command's response (logged by the caller). */
  onUnexpected?(data: BleBytes, problem: string): void;
}

interface Pending {
  opcode: number;
  /** null ends the attempt without a response (timeout or abort). */
  resolve(response: ControlPointResponse | null): void;
}

export function createControlPointClient({
  write,
  timeoutMs = 3000,
  retries = 1,
  onUnexpected,
}: ControlPointOptions): ControlPointClient {
  let pending: Pending | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  let epoch = 0;
  let abortReason = '';

  /** One attempt: resolves with the response, or null on timeout. */
  function attempt(command: Uint8Array, opcode: number): Promise<ControlPointResponse | null> {
    return new Promise((resolve, reject) => {
      const done = (value: ControlPointResponse | null) => {
        clearTimeout(timer);
        if (pending === slot) pending = null;
        resolve(value);
      };
      // Registered before the write: the response may arrive before the write promise settles.
      const slot: Pending = { opcode, resolve: done };
      pending = slot;
      const timer = setTimeout(() => done(null), timeoutMs);
      write(command).catch((error: unknown) => {
        if (pending !== slot) return; // already answered, timed out or aborted
        // The GATT queue gave up on a hung write: same as no response.
        if (error instanceof GattTimeoutError) return done(null);
        clearTimeout(timer);
        pending = null;
        reject(error);
      });
    });
  }

  async function run(command: Uint8Array, myEpoch: number): Promise<ControlPointResponse> {
    const opcode = command[0];
    if (opcode === undefined) throw new RangeError('Control Point: empty command');
    for (let i = 0; i <= retries; i++) {
      if (myEpoch !== epoch) throw new ControlPointAbortedError(abortReason);
      const response = await attempt(command, opcode);
      if (myEpoch !== epoch) throw new ControlPointAbortedError(abortReason);
      if (response) return response;
    }
    throw new ControlPointTimeoutError(opcode);
  }

  return {
    send(command) {
      const myEpoch = epoch;
      const result = chain.then(() => run(command, myEpoch));
      chain = result.catch(() => undefined);
      return result;
    },
    handleIndication(data) {
      let response: ControlPointResponse;
      try {
        response = parseControlPointResponse(data);
      } catch (error) {
        const bare = pending ? bareResponse(data, pending.opcode) : null;
        if (!bare || !pending) {
          onUnexpected?.(data, (error as Error).message);
          return;
        }
        // Some trainers (e.g. a Kickr Core) answer without the 0x80 header: accept the result
        // code for the pending command instead of waiting for the timeout (oss-trainer-pitfalls #1).
        onUnexpected?.(data, 'response without the 0x80 header, taken as the result code');
        pending.resolve(bare);
        return;
      }
      if (!pending || pending.opcode !== response.requestOpcode) {
        onUnexpected?.(data, 'response without a matching command');
        return;
      }
      pending.resolve(response);
    },
    abort(reason) {
      epoch += 1;
      abortReason = reason;
      // Wakes the attempt in flight; run() sees the new epoch and throws ControlPointAbortedError.
      pending?.resolve(null);
    },
  };
}
