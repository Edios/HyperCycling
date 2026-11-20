/**
 * One GATT operation at a time per device. Parallel reads and writes fail on some platforms
 * (Chrome's Web Bluetooth guidance), so every read, write and notification start goes through
 * this queue. `clear` rejects everything still waiting, e.g. when the link drops.
 */

export class GattQueueClearedError extends Error {
  constructor(reason: string) {
    super(`GATT queue cleared: ${reason}`);
    this.name = 'GattQueueClearedError';
  }
}

export interface GattQueue {
  run<T>(op: () => Promise<T>): Promise<T>;
  clear(reason: string): void;
  /** Operations running or waiting. */
  readonly size: number;
}

interface Task {
  op: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

export function createGattQueue(): GattQueue {
  const waiting: Task[] = [];
  let running = false;

  async function drain(): Promise<void> {
    if (running) return;
    running = true;
    let task = waiting.shift();
    while (task) {
      try {
        task.resolve(await task.op());
      } catch (error) {
        task.reject(error);
      }
      task = waiting.shift();
    }
    running = false;
  }

  return {
    run<T>(op: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        waiting.push({ op, resolve: resolve as (v: unknown) => void, reject });
        void drain();
      });
    },
    clear(reason) {
      const dropped = waiting.splice(0);
      for (const task of dropped) task.reject(new GattQueueClearedError(reason));
    },
    get size() {
      return waiting.length + (running ? 1 : 0);
    },
  };
}
