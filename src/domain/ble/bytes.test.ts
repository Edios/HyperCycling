import { describe, expect, it } from 'vitest';
import { BleParseError, ByteReader, ByteWriter, clampInt, toBytes, toDataView } from './bytes';

describe('ByteReader', () => {
  it('reads little-endian integers in sequence', () => {
    const r = new ByteReader(
      Uint8Array.of(0x01, 0x34, 0x12, 0xfe, 0xff, 0x56, 0x34, 0x12, 0x78, 0x56, 0x34, 0x12),
      'Test',
    );
    expect(r.uint8('a')).toBe(0x01);
    expect(r.uint16('b')).toBe(0x1234);
    expect(r.sint16('c')).toBe(-2);
    expect(r.uint24('d')).toBe(0x123456);
    expect(r.offset).toBe(8);
    expect(r.remaining).toBe(4);
    expect(r.uint32('e')).toBe(0x12345678);
    expect(r.remaining).toBe(0);
  });

  it('reads uint24 and uint32 with the top bit set', () => {
    const r = new ByteReader(Uint8Array.of(0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff), 'Test');
    expect(r.uint24('a')).toBe(0xffffff);
    expect(r.uint32('b')).toBe(0xffffffff);
  });

  it('skips bytes and fails with the packet, field and offset in the message', () => {
    const r = new ByteReader(Uint8Array.of(1, 2, 3), 'Indoor Bike Data');
    r.skip(2, 'Flags');
    let error: unknown;
    try {
      r.uint16('Instantaneous Power');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(BleParseError);
    expect((error as BleParseError).field).toBe('Instantaneous Power');
    expect((error as Error).message).toBe(
      'Indoor Bike Data: packet too short for "Instantaneous Power" (needs 2 byte(s) at offset 2, packet has 3)',
    );
  });

  it('accepts DataView, ArrayBuffer and offset typed arrays', () => {
    const backing = Uint8Array.of(0xaa, 0x34, 0x12, 0xbb);
    const sub = backing.subarray(1, 3);
    expect(new ByteReader(sub, 't').uint16('x')).toBe(0x1234);
    expect(new ByteReader(new DataView(backing.buffer, 1, 2), 't').uint16('x')).toBe(0x1234);
    expect(new ByteReader(Uint8Array.of(0x34, 0x12).buffer, 't').uint16('x')).toBe(0x1234);
    const view = new DataView(backing.buffer);
    expect(toDataView(view)).toBe(view);
    expect(Array.from(toBytes(sub))).toEqual([0x34, 0x12]);
  });
});

describe('ByteWriter', () => {
  it('writes little-endian values', () => {
    const bytes = new ByteWriter().uint8(0x05).uint16(0x1234).sint16(-2).toBytes();
    expect(Array.from(bytes)).toEqual([0x05, 0x34, 0x12, 0xfe, 0xff]);
  });
});

describe('clampInt', () => {
  it('rounds and clamps', () => {
    expect(clampInt(199.5, 0, 300)).toBe(200);
    expect(clampInt(-4, 0, 300)).toBe(0);
    expect(clampInt(400, 0, 300)).toBe(300);
    expect(clampInt(Infinity, 0, 300)).toBe(300);
  });

  it('maps NaN to the value nearest to zero', () => {
    expect(clampInt(Number.NaN, -10, 10)).toBe(0);
    expect(clampInt(Number.NaN, 5, 10)).toBe(5);
  });
});
