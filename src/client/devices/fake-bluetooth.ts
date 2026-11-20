/**
 * A fake `navigator.bluetooth` backed by the byte-level simulators from domain/ble. Used by unit
 * tests, the e2e hook and later the /dev "simulated trainer" switch. It behaves like a real
 * device where it matters for the transport:
 * - Control Point writes fail unless indications were enabled first (ATT error on hardware);
 * - status notifications are delivered before the 0x80 response;
 * - a dropped link fires `gattserverdisconnected` and makes old characteristics useless.
 */

import { FakeHrSensor } from '../../domain/ble/fake-hr';
import { FakeTrainer } from '../../domain/ble/fake-trainer';
import { CHARACTERISTIC, SERVICE } from '../../domain/ble/uuids';
import type {
  BleCharacteristic,
  BleDevice,
  BleGattServer,
  BleRequestOptions,
  BleService,
  BleUuid,
  BluetoothLike,
} from './web-bluetooth';

export type FakeDeviceKind = 'trainer' | 'hr';

function domError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

const toNumber = (uuid: BleUuid): number =>
  typeof uuid === 'number' ? uuid : parseInt(uuid.slice(4, 8), 16);

class FakeCharacteristic extends EventTarget implements BleCharacteristic {
  value: DataView | null = null;
  notifying = false;
  /** Bumped by the server on every new link; stale objects stop working. */
  constructor(
    private readonly server: FakeGattServer,
    private readonly link: number,
    readonly uuid: number,
    private readonly onWrite?: (bytes: Uint8Array) => void,
    private readonly read?: () => Uint8Array,
  ) {
    super();
  }

  private check(): void {
    if (!this.server.connected || this.server.link !== this.link) {
      throw domError('NetworkError', 'GATT Server is disconnected.');
    }
  }

  async readValue(): Promise<DataView> {
    this.check();
    if (!this.read) throw domError('NotSupportedError', 'read not permitted');
    this.value = new DataView(this.read().slice().buffer);
    return this.value;
  }

  async writeValue(value: BufferSource): Promise<void> {
    this.check();
    if (!this.onWrite) throw domError('NotSupportedError', 'write not permitted');
    if (this.uuid === CHARACTERISTIC.fitnessMachineControlPoint && !this.notifying) {
      throw domError('NotSupportedError', 'GATT operation failed: indications are not enabled');
    }
    const bytes = ArrayBuffer.isView(value)
      ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice()
      : new Uint8Array(value).slice();
    this.server.bluetooth.writes.push({ device: this.server.kind, bytes });
    this.onWrite(bytes);
  }

  writeValueWithResponse(value: BufferSource): Promise<void> {
    return this.writeValue(value);
  }

  async startNotifications(): Promise<BleCharacteristic> {
    this.check();
    if (this.server.bluetooth.failNotifications.has(this.uuid)) {
      throw domError('NotSupportedError', 'GATT Error: Not supported.');
    }
    this.notifying = true;
    return this;
  }

  async stopNotifications(): Promise<BleCharacteristic> {
    this.notifying = false;
    return this;
  }

  /** Sends one notification/indication if enabled and the link is the current one. */
  emit(bytes: Uint8Array): void {
    if (!this.notifying || !this.server.connected || this.server.link !== this.link) return;
    this.value = new DataView(bytes.slice().buffer);
    this.dispatchEvent(new Event('characteristicvaluechanged'));
  }
}

class FakeService implements BleService {
  constructor(private readonly chars: Map<number, FakeCharacteristic>) {}

  async getCharacteristic(uuid: BleUuid): Promise<BleCharacteristic> {
    const ch = this.chars.get(toNumber(uuid));
    if (!ch) throw domError('NotFoundError', `No Characteristics matching UUID ${String(uuid)}`);
    return ch;
  }
}

class FakeGattServer implements BleGattServer {
  connected = false;
  link = 0;
  /** Connect attempts that should still fail. */
  failNext = 0;
  /** Connect attempts that never settle (simulates a hung platform connect). */
  hangNext = 0;
  private services = new Map<number, FakeService>();
  chars = new Map<number, FakeCharacteristic>();

  constructor(
    readonly bluetooth: FakeBluetooth,
    readonly kind: FakeDeviceKind,
    readonly device: FakeDevice,
  ) {}

  async connect(): Promise<BleGattServer> {
    if (this.hangNext > 0) {
      this.hangNext -= 1;
      return new Promise<never>(() => undefined);
    }
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw domError('NetworkError', 'Connection attempt failed.');
    }
    if (!this.bluetooth.inRange(this.kind)) {
      throw domError('NetworkError', 'Bluetooth Device is no longer in range.');
    }
    if (!this.connected) {
      this.connected = true;
      this.link += 1;
      this.build();
      this.bluetooth.onLinkUp(this.kind);
    }
    return this;
  }

  disconnect(): void {
    if (!this.connected) return;
    this.connected = false;
    // The trainer forgets who had control when the link goes.
    if (this.kind === 'trainer') this.bluetooth.trainer.disconnect();
    this.device.dispatchEvent(new Event('gattserverdisconnected'));
  }

  async getPrimaryService(uuid: BleUuid): Promise<BleService> {
    if (!this.connected) throw domError('NetworkError', 'GATT Server is disconnected.');
    const service = this.services.get(toNumber(uuid));
    if (!service) throw domError('NotFoundError', `No Services matching UUID ${String(uuid)}`);
    return service;
  }

  private build(): void {
    const make = (uuid: number, write?: (b: Uint8Array) => void, read?: () => Uint8Array) =>
      new FakeCharacteristic(this, this.link, uuid, write, read);
    this.chars = new Map();
    const add = (ch: FakeCharacteristic) => this.chars.set(ch.uuid, ch);
    if (this.kind === 'trainer') {
      const trainer = this.bluetooth.trainer;
      add(make(CHARACTERISTIC.fitnessMachineFeature, undefined, () => trainer.featureBytes()));
      add(make(CHARACTERISTIC.supportedPowerRange, undefined, () => trainer.powerRangeBytes()));
      add(make(CHARACTERISTIC.indoorBikeData));
      add(make(CHARACTERISTIC.fitnessMachineStatus));
      add(
        make(CHARACTERISTIC.fitnessMachineControlPoint, (bytes) =>
          this.bluetooth.onControlPoint(bytes),
        ),
      );
      this.services = new Map([[SERVICE.fitnessMachine, new FakeService(this.chars)]]);
    } else {
      add(make(CHARACTERISTIC.heartRateMeasurement));
      this.services = new Map([[SERVICE.heartRate, new FakeService(this.chars)]]);
    }
  }

  emit(uuid: number, bytes: Uint8Array): void {
    this.chars.get(uuid)?.emit(bytes);
  }
}

