/**
 * A small FIT file writer: the 14-byte header, definition and data messages, and the CRC.
 * Little endian only. Written from the public FIT file format description (no third-party code).
 *
 * A file is: header (14 bytes, with its own CRC), then records, then a CRC-16 of everything
 * before it. A record is a one-byte header and either a definition (which fields a message has:
 * number, size, base type) or the data for the definition with the same local message number.
 */

import { crc16 } from './crc16';

/** The base types this writer uses, with their invalid ("no value") markers. */
export type FitType = 'enum' | 'uint8' | 'uint16' | 'uint32' | 'uint32z' | 'string';

interface TypeInfo {
  /** Base type byte of the definition (bit 7 set when larger than one byte). */
  id: number;
  size: number;
  /** Largest value that still means something (the marker above it is "invalid"). */
  max: number;
  invalid: number;
}

const TYPES: Record<Exclude<FitType, 'string'>, TypeInfo> = {
  enum: { id: 0x00, size: 1, max: 0xfe, invalid: 0xff },
  uint8: { id: 0x02, size: 1, max: 0xfe, invalid: 0xff },
  uint16: { id: 0x84, size: 2, max: 0xfffe, invalid: 0xffff },
  uint32: { id: 0x86, size: 4, max: 0xfffffffe, invalid: 0xffffffff },
  // The "z" types treat 0 as invalid.
  uint32z: { id: 0x8c, size: 4, max: 0xffffffff, invalid: 0 },
};
const STRING_ID = 0x07;

export interface FitField {
  /** Field number in the message (from the FIT profile). */
  num: number;
  type: FitType;
  /** Bytes of a string field, including its terminating zero. */
  size?: number;
}

/** A value for a field: null (or anything that does not fit the type) writes "invalid". */
export type FitValue = number | string | null | undefined;

/** Seconds from the Unix epoch to the FIT epoch (1989-12-31 00:00:00 UTC). */
export const FIT_EPOCH_UNIX_SEC = 631_065_600;

/** FIT timestamp (seconds since the FIT epoch) of a Unix time in ms, rounded to the second. */
export function fitTimestamp(unixMs: number): number {
  return Math.round(unixMs / 1000) - FIT_EPOCH_UNIX_SEC;
}

const HEADER_SIZE = 14;
/** Protocol 2.0 (high nibble 2) and a profile version (2.140 as 2140): only informational here. */
const PROTOCOL_VERSION = 0x20;
const PROFILE_VERSION = 2140;
const MAX_LOCAL_TYPES = 16;

export interface FitWriter {
  /** Starts a message type: writes its definition and returns the local number to use. */
  define(globalNum: number, fields: readonly FitField[]): number;
  /** One data message for a defined local type; `values` are in the order of its fields. */
  write(local: number, values: readonly FitValue[]): void;
  /** The finished file: header, records and CRC. */
  finish(): Uint8Array;
}

function numberBytes(value: number, size: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < size; i += 1) out.push(Math.floor(value / 2 ** (8 * i)) % 256);
  return out;
}

export function createFitWriter(): FitWriter {
  const body: number[] = [];
  const defs: { fields: readonly FitField[] }[] = [];

  return {
    define(globalNum, fields) {
      const local = defs.length;
      if (local >= MAX_LOCAL_TYPES)
        throw new Error('A FIT file has at most 16 local message types.');
      defs.push({ fields });
      // Definition header (bit 6), reserved byte, little endian (0), global message number.
      body.push(0x40 | local, 0, 0, ...numberBytes(globalNum, 2), fields.length);
      for (const f of fields) {
        const size = f.type === 'string' ? (f.size ?? 1) : TYPES[f.type].size;
        const id = f.type === 'string' ? STRING_ID : TYPES[f.type].id;
        body.push(f.num, size, id);
      }
      return local;
    },

    write(local, values) {
      const def = defs[local];
      if (!def) throw new Error(`FIT local message type ${local} is not defined.`);
      body.push(local);
      def.fields.forEach((f, i) => {
        const value = values[i];
        if (f.type === 'string') {
          const size = f.size ?? 1;
          const text = typeof value === 'string' ? value : '';
          // ASCII only, always ends with a zero byte.
          const chars = [...text]
            .slice(0, size - 1)
            .map((c) => (c.charCodeAt(0) < 128 ? c.charCodeAt(0) : 63));
          while (chars.length < size) chars.push(0);
          body.push(...chars);
          return;
        }
        const t = TYPES[f.type];
        const ok =
          typeof value === 'number' &&
          Number.isFinite(value) &&
          value >= 0 &&
          Math.round(value) <= t.max;
        body.push(...numberBytes(ok ? Math.round(value) : t.invalid, t.size));
      });
    },

    finish() {
      const header = [
        HEADER_SIZE,
        PROTOCOL_VERSION,
        ...numberBytes(PROFILE_VERSION, 2),
        ...numberBytes(body.length, 4),
        0x2e, // ".FIT"
        0x46,
        0x49,
        0x54,
      ];
      header.push(...numberBytes(crc16(header), 2));
      const file = [...header, ...body];
      file.push(...numberBytes(crc16(file), 2));
      return Uint8Array.from(file);
    },
  };
}
