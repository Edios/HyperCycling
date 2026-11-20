/**
 * Ring buffer of Bluetooth events for diagnostics (exported from /dev in T3, used to debug the
 * hardware test in T7). Holds bytes and states only; nothing leaves the device.
 */

export type BleLogSource = 'trainer' | 'hr' | 'app';
export type BleLogKind = 'tx' | 'rx' | 'state' | 'error';

export interface BleLogEntry {
  atMs: number;
  source: BleLogSource;
  kind: BleLogKind;
  text: string;
}

export interface BleLog {
  add(source: BleLogSource, kind: BleLogKind, text: string): void;
  entries(): readonly BleLogEntry[];
  toText(): string;
  clear(): void;
}

export function toHex(data: DataView | ArrayBufferView | ArrayBuffer): string {
  const bytes =
    data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

export function createBleLog({ limit = 1000, now = () => Date.now() } = {}): BleLog {
  let items: BleLogEntry[] = [];
  return {
    add(source, kind, text) {
      items.push({ atMs: now(), source, kind, text });
      if (items.length > limit) items = items.slice(items.length - limit);
    },
    entries: () => items,
    toText: () =>
      items
        .map((e) => `${new Date(e.atMs).toISOString()} ${e.source} ${e.kind} ${e.text}`)
        .join('\n'),
    clear() {
      items = [];
    },
  };
}
