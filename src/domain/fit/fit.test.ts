import { describe, expect, it } from 'vitest';
import { summarizeRide, type RideRecord } from '../ride';
import { crc16 } from './crc16';
import { encodeRideToFit } from './encode-ride';
import { createFitWriter, FIT_EPOCH_UNIX_SEC, fitTimestamp } from './writer';

// ---- a minimal FIT reader, written from the public file format description, to read back what
// the writer produced (header, CRCs, definitions, data) without trusting the writer's own code.

interface Message {
  global: number;
  /** Field number -> value; null for the type's "invalid" marker. */
  fields: Record<number, number | string | null>;
}

const SIZES: Record<number, { size: number; invalid: number }> = {
  0x00: { size: 1, invalid: 0xff },
  0x02: { size: 1, invalid: 0xff },
  0x84: { size: 2, invalid: 0xffff },
  0x86: { size: 4, invalid: 0xffffffff },
  0x8c: { size: 4, invalid: 0 },
};

function readLe(bytes: Uint8Array, at: number, size: number): number {
  let v = 0;
  for (let i = size - 1; i >= 0; i -= 1) v = v * 256 + (bytes[at + i] ?? 0);
  return v;
}

function decode(bytes: Uint8Array): {
  header: Record<string, number | string>;
  messages: Message[];
} {
  expect(bytes[0]).toBe(14); // header size
  expect(String.fromCharCode(...bytes.slice(8, 12))).toBe('.FIT');
  const dataSize = readLe(bytes, 4, 4);
  expect(bytes.length).toBe(14 + dataSize + 2);
  expect(readLe(bytes, 12, 2)).toBe(crc16(bytes.slice(0, 12))); // header CRC
  expect(readLe(bytes, bytes.length - 2, 2)).toBe(crc16(bytes.slice(0, bytes.length - 2))); // file CRC

  const defs = new Map<
    number,
    { global: number; fields: { num: number; size: number; type: number }[] }
  >();
  const messages: Message[] = [];
  let at = 14;
  const end = 14 + dataSize;
  while (at < end) {
    const head = bytes[at++] ?? 0;
    expect(head & 0x80).toBe(0); // no compressed timestamp headers
    const local = head & 0x0f;
    if (head & 0x40) {
      expect(bytes[at]).toBe(0); // reserved
      expect(bytes[at + 1]).toBe(0); // little endian
      const global = readLe(bytes, at + 2, 2);
      const count = bytes[at + 4] ?? 0;
      at += 5;
      const fields = [];
      for (let i = 0; i < count; i += 1) {
        fields.push({ num: bytes[at] ?? 0, size: bytes[at + 1] ?? 0, type: bytes[at + 2] ?? 0 });
        at += 3;
      }
      defs.set(local, { global, fields });
    } else {
      const def = defs.get(local);
      expect(def, `data for undefined local type ${local}`).toBeDefined();
      const fields: Message['fields'] = {};
      for (const f of def!.fields) {
        if (f.type === 0x07) {
          const raw = [...bytes.slice(at, at + f.size)];
          fields[f.num] = String.fromCharCode(...raw.filter((c) => c !== 0));
          expect(raw[raw.length - 1]).toBe(0); // zero terminated
        } else {
          const info = SIZES[f.type]!;
          expect(info.size, `size of field ${f.num}`).toBe(f.size);
          const v = readLe(bytes, at, f.size);
          fields[f.num] = v === info.invalid ? null : v;
        }
        at += f.size;
      }
      messages.push({ global: def!.global, fields });
    }
  }
  expect(at).toBe(end);
  return { header: { protocol: bytes[1] ?? 0, profile: readLe(bytes, 2, 2) }, messages };
}

// ---- fixtures

const START = '2026-11-22T08:00:00.000Z';
const startFit = Math.round(Date.parse(START) / 1000) - FIT_EPOCH_UNIX_SEC;

function ride(over: Partial<RideRecord> = {}): RideRecord {
  // 6 samples at 1 Hz, a 30 s pause after the 3rd (samples 4..6 are ridden after it), two blocks.
  const power = [200, 210, null, 220, 230, 240];
  const cadence = [90, 91, null, 92, 93, 94];
  const heartRate = [120, 121, 122, null, 124, 125];
  const samples = {
    timeMs: [1000, 2000, 3000, 34_000, 35_000, 36_000],
    power,
    cadence,
    heartRate,
    targetW: [200, 200, 200, 220, 220, 220],
    segmentIndex: [0, 0, 0, 1, 1, 1],
  };
  return {
    id: 'ride-1',
    schemaVersion: 1,
    sessionLogId: 'ride-1',
    workoutId: 'w1',
    startedAt: START,
    endedAt: '2026-11-22T08:00:40.000Z',
    sampleSec: 1,
    ftp: 250,
    hrMax: 190,
    samples,
    events: [
      { atSec: 3, atMs: 3000, kind: 'pause' },
      { atSec: 3, atMs: 33_000, kind: 'resume' },
      { atSec: 3, atMs: 33_500, kind: 'signalLost' }, // not a timer event
    ],
    blocks: [],
    summary: summarizeRide(samples, [], 190),
    ...over,
  };
}

