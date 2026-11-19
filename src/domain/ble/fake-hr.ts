/**
 * Byte-level heart rate strap simulator (Heart Rate Measurement 0x2A37). Encodes with its own
 * helpers, independent of hrs.ts.
 */

export interface FakeHrOptions {
  /** Heart rate scenario: bpm as a function of ms since `startMs`. */
  bpm?: (tMs: number) => number;
  startMs?: number;
  format?: 'uint8' | 'uint16';
  contact?: 'unsupported' | 'none' | 'ok';
  /** RR intervals per notification (derived from the current bpm); 0 = none. */
  rrPerPacket?: number;
  /** When set, the Energy Expended field is sent with this value. */
  energyKj?: number;
}

export class FakeHrSensor {
  contact: 'unsupported' | 'none' | 'ok';
  energyKj: number | undefined;
  private readonly bpmAt: (tMs: number) => number;
  private readonly startMs: number;
  private readonly format: 'uint8' | 'uint16';
  private readonly rrPerPacket: number;

  constructor(options: FakeHrOptions = {}) {
    this.bpmAt = options.bpm ?? (() => 120);
    this.startMs = options.startMs ?? 0;
    this.format = options.format ?? 'uint8';
    this.contact = options.contact ?? 'ok';
    this.rrPerPacket = options.rrPerPacket ?? 0;
    this.energyKj = options.energyKj;
  }

  measure(nowMs: number): Uint8Array {
    const bpm = Math.max(0, Math.round(this.bpmAt(nowMs - this.startMs)));
    let flags = 0;
    const body: number[] = [];
    if (this.format === 'uint16') {
      flags |= 0x01;
      body.push(bpm & 0xff, (bpm >> 8) & 0xff);
    } else {
      body.push(Math.min(255, bpm));
    }
    if (this.contact !== 'unsupported') flags |= 0x04;
    if (this.contact === 'ok') flags |= 0x02;
    if (this.energyKj !== undefined) {
      flags |= 0x08;
      body.push(this.energyKj & 0xff, (this.energyKj >> 8) & 0xff);
    }
    if (this.rrPerPacket > 0 && bpm > 0) {
      flags |= 0x10;
      const rr = Math.round((60 / bpm) * 1024);
      for (let i = 0; i < this.rrPerPacket; i++) body.push(rr & 0xff, (rr >> 8) & 0xff);
    }
    return Uint8Array.of(flags, ...body);
  }
}
