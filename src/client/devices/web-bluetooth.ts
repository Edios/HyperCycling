/**
 * The small part of the Web Bluetooth API the app uses, as structural types. The real
 * `navigator.bluetooth` objects satisfy them, and so does the fake in `fake-bluetooth.ts`.
 * (TypeScript's DOM lib has no Web Bluetooth types and we add no dependency for them.)
 * Source: W3C Web Bluetooth CG draft, MDN "Web Bluetooth API".
 */

/** A 16-bit assigned number or a full 128-bit UUID string. */
export type BleUuid = number | string;

export interface BleCharacteristic extends EventTarget {
  readonly value?: DataView | null;
  readValue(): Promise<DataView>;
  /** Chrome 85+; older engines and some iOS wrappers only have `writeValue`. */
  writeValueWithResponse?(value: BufferSource): Promise<void>;
  writeValue(value: BufferSource): Promise<void>;
  /** Enables notifications or indications, whichever the characteristic supports. */
  startNotifications(): Promise<BleCharacteristic>;
  stopNotifications(): Promise<BleCharacteristic>;
}

export interface BleService {
  getCharacteristic(uuid: BleUuid): Promise<BleCharacteristic>;
}

export interface BleGattServer {
  readonly connected: boolean;
  connect(): Promise<BleGattServer>;
  disconnect(): void;
  getPrimaryService(uuid: BleUuid): Promise<BleService>;
}

/** Fires `gattserverdisconnected` when the link drops. */
export interface BleDevice extends EventTarget {
  readonly id: string;
  readonly name?: string | null;
  readonly gatt?: BleGattServer | null;
}

export interface BleRequestOptions {
  filters?: { services?: BleUuid[]; namePrefix?: string }[];
  optionalServices?: BleUuid[];
  acceptAllDevices?: boolean;
}

export interface BluetoothLike {
  /** Must run inside a user gesture (click or tap); shows the browser's device chooser. */
  requestDevice(options: BleRequestOptions): Promise<BleDevice>;
  /** True when a Bluetooth adapter is present. Missing in some engines. */
  getAvailability?(): Promise<boolean>;
}

/** Reads the DataView carried by a `characteristicvaluechanged` event. */
export function eventValue(event: Event): DataView | null {
  const target = event.target as BleCharacteristic | null;
  return target?.value ?? null;
}

/** Writes with response when the engine supports it (Control Point needs an acknowledged write). */
export function writeWithResponse(ch: BleCharacteristic, bytes: Uint8Array): Promise<void> {
  // Copy into a plain ArrayBuffer: Web Bluetooth rejects views on shared or offset buffers in some engines.
  const buffer = bytes.slice().buffer;
  return ch.writeValueWithResponse ? ch.writeValueWithResponse(buffer) : ch.writeValue(buffer);
}
