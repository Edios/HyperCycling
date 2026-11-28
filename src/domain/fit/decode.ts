/**
 * A small FIT file reader: the header, definition and data messages, compressed timestamp headers,
 * both byte orders, developer fields (skipped by their size), chained files and both CRCs.
 * Written from the public FIT file format description (no third-party code), the mirror of
 * `writer.ts`. It knows no profile: it returns raw field values by field number, and the caller
 * picks the messages and fields it understands (see `read-ride.ts`).
 *
 * Damage is reported, not thrown: a bad CRC or a file that stops early gives the messages read so
 * far plus an issue; only bytes that are not FIT at all give an error.
 */

import { crc16 } from './crc16';

/** A field's raw value: a number (before scale and offset), a string, or null for "invalid". */
export type FitRawValue = number | string | null;

export interface FitMessage {
  /** Global message number (FIT profile), e.g. 20 for `record`. */
  global: number;
  /**
   * Field number -> value. An array field gives its first element. For a message sent with a
   * compressed timestamp header, field 253 (timestamp) is filled in from the header.
   */
  fields: Record<number, FitRawValue>;
}

export type FitIssue =
  /** The header CRC does not match (a header CRC of 0 means "not computed" and is fine). */
  | 'headerCrc'
  /** The CRC at the end of the file does not match. */
  | 'fileCrc'
  /** The file is shorter than its header says, or stops in the middle of a message. */
  | 'truncated'
  /** A data message for a local type that was never defined. */
  | 'badMessage'
  /** A compressed timestamp before any full timestamp (its time is unknown). */
  | 'orphanTimestamp';

export type FitDecodeResult =
  { ok: true; messages: FitMessage[]; issues: FitIssue[] } | { ok: false; reason: 'notFit' };

export interface FitDecodeOptions {
  /** Keep only messages with these global numbers (all others are read and dropped). */
  wanted?: ReadonlySet<number>;
}

/** Field number of `timestamp` in every message that has one. */
export const FIT_TIMESTAMP_FIELD = 253;

interface BaseType {
  size: number;
  read(view: DataView, at: number, le: boolean): number;
  /** True when the value is the type's "no value" marker. */
  invalid(value: number): boolean;
}

/** 64-bit integers as a JS number (precise enough for anything a ride file holds). */
function u64(view: DataView, at: number, le: boolean): number {
  const lo = view.getUint32(at + (le ? 0 : 4), le);
  const hi = view.getUint32(at + (le ? 4 : 0), le);
  return hi * 2 ** 32 + lo;
}

function s64(view: DataView, at: number, le: boolean): number {
  const lo = view.getUint32(at + (le ? 0 : 4), le);
  const hi = view.getInt32(at + (le ? 4 : 0), le);
  return hi * 2 ** 32 + lo;
}

const is = (marker: number) => (v: number) => v === marker;

/** Base types by their number (the low 5 bits of the base type byte). 7 is the string type. */
const BASE_TYPES: Record<number, BaseType> = {
  0x00: { size: 1, read: (v, a) => v.getUint8(a), invalid: is(0xff) }, // enum
  0x01: { size: 1, read: (v, a) => v.getInt8(a), invalid: is(0x7f) }, // sint8
  0x02: { size: 1, read: (v, a) => v.getUint8(a), invalid: is(0xff) }, // uint8
  0x03: { size: 2, read: (v, a, le) => v.getInt16(a, le), invalid: is(0x7fff) }, // sint16
  0x04: { size: 2, read: (v, a, le) => v.getUint16(a, le), invalid: is(0xffff) }, // uint16
  0x05: { size: 4, read: (v, a, le) => v.getInt32(a, le), invalid: is(0x7fffffff) }, // sint32
  0x06: { size: 4, read: (v, a, le) => v.getUint32(a, le), invalid: is(0xffffffff) }, // uint32
  0x08: { size: 4, read: (v, a, le) => v.getFloat32(a, le), invalid: Number.isNaN }, // float32
  0x09: { size: 8, read: (v, a, le) => v.getFloat64(a, le), invalid: Number.isNaN }, // float64
  0x0a: { size: 1, read: (v, a) => v.getUint8(a), invalid: is(0) }, // uint8z
  0x0b: { size: 2, read: (v, a, le) => v.getUint16(a, le), invalid: is(0) }, // uint16z
  0x0c: { size: 4, read: (v, a, le) => v.getUint32(a, le), invalid: is(0) }, // uint32z
  0x0d: { size: 1, read: (v, a) => v.getUint8(a), invalid: is(0xff) }, // byte
  0x0e: { size: 8, read: s64, invalid: is(2 ** 63) }, // sint64 (0x7FFF... rounds to 2^63)
  0x0f: { size: 8, read: u64, invalid: is(2 ** 64) }, // uint64 (0xFFFF... rounds to 2^64)
  0x10: { size: 8, read: u64, invalid: is(0) }, // uint64z
};
const STRING_TYPE = 0x07;

