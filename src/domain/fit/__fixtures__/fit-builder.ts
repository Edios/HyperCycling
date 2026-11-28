/**
 * Test-only builder of raw FIT bytes, for the cases our own writer never produces: big-endian
 * definitions, compressed timestamp headers, developer fields, every base type, broken CRCs,
 * 12-byte headers and cut files. Written from the public FIT file format description.
 */

import { crc16 } from '../crc16';

/** [field number, size in bytes, base type byte] */
export type FieldSpec = [num: number, size: number, baseType: number];

export const T = {
  enum: 0x00,
  sint8: 0x01,
  uint8: 0x02,
  sint16: 0x83,
  uint16: 0x84,
  sint32: 0x85,
  uint32: 0x86,
  string: 0x07,
  float32: 0x88,
  float64: 0x89,
  uint8z: 0x0a,
  uint16z: 0x8b,
  uint32z: 0x8c,
  byte: 0x0d,
  sint64: 0x8e,
  uint64: 0x8f,
  uint64z: 0x90,
} as const;

interface Def {
  fields: FieldSpec[];
  be: boolean;
  devSize: number;
}

export type Value = number | string | bigint | null;

function encodeValue(value: Value, size: number, baseType: number, be: boolean): number[] {
  const type = baseType & 0x1f;
  const buf = new ArrayBuffer(Math.max(size, 8));
  const v = new DataView(buf);
  const le = !be;
  if (type === 0x07) {
    const text = new TextEncoder().encode(typeof value === 'string' ? value : '');
    const out = Array.from(text.slice(0, size));
    while (out.length < size) out.push(0);
    return out;
  }
  const n = typeof value === 'number' ? value : 0;
  const invalid = value === null;
  switch (type) {
    case 0x00:
    case 0x02:
    case 0x0d:
      v.setUint8(0, invalid ? 0xff : n);
      break;
    case 0x0a:
      v.setUint8(0, invalid ? 0 : n);
      break;
    case 0x01:
      v.setInt8(0, invalid ? 0x7f : n);
      break;
    case 0x03:
      v.setInt16(0, invalid ? 0x7fff : n, le);
      break;
    case 0x04:
      v.setUint16(0, invalid ? 0xffff : n, le);
      break;
    case 0x0b:
      v.setUint16(0, invalid ? 0 : n, le);
      break;
    case 0x05:
      v.setInt32(0, invalid ? 0x7fffffff : n, le);
      break;
    case 0x06:
      v.setUint32(0, invalid ? 0xffffffff : n, le);
      break;
    case 0x0c:
      v.setUint32(0, invalid ? 0 : n, le);
      break;
    case 0x08:
      v.setFloat32(0, invalid ? NaN : n, le);
      if (invalid) v.setUint32(0, 0xffffffff, le);
      break;
    case 0x09:
      v.setFloat64(0, invalid ? NaN : n, le);
      if (invalid) v.setBigUint64(0, 0xffffffffffffffffn, le);
      break;
    case 0x0e:
      v.setBigInt64(0, invalid ? 0x7fffffffffffffffn : BigInt(value ?? 0), le);
      break;
    case 0x0f:
      v.setBigUint64(0, invalid ? 0xffffffffffffffffn : BigInt(value ?? 0), le);
      break;
    case 0x10:
      v.setBigUint64(0, invalid ? 0n : BigInt(value ?? 0), le);
      break;
    default:
      break;
  }
  return Array.from(new Uint8Array(buf, 0, size));
}

export interface FileOptions {
  /** 12 or 14 (default 14). */
  headerSize?: number;
  /** 'good' (default), 'zero' (not computed) or 'bad'. */
  headerCrc?: 'good' | 'zero' | 'bad';
  /** 'good' (default), 'bad' or 'none' (left off). */
  fileCrc?: 'good' | 'bad' | 'none';
  /** Added to the data size written in the header (to claim more data than there is). */
  dataSizeDelta?: number;
}

export class FitBuilder {
  readonly body: number[] = [];
  private readonly defs = new Map<number, Def>();

  /** A definition message. `dev` lists developer fields as [number, size, developer index]. */
  def(
    local: number,
    global: number,
    fields: FieldSpec[],
    opts: { be?: boolean; dev?: FieldSpec[] } = {},
  ): this {
    const be = opts.be ?? false;
    const head = 0x40 | (opts.dev ? 0x20 : 0) | local;
    const g = be ? [global >> 8, global & 0xff] : [global & 0xff, global >> 8];
    this.body.push(head, 0, be ? 1 : 0, ...g, fields.length);
    for (const f of fields) this.body.push(...f);
    let devSize = 0;
    if (opts.dev) {
      this.body.push(opts.dev.length);
      for (const d of opts.dev) {
        this.body.push(...d);
        devSize += d[1];
      }
    }
    this.defs.set(local, { fields, be, devSize });
    return this;
  }

  private values(local: number, values: Value[]): number[] {
    const def = this.defs.get(local);
    if (!def) throw new Error(`local ${local} not defined`);
    const out: number[] = [];
    def.fields.forEach(([, size, type], i) =>
      out.push(...encodeValue(values[i] ?? null, size, type, def.be)),
    );
    for (let i = 0; i < def.devSize; i += 1) out.push(0xab);
    return out;
  }

  /** A data message with a normal header. */
  data(local: number, values: Value[]): this {
    this.body.push(local, ...this.values(local, values));
    return this;
  }

  /** A data message with a compressed timestamp header (local 0-3, offset 0-31). */
  compressed(local: number, offset: number, values: Value[]): this {
    this.body.push(0x80 | (local << 5) | offset, ...this.values(local, values));
    return this;
  }

  raw(...bytes: number[]): this {
    this.body.push(...bytes);
    return this;
  }

  file(opts: FileOptions = {}): Uint8Array {
    const headerSize = opts.headerSize ?? 14;
    const size = this.body.length + (opts.dataSizeDelta ?? 0);
    const header = [
      headerSize,
      0x20,
      2140 & 0xff,
      2140 >> 8,
      size & 0xff,
      (size >> 8) & 0xff,
      (size >> 16) & 0xff,
      (size >>> 24) & 0xff,
      0x2e,
      0x46,
      0x49,
      0x54,
    ];
    if (headerSize >= 14) {
      const crc =
        opts.headerCrc === 'zero' ? 0 : crc16(header) ^ (opts.headerCrc === 'bad' ? 1 : 0);
      header.push(crc & 0xff, crc >> 8);
    }
    const file = [...header, ...this.body];
    if (opts.fileCrc !== 'none') {
      const crc = crc16(file) ^ (opts.fileCrc === 'bad' ? 1 : 0);
      file.push(crc & 0xff, crc >> 8);
    }
    return Uint8Array.from(file);
  }
}

/** FIT time (seconds since 1989-12-31 UTC) of an ISO date. */
export function fitTime(iso: string): number {
  return Date.parse(iso) / 1000 - 631_065_600;
}
