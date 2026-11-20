import { describe, expect, it } from 'vitest';
import { createGattQueue, GattQueueClearedError } from './gatt-queue';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('createGattQueue', () => {
  it('never runs two operations at the same time and keeps their order', async () => {
    const queue = createGattQueue();
    let active = 0;
    let maxActive = 0;
    const order: number[] = [];
    const op = (n: number) => async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await tick();
      order.push(n);
      active -= 1;
      return n * 10;
    };
    const results = await Promise.all([1, 2, 3, 4].map((n) => queue.run(op(n))));
    expect(results).toEqual([10, 20, 30, 40]);
    expect(order).toEqual([1, 2, 3, 4]);
    expect(maxActive).toBe(1);
    expect(queue.size).toBe(0);
  });

  it('a failing operation rejects only its caller', async () => {
    const queue = createGattQueue();
    const failed = queue.run(async () => {
      throw new Error('ATT error');
    });
    const next = queue.run(async () => 'ok');
    await expect(failed).rejects.toThrow('ATT error');
    await expect(next).resolves.toBe('ok');
  });

  it('clear rejects waiting operations but lets the running one finish', async () => {
    const queue = createGattQueue();
    let release!: () => void;
    const running = queue.run(() => new Promise<string>((r) => (release = () => r('done'))));
    const waiting = queue.run(async () => 'never');
    expect(queue.size).toBe(2);
    queue.clear('link lost');
    await expect(waiting).rejects.toBeInstanceOf(GattQueueClearedError);
    await expect(waiting).rejects.toThrow('GATT queue cleared: link lost');
    release();
    await expect(running).resolves.toBe('done');
    await expect(queue.run(async () => 'after')).resolves.toBe('after');
  });
});