interface FieldDef {
  num: number;
  size: number;
  baseType: number;
}

interface MessageDef {
  global: number;
  littleEndian: boolean;
  fields: FieldDef[];
  /** Bytes of all fields plus the developer data after them (skipped). */
  size: number;
}

const utf8 = new TextDecoder('utf-8');

function readField(
  view: DataView,
  bytes: Uint8Array,
  at: number,
  field: FieldDef,
  le: boolean,
): FitRawValue {
  const typeNum = field.baseType & 0x1f;
  if (typeNum === STRING_TYPE) {
    const raw = bytes.subarray(at, at + field.size);
    const zero = raw.indexOf(0);
    const text = utf8.decode(zero === -1 ? raw : raw.subarray(0, zero));
    return text === '' ? null : text;
  }
  const type = BASE_TYPES[typeNum];
  // An unknown type, or a size that is not a whole number of values: unreadable, skip it.
  if (!type || field.size < type.size || field.size % type.size !== 0) return null;
  const value = type.read(view, at, le);
  return type.invalid(value) ? null : value;
}

interface Cursor {
  at: number;
  /** Last full timestamp seen in any message (for compressed timestamp headers). */
  lastTs: number | undefined;
}

interface Reader {
  bytes: Uint8Array;
  view: DataView;
  out: FitMessage[];
  issues: Set<FitIssue>;
  wanted: ReadonlySet<number> | undefined;
}

/** Reads a definition at `cur.at` (just after its record header); undefined if cut short. */
function readDefinition(r: Reader, head: number, end: number, cur: Cursor): MessageDef | undefined {
  const { bytes, view } = r;
  if (cur.at + 5 > end) return undefined;
  const littleEndian = bytes[cur.at + 1] === 0;
  const global = view.getUint16(cur.at + 2, littleEndian);
  const count = bytes[cur.at + 4] ?? 0;
  cur.at += 5;
  if (cur.at + count * 3 > end) return undefined;
  const fields: FieldDef[] = [];
  let size = 0;
  for (let i = 0; i < count; i += 1, cur.at += 3) {
    const field = {
      num: bytes[cur.at] ?? 0,
      size: bytes[cur.at + 1] ?? 0,
      baseType: bytes[cur.at + 2] ?? 0,
    };
    fields.push(field);
    size += field.size;
  }
  if (head & 0x20) {
    // Developer fields: (number, size, developer index) each; only their size matters here.
    if (cur.at + 1 > end) return undefined;
    const devCount = bytes[cur.at] ?? 0;
    cur.at += 1;
    if (cur.at + devCount * 3 > end) return undefined;
    for (let i = 0; i < devCount; i += 1, cur.at += 3) size += bytes[cur.at + 1] ?? 0;
  }
  return { global, littleEndian, fields, size };
}

