import { describe, expect, it } from 'vitest';
import { decodeFit, type FitMessage } from './decode';
import { createFitWriter } from './writer';
import { FitBuilder, T, fitTime } from './__fixtures__/fit-builder';

const TS = fitTime('2026-11-22T08:00:00Z');

function ok(bytes: Uint8Array) {
  const r = decodeFit(bytes);
  if (!r.ok) throw new Error('expected a FIT file');
  return r;
}

const fieldsOf = (m: FitMessage[]) => m.map((x) => x.fields);

describe('decodeFit: header and file', () => {
  it('reads what our own writer wrote (definitions, data, strings, invalid values)', () => {
    const w = createFitWriter();
    const a = w.define(0, [
      { num: 0, type: 'enum' },
      { num: 8, type: 'string', size: 6 },
    ]);
    const b = w.define(20, [
      { num: 253, type: 'uint32' },
      { num: 7, type: 'uint16' },
      { num: 3, type: 'uint8' },
    ]);
    w.write(a, [4, 'Hyper']);
    w.write(b, [TS, 250, null]);
    w.write(b, [TS + 1, null, 140]);
    const r = ok(w.finish());
    expect(r.issues).toEqual([]);
    expect(r.messages).toEqual([
      { global: 0, fields: { 0: 4, 8: 'Hyper' } },
      { global: 20, fields: { 253: TS, 7: 250, 3: null } },
      { global: 20, fields: { 253: TS + 1, 7: null, 3: 140 } },
    ]);
  });

  it('refuses bytes that are not FIT', () => {
    expect(decodeFit(new Uint8Array())).toEqual({ ok: false, reason: 'notFit' });
    expect(decodeFit(new TextEncoder().encode('<?xml version="1.0"?><gpx></gpx>'))).toEqual({
      ok: false,
      reason: 'notFit',
    });
    const short = new FitBuilder().file().slice(0, 10);
    expect(decodeFit(short).ok).toBe(false);
    const tinyHeader = new FitBuilder().file();
    tinyHeader[0] = 8; // a header cannot be smaller than 12 bytes
    expect(decodeFit(tinyHeader).ok).toBe(false);
  });

  it('accepts a 12-byte header and a header CRC of 0 ("not computed")', () => {
    const b = new FitBuilder().def(0, 20, [[253, 4, T.uint32]]).data(0, [TS]);
    expect(ok(b.file({ headerSize: 12 }))).toMatchObject({
      issues: [],
      messages: [{ global: 20 }],
    });
    expect(ok(b.file({ headerCrc: 'zero' })).issues).toEqual([]);
  });

  it('reports a bad header CRC and a bad file CRC but keeps the messages', () => {
    const b = new FitBuilder().def(0, 20, [[253, 4, T.uint32]]).data(0, [TS]);
    expect(ok(b.file({ headerCrc: 'bad' }))).toMatchObject({
      issues: ['headerCrc'],
      messages: [{ fields: { 253: TS } }],
    });
    expect(ok(b.file({ fileCrc: 'bad' })).issues).toEqual(['fileCrc']);
  });

  it('keeps what it read from a file that stops early, and says so', () => {
    const b = new FitBuilder()
      .def(0, 20, [
        [253, 4, T.uint32],
        [7, 2, T.uint16],
      ])
      .data(0, [TS, 100])
      .data(0, [TS + 1, 110]);
    const full = b.file();
    // Cut in the middle of the second record (header claims more than the file has).
    const cut = full.slice(0, full.length - 2 - 3);
    const r = ok(cut);
    expect(r.issues).toEqual(['truncated']);
    expect(fieldsOf(r.messages)).toEqual([{ 253: TS, 7: 100 }]);
    // Records complete, but the file CRC is missing.
    expect(ok(b.file({ fileCrc: 'none' }))).toMatchObject({ issues: ['truncated'] });
    expect(ok(b.file({ fileCrc: 'none' })).messages).toHaveLength(2);
  });

  it('stops at a definition cut short, wherever it is cut', () => {
    const b = new FitBuilder()
      .def(0, 20, [[253, 4, T.uint32]])
      .data(0, [TS])
      .def(1, 19, [[253, 4, T.uint32]], { dev: [[0, 2, 0]] });
    const full = b.file({ fileCrc: 'none' });
    const defStart = 14 + 1 + 5 + 3 + 1 + 4; // header, first def, first data
    for (const keep of [defStart + 3, defStart + 7, defStart + 9, defStart + 11]) {
      const r = ok(full.slice(0, keep));
      expect(r.issues).toContain('truncated');
      expect(r.messages).toHaveLength(1);
    }
  });

  it('stops at data for a local type that was never defined', () => {
    const b = new FitBuilder()
      .def(0, 20, [[253, 4, T.uint32]])
      .data(0, [TS])
      .raw(0x05, 1, 2, 3);
    const r = ok(b.file());
    expect(r.issues).toEqual(['badMessage']);
    expect(r.messages).toHaveLength(1);
  });

  it('reads chained files one after another, and ignores junk after the last one', () => {
    const first = new FitBuilder()
      .def(0, 20, [[253, 4, T.uint32]])
      .data(0, [TS])
      .file();
    // The second file defines nothing it does not use (definitions do not carry over).
    const second = new FitBuilder()
      .def(0, 20, [
        [253, 4, T.uint32],
        [7, 2, T.uint16],
      ])
      .data(0, [TS + 5, 300])
      .file();
    const r = ok(Uint8Array.from([...first, ...second, 1, 2, 3]));
    expect(r.issues).toEqual([]);
    expect(fieldsOf(r.messages)).toEqual([{ 253: TS }, { 253: TS + 5, 7: 300 }]);
  });
});

