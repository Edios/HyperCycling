/**
 * Little-endian byte helpers for Bluetooth GATT payloads. All multi-byte GATT values are
 * little-endian (Bluetooth Core Specification, Vol 3, Part G).
 */

/** Anything Web Bluetooth or a test can hand us: a DataView, a typed array or a raw buffer. */
export type BleBytes = DataView | ArrayBuffer | ArrayBufferView;

/** Thrown when a payload is too short or malformed; the message names the packet and field. */
export class BleParseError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
    this.name = 'BleParseError';
  }
}

export function toDataView(data: BleBytes): DataView {
  if (data instanceof DataView) return data;
  if (ArrayBuffer.isView(data)) return new DataView(data.buffer, data.byteOffset, data.byteLength);
  return new DataView(data);
}

/** Copies the payload into a fresh Uint8Array (handy for logs and comparisons). */
export function toBytes(data: BleBytes): Uint8Array {
  const view = toDataView(data);
  return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
}

/** Sequential reader with an offset and readable length errors. */
export class ByteReader {
  private readonly view: DataView;
  private pos = 0;

  constructor(
    data: BleBytes,
    /** Packet name used in error messages, e.g. "Indoor Bike Data". */
    readonly packet: string,
  ) {
    this.view = toDataView(data);
  }

  get offset(): number {
    return this.pos;
  }

  get length(): number {
    return this.view.byteLength;
  }

  get remaining(): number {
    return this.view.byteLength - this.pos;
  }

  private take(size: number, field: string): number {
    if (this.remaining < size) {
      throw new BleParseError(
        `${this.packet}: packet too short for "${field}" (needs ${size} byte(s) at offset ${this.pos}, packet has ${this.view.byteLength})`,
        field,
      );
    }
    const at = this.pos;
    this.pos += size;
    return at;
  }

  uint8(field: string): number {
    return this.view.getUint8(this.take(1, field));
  }

  uint16(field: string): number {
    return this.view.getUint16(this.take(2, field), true);
  }

  sint16(field: string): number {
    return this.view.getInt16(this.take(2, field), true);
  }

  uint24(field: string): number {
    const at = this.take(3, field);
    return this.view.getUint16(at, true) | (this.view.getUint8(at + 2) << 16);
  }

  uint32(field: string): number {
    return this.view.getUint32(this.take(4, field), true);
  }

  skip(size: number, field: string): void {
    this.take(size, field);
  }
}

/** Minimal little-endian writer for Control Point commands. Values are expected in range. */
export class ByteWriter {
  private readonly out: number[] = [];

  uint8(value: number): this {
    this.out.push(value & 0xff);
    return this;
  }

  uint16(value: number): this {
    this.out.push(value & 0xff, (value >> 8) & 0xff);
    return this;
  }

  /** Two's complement; the caller clamps to -32768..32767. */
  sint16(value: number): this {
    return this.uint16(value & 0xffff);
  }

  toBytes(): Uint8Array {
    return Uint8Array.from(this.out);
  }
}

/** Rounds to an integer and clamps into [min, max]; NaN becomes the value nearest to 0. */
export function clampInt(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return Math.min(max, Math.max(min, 0));
  return Math.min(max, Math.max(min, Math.round(value)));
}

export const SINT16_MIN = -32768;
export const SINT16_MAX = 32767;
export const UINT8_MAX = 255;