class FakeDevice extends EventTarget implements BleDevice {
  readonly gatt: FakeGattServer;
  constructor(
    bluetooth: FakeBluetooth,
    readonly kind: FakeDeviceKind,
    readonly id: string,
    readonly name: string,
  ) {
    super();
    this.gatt = new FakeGattServer(bluetooth, kind, this);
  }
}

export interface FakeBluetoothOptions {
  trainer?: FakeTrainer;
  hr?: FakeHrSensor;
  /** Delay before a Control Point response (ms); 0 delivers it on the next macrotask. */
  responseDelayMs?: number;
}

export class FakeBluetooth implements BluetoothLike {
  readonly trainer: FakeTrainer;
  readonly hr: FakeHrSensor;
  readonly devices: Record<FakeDeviceKind, FakeDevice>;
  /** Every Control Point write, in order. */
  readonly writes: { device: FakeDeviceKind; bytes: Uint8Array }[] = [];
  /** What the next chooser returns: a device, or 'cancel' (user closed it). */
  chooser: FakeDeviceKind | 'cancel' | 'auto' = 'auto';
  available = true;
  /** Characteristics whose startNotifications() fails. */
  readonly failNotifications = new Set<number>();
  private readonly responseDelayMs: number;
  private readonly outOfRange = new Set<FakeDeviceKind>();

  constructor(options: FakeBluetoothOptions = {}) {
    this.trainer = options.trainer ?? new FakeTrainer();
    this.hr = options.hr ?? new FakeHrSensor();
    this.responseDelayMs = options.responseDelayMs ?? 0;
    this.devices = {
      trainer: new FakeDevice(this, 'trainer', 'fake-trainer', 'Fake Trainer 0001'),
      hr: new FakeDevice(this, 'hr', 'fake-hr', 'Fake HR 0002'),
    };
  }

  async requestDevice(options: BleRequestOptions): Promise<BleDevice> {
    if (this.chooser === 'cancel')
      throw domError('NotFoundError', 'User cancelled the requestDevice() chooser.');
    const wanted = (options.filters ?? []).flatMap((f) => f.services ?? []).map(toNumber);
    const kind: FakeDeviceKind =
      this.chooser !== 'auto'
        ? this.chooser
        : wanted.includes(SERVICE.heartRate)
          ? 'hr'
          : 'trainer';
    return this.devices[kind];
  }

  async getAvailability(): Promise<boolean> {
    return this.available;
  }

  inRange(kind: FakeDeviceKind): boolean {
    return !this.outOfRange.has(kind);
  }

  /** Link drops (device switched off or out of range until `restoreLink`). */
  dropLink(kind: FakeDeviceKind, { stayAway = false } = {}): void {
    if (stayAway) this.outOfRange.add(kind);
    this.devices[kind].gatt.disconnect();
  }

  restoreLink(kind: FakeDeviceKind): void {
    this.outOfRange.delete(kind);
  }

  failConnects(kind: FakeDeviceKind, count: number): void {
    this.devices[kind].gatt.failNext = count;
  }

  hangConnects(kind: FakeDeviceKind, count: number): void {
    this.devices[kind].gatt.hangNext = count;
  }

  /** Emits one Indoor Bike Data reading and one HR measurement for connected devices. */
  pump(nowMs: number): void {
    const trainerGatt = this.devices.trainer.gatt;
    if (trainerGatt.connected) {
      for (const packet of this.trainer.tick(nowMs)) {
        trainerGatt.emit(CHARACTERISTIC.indoorBikeData, packet);
      }
    }
    const hrGatt = this.devices.hr.gatt;
    if (hrGatt.connected) hrGatt.emit(CHARACTERISTIC.heartRateMeasurement, this.hr.measure(nowMs));
  }

  /** The 0xFF "control permission lost" status, as when another app takes over. */
  takeControlAway(): void {
    this.devices.trainer.gatt.emit(CHARACTERISTIC.fitnessMachineStatus, this.trainer.loseControl());
  }

  /** @internal */
  onLinkUp(kind: FakeDeviceKind): void {
    if (kind === 'trainer' && !this.trainer.isConnected) this.trainer.reconnect();
  }

  /** @internal */
  onControlPoint(bytes: Uint8Array): void {
    const gatt = this.devices.trainer.gatt;
    const link = gatt.link;
    const result = this.trainer.handleControlPoint(bytes);
    setTimeout(() => {
      if (!gatt.connected || gatt.link !== link) return;
      // Status first, then the response: the order real trainers may use.
      for (const status of result.status) gatt.emit(CHARACTERISTIC.fitnessMachineStatus, status);
      if (result.response) gatt.emit(CHARACTERISTIC.fitnessMachineControlPoint, result.response);
    }, this.responseDelayMs);
  }
}