const ofGlobal = (messages: Message[], global: number) =>
  messages.filter((m) => m.global === global);

describe('crc16', () => {
  it('matches the published check value of CRC-16/ARC', () => {
    expect(crc16(Uint8Array.from([...'123456789'].map((c) => c.charCodeAt(0))))).toBe(0xbb3d);
    expect(crc16([])).toBe(0);
    // Continuing a run gives the same result as one pass.
    const all = [1, 2, 3, 4, 5, 6];
    expect(crc16(all.slice(3), crc16(all.slice(0, 3)))).toBe(crc16(all));
  });
});

describe('FIT writer', () => {
  it('writes the header, definitions, data and both CRCs; "invalid" marks a missing value', () => {
    const w = createFitWriter();
    const local = w.define(20, [
      { num: 253, type: 'uint32' },
      { num: 3, type: 'uint8' },
      { num: 7, type: 'uint16' },
    ]);
    w.write(local, [10, 150, 300]);
    w.write(local, [11, null, 70_000]); // missing, and out of range: both invalid
    const bytes = w.finish();
    expect(bytes[0]).toBe(14);
    expect(bytes[1]).toBe(0x20);
    const { messages } = decode(bytes);
    expect(messages).toEqual([
      { global: 20, fields: { 253: 10, 3: 150, 7: 300 } },
      { global: 20, fields: { 253: 11, 3: null, 7: null } },
    ]);
    // 14 header + (1 + 5 + 3 fields*3) definition + 2 * (1 + 4 + 1 + 2) data + 2 CRC
    expect(bytes.length).toBe(14 + 15 + 16 + 2);
  });

  it('keeps strings zero terminated and ASCII, and refuses a 17th message type', () => {
    const w = createFitWriter();
    const local = w.define(0, [{ num: 8, type: 'string', size: 6 }]);
    w.write(local, ['HyperCycling']);
    w.write(local, ['Zażółć']);
    const { messages } = decode(w.finish());
    expect(messages.map((m) => m.fields[8])).toEqual(['Hyper', 'Za???']);
    const full = createFitWriter();
    for (let i = 0; i < 16; i += 1) full.define(i, [{ num: 0, type: 'enum' }]);
    expect(() => full.define(99, [{ num: 0, type: 'enum' }])).toThrow(/16/);
    expect(() => full.write(16, [1])).toThrow(/not defined/);
  });

  it('counts FIT time from 1989-12-31 UTC', () => {
    expect(fitTimestamp(Date.parse('1989-12-31T00:00:10.000Z'))).toBe(10);
    expect(fitTimestamp(Date.parse('2000-01-01T00:00:00.000Z'))).toBe(315_619_200);
  });
});