describe('decodeFit: messages', () => {
  it('reads big-endian definitions and values', () => {
    const b = new FitBuilder()
      .def(
        2,
        20,
        [
          [253, 4, T.uint32],
          [7, 2, T.uint16],
          [0, 4, T.sint32],
        ],
        { be: true },
      )
      .data(2, [TS, 0x1234, -123_456_789]);
    expect(ok(b.file()).messages).toEqual([
      { global: 20, fields: { 253: TS, 7: 0x1234, 0: -123_456_789 } },
    ]);
  });

  it('skips developer fields by their size and reads the fields around them', () => {
    const b = new FitBuilder()
      .def(
        0,
        20,
        [
          [253, 4, T.uint32],
          [7, 2, T.uint16],
        ],
        {
          dev: [
            [0, 4, 0],
            [1, 2, 0],
          ],
        },
      )
      .data(0, [TS, 222])
      .data(0, [TS + 1, 223]);
    expect(fieldsOf(ok(b.file()).messages)).toEqual([
      { 253: TS, 7: 222 },
      { 253: TS + 1, 7: 223 },
    ]);
  });

  it('fills the timestamp of compressed headers from the last full one, across a rollover', () => {
    const base = TS - (TS % 32) + 28; // low 5 bits = 28
    const b = new FitBuilder()
      .def(0, 20, [
        [253, 4, T.uint32],
        [7, 2, T.uint16],
      ])
      .def(3, 20, [[7, 2, T.uint16]])
      .data(0, [base, 100])
      .compressed(3, 30, [101]) // +2 s
      .compressed(3, 1, [102]) // 1 < 30: rolled over, +3 s
      .compressed(3, 1, [103]); // same second again
    expect(fieldsOf(ok(b.file()).messages)).toEqual([
      { 253: base, 7: 100 },
      { 253: base + 2, 7: 101 },
      { 253: base + 5, 7: 102 },
      { 253: base + 5, 7: 103 },
    ]);
  });

  it('a compressed header before any timestamp has no time', () => {
    const b = new FitBuilder().def(1, 20, [[7, 2, T.uint16]]).compressed(1, 3, [99]);
    const r = ok(b.file());
    expect(r.issues).toEqual(['orphanTimestamp']);
    expect(fieldsOf(r.messages)).toEqual([{ 7: 99, 253: null }]);
  });

  it('reads every base type and its "invalid" marker', () => {
    const fields: [number, number, number][] = [
      [1, 1, T.sint8],
      [2, 2, T.sint16],
      [3, 4, T.float32],
      [4, 8, T.float64],
      [5, 1, T.uint8z],
      [6, 2, T.uint16z],
      [7, 4, T.uint32z],
      [8, 1, T.byte],
      [9, 8, T.sint64],
      [10, 8, T.uint64],
      [11, 8, T.uint64z],
      [12, 1, T.enum],
      [13, 4, T.sint32],
      [14, 6, T.string],
    ];
    const b = new FitBuilder()
      .def(0, 99, fields)
      .data(0, [-5, -300, 1.5, 2.25, 7, 8, 9, 10, -42n, 2n ** 40n, 3n, 4, -1, 'zażó'])
      .data(0, Array<null>(fields.length).fill(null));
    const [values, invalid] = fieldsOf(ok(b.file()).messages);
    expect(values).toEqual({
      1: -5,
      2: -300,
      3: 1.5,
      4: 2.25,
      5: 7,
      6: 8,
      7: 9,
      8: 10,
      9: -42,
      10: 2 ** 40,
      11: 3,
      12: 4,
      13: -1,
      14: 'zażó',
    });
    expect(Object.values(invalid ?? {}).every((v) => v === null)).toBe(true);
  });

  it('gives the first element of an array field; an odd size or unknown type is unreadable', () => {
    const b = new FitBuilder()
      .def(0, 99, [
        [1, 4, T.uint16], // array of two
        [2, 3, T.uint16], // 3 bytes is not a whole uint16 array
        [3, 2, 0x1f], // no such base type
        [4, 4, T.uint32],
      ])
      .raw(0x00, 0x34, 0x12, 0x78, 0x56, 1, 2, 3, 9, 9, 0x2a, 0, 0, 0);
    expect(fieldsOf(ok(b.file()).messages)).toEqual([{ 1: 0x1234, 2: null, 3: null, 4: 42 }]);
  });

  it('keeps only the wanted messages but still follows their timestamps', () => {
    const b = new FitBuilder()
      .def(0, 21, [[253, 4, T.uint32]]) // event: not wanted, but sets the time
      .def(1, 20, [[7, 2, T.uint16]])
      .data(0, [TS])
      .compressed(1, (TS + 1) % 32, [150]);
    const r = decodeFit(b.file(), { wanted: new Set([20]) });
    expect(r.ok && fieldsOf(r.messages)).toEqual([{ 7: 150, 253: TS + 1 }]);
  });
});