/** Reads one file's records (between its header and its CRC); false when it had to stop early. */
function readRecords(r: Reader, end: number, cur: Cursor): boolean {
  const { bytes, view, issues } = r;
  const defs = new Map<number, MessageDef>();
  while (cur.at < end) {
    const head = bytes[cur.at] ?? 0;
    cur.at += 1;

    // Compressed timestamp header: local type in bits 5-6, seconds offset in bits 0-4.
    const compressed = (head & 0x80) !== 0;
    const local = compressed ? (head >> 5) & 0x03 : head & 0x0f;

    if (!compressed && head & 0x40) {
      const def = readDefinition(r, head, end, cur);
      if (!def) {
        issues.add('truncated');
        return false;
      }
      defs.set(local, def);
      continue;
    }

    const def = defs.get(local);
    if (!def) {
      issues.add('badMessage');
      return false;
    }
    if (cur.at + def.size > end) {
      issues.add('truncated');
      return false;
    }

    const keep = !r.wanted || r.wanted.has(def.global);
    const fields: Record<number, FitRawValue> = {};
    let at = cur.at;
    for (const f of def.fields) {
      // The timestamp is read for every message: compressed headers count from the last one.
      if (keep || f.num === FIT_TIMESTAMP_FIELD) {
        fields[f.num] = readField(view, bytes, at, f, def.littleEndian);
      }
      at += f.size;
    }
    cur.at += def.size;

    if (compressed) {
      const offset = head & 0x1f;
      if (cur.lastTs === undefined) {
        issues.add('orphanTimestamp');
        fields[FIT_TIMESTAMP_FIELD] = null;
      } else {
        // Replace the low 5 bits of the last timestamp; a smaller offset means they rolled over.
        const low = cur.lastTs % 32;
        const ts = cur.lastTs - low + offset + (offset < low ? 32 : 0);
        fields[FIT_TIMESTAMP_FIELD] = ts;
        cur.lastTs = ts;
      }
    } else {
      const ts = fields[FIT_TIMESTAMP_FIELD];
      if (typeof ts === 'number') cur.lastTs = ts;
    }
    if (keep) r.out.push({ global: def.global, fields });
  }
  return true;
}

function isFitHeader(bytes: Uint8Array, at: number): boolean {
  const size = bytes[at] ?? 0;
  return (
    size >= 12 &&
    at + size <= bytes.length &&
    bytes[at + 8] === 0x2e && // ".FIT"
    bytes[at + 9] === 0x46 &&
    bytes[at + 10] === 0x49 &&
    bytes[at + 11] === 0x54
  );
}

/** Decodes a FIT file (or several chained ones) into raw messages. */
export function decodeFit(bytes: Uint8Array, options: FitDecodeOptions = {}): FitDecodeResult {
  if (!isFitHeader(bytes, 0)) return { ok: false, reason: 'notFit' };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const r: Reader = { bytes, view, out: [], issues: new Set(), wanted: options.wanted };
  const cur: Cursor = { at: 0, lastTs: undefined };

  let start = 0;
  while (isFitHeader(bytes, start)) {
    const headerSize = bytes[start] ?? 12;
    const dataSize = view.getUint32(start + 4, true);
    if (headerSize >= 14) {
      const headerCrc = view.getUint16(start + 12, true);
      if (headerCrc !== 0 && headerCrc !== crc16(bytes.subarray(start, start + 12))) {
        r.issues.add('headerCrc');
      }
    }
    let end = start + headerSize + dataSize;
    if (end > bytes.length) {
      r.issues.add('truncated');
      end = bytes.length;
    }
    cur.at = start + headerSize;
    if (!readRecords(r, end, cur)) break;
    if (end + 2 > bytes.length) {
      // No room for the file CRC (already reported when the records themselves were cut).
      r.issues.add('truncated');
      break;
    }
    if (view.getUint16(end, true) !== crc16(bytes.subarray(start, end))) r.issues.add('fileCrc');
    start = end + 2;
  }
  return { ok: true, messages: r.out, issues: [...r.issues] };
}
