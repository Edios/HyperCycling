import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestControl, setTargetPower, startOrResume } from '../../domain/ble/ftms';
import {
  ControlPointAbortedError,
  ControlPointTimeoutError,
  createControlPointClient,
  type ControlPointClient,
} from './control-point';

const ok = (opcode: number) => Uint8Array.of(0x80, opcode, 0x01);

describe('createControlPointClient', () => {
  let writes: Uint8Array[];
  let unexpected: string[];
  let client: ControlPointClient;
  /** Answers every write after `delay` ms unless `silent`. */
  let auto: { delay: number; silent: boolean };

  beforeEach(() => {
    vi.useFakeTimers();
    writes = [];
    unexpected = [];
    auto = { delay: 10, silent: false };
    client = createControlPointClient({
      timeoutMs: 3000,
      write: async (bytes) => {
        writes.push(bytes);
        if (!auto.silent) setTimeout(() => client.handleIndication(ok(bytes[0]!)), auto.delay);
      },
      onUnexpected: (_data, problem) => unexpected.push(problem),
    });
  });

  afterEach(() => vi.useRealTimers());

  it('resolves with the matching response', async () => {
    const result = client.send(setTargetPower(200));
    await vi.advanceTimersByTimeAsync(10);
    await expect(result).resolves.toMatchObject({ requestOpcode: 0x05, result: 'success' });
  });

  it('writes the next command only after the previous response', async () => {
    const all = Promise.all([
      client.send(requestControl()),
      client.send(startOrResume()),
      client.send(setTargetPower(150)),
    ]);
    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10);
    expect(writes).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(20);
    const results = await all;
    expect(writes.map((w) => w[0])).toEqual([0x00, 0x07, 0x05]);
    expect(results.map((r) => r.result)).toEqual(['success', 'success', 'success']);
  });

  it('accepts a response that arrives before the write promise settles', async () => {
    const early = createControlPointClient({
      write: async (bytes) => {
        early.handleIndication(ok(bytes[0]!));
      },
    });
    await expect(early.send(requestControl())).resolves.toMatchObject({ result: 'success' });
  });

  it('ignores responses for other op codes and malformed indications', async () => {
    auto.silent = true;
    const result = client.send(setTargetPower(200));
    await vi.advanceTimersByTimeAsync(0);
    client.handleIndication(ok(0x07));
    client.handleIndication(Uint8Array.of(0x08, 0xc8, 0x00));
    client.handleIndication(Uint8Array.of(0x80, 0x05, 0x05));
    await expect(result).resolves.toMatchObject({ result: 'controlNotPermitted' });
    expect(unexpected).toEqual([
      'response without a matching command',
      'Fitness Machine Control Point response: expected op code 0x80, got 0x08',
    ]);
    client.handleIndication(ok(0x05));
    expect(unexpected).toHaveLength(3);
  });

  it('retries once after a timeout, then succeeds', async () => {
    auto.silent = true;
    const result = client.send(requestControl());
    await vi.advanceTimersByTimeAsync(3000);
    expect(writes).toHaveLength(2);
    client.handleIndication(ok(0x00));
    await expect(result).resolves.toMatchObject({ result: 'success' });
  });

  it('fails with ControlPointTimeoutError after the retry and moves on', async () => {
    auto.silent = true;
    const result = client.send(requestControl());
    const caught = result.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(6000);
    const error = await caught;
    expect(error).toBeInstanceOf(ControlPointTimeoutError);
    expect((error as Error).message).toBe('Control Point: no response to op code 0x00');
    expect(writes).toHaveLength(2);
    auto.silent = false;
    const next = client.send(startOrResume());
    await vi.advanceTimersByTimeAsync(10);
    await expect(next).resolves.toMatchObject({ requestOpcode: 0x07 });
  });

  it('passes write errors through without retrying', async () => {
    const failing = createControlPointClient({
      write: async () => {
        throw new Error('GATT operation failed');
      },
    });
    await expect(failing.send(requestControl())).rejects.toThrow('GATT operation failed');
  });

  it('abort fails the command in flight and the queued ones; later commands work', async () => {
    auto.silent = true;
    const inFlight = client.send(requestControl()).catch((e: unknown) => e);
    const queued = client.send(startOrResume()).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(0);
    client.abort('link lost');
    expect(await inFlight).toBeInstanceOf(ControlPointAbortedError);
    expect(((await queued) as Error).message).toBe('Control Point: link lost');
    expect(writes).toHaveLength(1);
    auto.silent = false;
    const after = client.send(requestControl());
    await vi.advanceTimersByTimeAsync(10);
    await expect(after).resolves.toMatchObject({ result: 'success' });
  });

  it('accepts a response without the 0x80 header for the pending command', async () => {
    auto.silent = true;
    const one = client.send(setTargetPower(200));
    await vi.advanceTimersByTimeAsync(0);
    client.handleIndication(Uint8Array.of(0x02));
    await expect(one).resolves.toMatchObject({ requestOpcode: 0x05, result: 'notSupported' });
    const two = client.send(startOrResume());
    await vi.advanceTimersByTimeAsync(0);
    client.handleIndication(Uint8Array.of(0x07, 0x01));
    await expect(two).resolves.toMatchObject({ requestOpcode: 0x07, result: 'success' });
    expect(unexpected.filter((u) => u.includes('without the 0x80 header'))).toHaveLength(2);
  });

  it('ignores bare bytes that are not a known result or belong to no command', async () => {
    client.handleIndication(Uint8Array.of(0x02));
    auto.silent = true;
    const pendingCmd = client.send(requestControl()).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(0);
    client.handleIndication(Uint8Array.of(0x09));
    client.handleIndication(Uint8Array.of(0x05, 0x01));
    client.handleIndication(Uint8Array.of(0x01, 0x02, 0x03));
    await vi.advanceTimersByTimeAsync(6000);
    expect(await pendingCmd).toBeInstanceOf(ControlPointTimeoutError);
  });

  it('rejects an empty command', async () => {
    await expect(client.send(new Uint8Array(0))).rejects.toBeInstanceOf(RangeError);
  });
});
