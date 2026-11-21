import type { BleLog } from './ble-log';

export interface BleLogExport {
  text: string;
  fileName: string;
}

/** Text and file name for sharing the Bluetooth log (bytes and states only, built on the device). */
export function buildBleLogExport(log: BleLog, version: string, now: Date): BleLogExport {
  const body = log.toText();
  const text = [
    `HyperCycling Bluetooth log (${version})`,
    `exported ${now.toISOString()}`,
    `events ${log.entries().length}`,
    '',
    body === '' ? '(no events yet)' : body,
  ].join('\n');
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return { text, fileName: `hypercycling-bluetooth-log-${stamp}.txt` };
}