describe('encodeRideToFit', () => {
  const { messages, header } = decode(encodeRideToFit(ride(), { utcOffsetSec: 3600 }));

  it('is a protocol 2 activity file by HyperCycling, the same serial for the same ride', () => {
    expect(header.protocol).toBe(0x20);
    const [id] = ofGlobal(messages, 0);
    expect(id!.fields).toMatchObject({ 0: 4, 1: 255, 4: startFit, 8: 'HyperCycling' });
    expect(id!.fields[3]).toBeGreaterThan(0);
    const again = decode(encodeRideToFit(ride()));
    expect(ofGlobal(again.messages, 0)[0]!.fields[3]).toBe(id!.fields[3]);
    const other = decode(encodeRideToFit(ride({ id: 'ride-2' })));
    expect(ofGlobal(other.messages, 0)[0]!.fields[3]).not.toBe(id!.fields[3]);
  });

  it('has one record per sample with the values, null (never 0 W) for a missing reading', () => {
    const records = ofGlobal(messages, 20);
    expect(records.map((r) => r.fields[7])).toEqual([200, 210, null, 220, 230, 240]);
    expect(records.map((r) => r.fields[4])).toEqual([90, 91, null, 92, 93, 94]);
    expect(records.map((r) => r.fields[3])).toEqual([120, 121, 122, null, 124, 125]);
    // 1 Hz timestamps from the clock times: the 30 s pause is a gap, not a second.
    expect(records.map((r) => (r.fields[253] as number) - startFit)).toEqual([1, 2, 3, 34, 35, 36]);
  });

  it('turns a pause into a timer stop and the resume into a timer start, in time order', () => {
    const order = messages
      .filter((m) => m.global === 20 || m.global === 21)
      .map((m) =>
        m.global === 20
          ? `r${(m.fields[253] as number) - startFit}`
          : `${m.fields[1] === 0 ? 'start' : 'stop'}${(m.fields[253] as number) - startFit}`,
      );
    expect(order).toEqual([
      'start0',
      'r1',
      'r2',
      'r3',
      'stop3',
      'start33',
      'r34',
      'r35',
      'r36',
      'stop36',
    ]);
    expect(ofGlobal(messages, 21).every((e) => e.fields[0] === 0)).toBe(true); // timer events
    expect(ofGlobal(messages, 21).filter((e) => e.fields[1] === 4)).toHaveLength(2); // stop_all
  });

  it('has one lap per run of a block with its own averages, and the session adds up', () => {
    const laps = ofGlobal(messages, 19);
    expect(laps).toHaveLength(2);
    expect(laps[0]!.fields).toMatchObject({
      254: 0,
      2: startFit, // start
      253: startFit + 3, // end
      7: 3000, // elapsed ms
      8: 3000, // timer ms
      19: 205, // avg power (null skipped)
      20: 210,
      15: 121, // avg HR
      16: 122,
      24: 0, // manual
    });
    expect(laps[1]!.fields).toMatchObject({
      254: 1,
      2: startFit + 3,
      253: startFit + 36,
      7: 33_000, // includes the pause
      8: 3000,
      19: 230,
      20: 240,
      24: 7, // session end
    });
    const [session] = ofGlobal(messages, 18);
    expect(session!.fields).toMatchObject({
      5: 2, // cycling
      6: 6, // indoor cycling
      2: startFit,
      253: startFit + 36,
      7: 36_000, // elapsed
      8: 6000, // timer: only the ridden seconds
      20: 220, // avg power
      21: 240,
      45: 250, // threshold power = FTP
      25: 0,
      26: 2,
      48: 1100, // J: 200+210+220+230+240
    });
    const [activity] = ofGlobal(messages, 34);
    expect(activity!.fields).toMatchObject({
      253: startFit + 36,
      0: 6000,
      1: 1,
      3: 26,
      4: 1,
      5: startFit + 36 + 3600, // local time
    });
  });

  it('can leave the heart rate out of every message', () => {
    const { messages: bare } = decode(encodeRideToFit(ride(), { includeHeartRate: false }));
    for (const m of bare) {
      if (m.global === 20) expect(m.fields).not.toHaveProperty('3');
      if (m.global === 19) expect(m.fields).not.toHaveProperty('15');
      if (m.global === 18) expect(m.fields).not.toHaveProperty('16');
    }
    expect(ofGlobal(bare, 20)).toHaveLength(6);
    expect(ofGlobal(bare, 20)[0]!.fields[7]).toBe(200);
  });

  it('keeps timestamps strictly increasing when the clock times are not a whole second apart', () => {
    const samples = {
      ...ride().samples,
      timeMs: [1000, 1499, 1999, 2400, 3399, 4100],
    };
    const { messages: m } = decode(encodeRideToFit(ride({ samples, events: [] })));
    const t = ofGlobal(m, 20).map((r) => r.fields[253] as number);
    expect(t.every((v, i) => i === 0 || v > t[i - 1]!)).toBe(true);
    // No pause events: one start, one stop.
    expect(ofGlobal(m, 21).map((e) => e.fields[1])).toEqual([0, 4]);
  });

  it('a ride that ends while paused, and a missing FTP, still make a valid file', () => {
    const samples = {
      timeMs: [1000, 2000, 3000, 4000, 5000, 6000],
      power: [100, 100, 100, 100, 100, 100],
      cadence: [80, 80, 80, 80, 80, 80],
      heartRate: [null, null, null, null, null, null],
      targetW: [null, null, null, null, null, null],
      segmentIndex: [0, 0, 0, 0, 0, 0],
    };
    const r = ride({
      ftp: null,
      events: [{ atSec: 6, atMs: 36_500, kind: 'autoPause' }],
      samples,
      summary: summarizeRide(samples, [], 190),
    });
    const { messages: m } = decode(encodeRideToFit(r));
    expect(ofGlobal(m, 18)[0]!.fields[45]).toBeNull();
    expect(ofGlobal(m, 18)[0]!.fields[16]).toBeNull(); // no heart rate at all
    // The pause after the last sample is the one and only stop.
    expect(ofGlobal(m, 21).map((e) => e.fields[1])).toEqual([0, 4]);
    expect(ofGlobal(m, 19)).toHaveLength(1);
  });

  it('survives a ride without samples (nothing to lose, nothing to crash on)', () => {
    const empty = {
      timeMs: [],
      power: [],
      cadence: [],
      heartRate: [],
      targetW: [],
      segmentIndex: [],
    };
    const { messages: m } = decode(encodeRideToFit(ride({ samples: empty, events: [] })));
    expect(ofGlobal(m, 20)).toHaveLength(0);
    expect(ofGlobal(m, 19)).toHaveLength(0);
    expect(ofGlobal(m, 18)).toHaveLength(1);
  });

  it('a pause event outside a running timer and a stray resume change nothing', () => {
    const r = ride({
      events: [
        { atSec: 0, atMs: 500, kind: 'resume' }, // already running
        { atSec: 3, atMs: 3000, kind: 'pause' },
        { atSec: 3, atMs: 3100, kind: 'deviceStop' }, // already stopped
        { atSec: 3, atMs: 33_000, kind: 'resume' },
      ],
    });
    const { messages: m } = decode(encodeRideToFit(r));
    expect(ofGlobal(m, 21).map((e) => e.fields[1])).toEqual([0, 4, 0, 4]);
  });
});
