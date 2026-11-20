/**
 * Deterministic byte-level FTMS indoor bike simulator for tests and the future /dev mode.
 *
 * It encodes and decodes bytes with its own helpers and does NOT import the parsers in ftms.ts,
 * so a parser bug cannot be hidden by the same bug in the simulator. Time is passed in by the
 * caller and noise comes from a seeded PRNG: the same seed and calls give the same bytes.
 */

// Op codes written out here on purpose (independent of ftms.ts). Values: research report / FTMS 1.0.
const OP = {
  requestControl: 0x00,
  reset: 0x01,
  setTargetResistance: 0x04,
  setTargetPower: 0x05,
  startOrResume: 0x07,
  stopOrPause: 0x08,
  setIndoorBikeSimulation: 0x11,
  response: 0x80,
} as const;

const RESULT = {
  success: 0x01,
  notSupported: 0x02,
  invalidParameter: 0x03,
  controlNotPermitted: 0x05,
} as const;

const STATUS = {
  reset: 0x01,
  stoppedOrPaused: 0x02,
  startedOrResumed: 0x04,
  targetResistanceChanged: 0x07,
  targetPowerChanged: 0x08,
  simulationChanged: 0x12,
  controlPermissionLost: 0xff,
} as const;

/** Parameter length per supported op code. */
const PARAM_LENGTH: Record<number, number> = {
  [OP.requestControl]: 0,
  [OP.reset]: 0,
  // sint16 ×0.1 (FTMS erratum); like a Tacx Flux, the 1-byte uint8 form is an invalid parameter.
  [OP.setTargetResistance]: 2,
  [OP.setTargetPower]: 2,
  [OP.startOrResume]: 0,
  [OP.stopOrPause]: 1,
  [OP.setIndoorBikeSimulation]: 6,
};

export interface FakeTrainerFaults {
  /** Request Control is answered with 0x05 (another app holds control). */
  rejectControl?: boolean;
  /** These op codes are answered with 0x02 (not supported). */
  unsupportedOpcodes?: readonly number[];
  /** Control Point writes are swallowed: no response, no state change. */
  dropResponses?: boolean;
}

export interface FakeTrainerOptions {
  seed?: number;
  /** Simulated time origin in ms; `cadenceRpm` receives time since this moment. */
  startMs?: number;
  /** Cadence scenario: rpm as a function of ms since start. */
  cadenceRpm?: (tMs: number) => number;
  /** Time constant of the power response to a new target. */
  powerTimeConstantMs?: number;
  /** Uniform noise amplitude added to reported power (± this many watts). */
  noiseW?: number;
  /** Power when not in ERG (free ride on the trainer's base resistance) at 90 rpm. */
  freeRidePowerW?: number;
  /** Send each reading as two notifications (bit 0 "More Data" set on the first). */
  splitPackets?: boolean;
  minPowerW?: number;
  maxPowerW?: number;
  faults?: FakeTrainerFaults;
}

export interface ControlPointResult {
  /** Indication on the Control Point (0x80 response), or null when none is sent. */
  response: Uint8Array | null;
  /** Fitness Machine Status notifications caused by the command. */
  status: Uint8Array[];
}

export class FakeTrainerDisconnectedError extends Error {
  constructor() {
    super('Fake trainer is disconnected');
    this.name = 'FakeTrainerDisconnectedError';
  }
}

/** mulberry32: small deterministic PRNG returning floats in [0, 1). */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const le16 = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff];
const readS16 = (b: Uint8Array, at: number): number =>
  new DataView(b.buffer, b.byteOffset, b.byteLength).getInt16(at, true);

/** Wheel roll-out per crank revolution used for the simulated speed (m). */
const METRES_PER_CRANK_REV = 6;

export class FakeTrainer {
  readonly minPowerW: number;
  readonly maxPowerW: number;
  faults: FakeTrainerFaults;

  private readonly random: () => number;
  private readonly startMs: number;
  private readonly cadenceAt: (tMs: number) => number;
  private readonly tauMs: number;
  private readonly noiseW: number;
  private readonly freeRidePowerW: number;
  private readonly split: boolean;

  private connected = true;
  private control = false;
  private running = false;
  private ergTargetW: number | null = null;
  private modelPowerW = 0;
  private lastTickMs: number;

  constructor(options: FakeTrainerOptions = {}) {
    this.random = prng(options.seed ?? 1);
    this.startMs = options.startMs ?? 0;
    this.lastTickMs = this.startMs;
    this.cadenceAt = options.cadenceRpm ?? (() => 90);
    this.tauMs = options.powerTimeConstantMs ?? 2000;
    this.noiseW = options.noiseW ?? 3;
    this.freeRidePowerW = options.freeRidePowerW ?? 100;
    this.split = options.splitPackets ?? false;
    this.minPowerW = options.minPowerW ?? 0;
    this.maxPowerW = options.maxPowerW ?? 1500;
    this.faults = { ...options.faults };
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get hasControl(): boolean {
    return this.control;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get targetPowerW(): number | null {
    return this.ergTargetW;
  }

  /** Fitness Machine Feature: cadence, power measurement; targets resistance, power, simulation. */
  featureBytes(): Uint8Array {
    const machine = (1 << 1) | (1 << 14);
    const target = (1 << 2) | (1 << 3) | (1 << 13);
    return Uint8Array.of(...le16(machine), ...le16(machine >>> 16), ...le16(target), 0, 0);
  }

  /** Supported Power Range: min, max, 1 W step. */
  powerRangeBytes(): Uint8Array {
    return Uint8Array.of(...le16(this.minPowerW), ...le16(this.maxPowerW), ...le16(1));
  }

  /** Handles one Control Point write and returns the indication and status notifications. */
  handleControlPoint(write: Uint8Array): ControlPointResult {
    if (!this.connected) throw new FakeTrainerDisconnectedError();
    const opcode = write[0];
    if (opcode === undefined || this.faults.dropResponses) return { response: null, status: [] };
    const respond = (result: number, status: Uint8Array[] = []): ControlPointResult => ({
      response: Uint8Array.of(OP.response, opcode, result),
      status,
    });

    const paramLength = PARAM_LENGTH[opcode];
    if (paramLength === undefined || this.faults.unsupportedOpcodes?.includes(opcode)) {
      return respond(RESULT.notSupported);
    }
    if (opcode === OP.requestControl) {
      if (this.faults.rejectControl) return respond(RESULT.controlNotPermitted);
      this.control = true;
      return respond(RESULT.success);
    }
    if (!this.control) return respond(RESULT.controlNotPermitted);
    if (write.length !== 1 + paramLength) return respond(RESULT.invalidParameter);

    switch (opcode) {
      case OP.reset:
        this.control = false;
        this.running = false;
        this.ergTargetW = null;
        return respond(RESULT.success, [Uint8Array.of(STATUS.reset)]);
      case OP.startOrResume:
        this.running = true;
        return respond(RESULT.success, [Uint8Array.of(STATUS.startedOrResumed)]);
      case OP.stopOrPause: {
        const param = write[1];
        if (param !== 0x01 && param !== 0x02) return respond(RESULT.invalidParameter);
        this.running = false;
        return respond(RESULT.success, [Uint8Array.of(STATUS.stoppedOrPaused, param)]);
      }
      case OP.setTargetPower: {
        const watts = readS16(write, 1);
        if (watts < this.minPowerW || watts > this.maxPowerW) {
          return respond(RESULT.invalidParameter);
        }
        this.ergTargetW = watts;
        return respond(RESULT.success, [Uint8Array.of(STATUS.targetPowerChanged, ...le16(watts))]);
      }
      case OP.setTargetResistance:
        this.ergTargetW = null;
        return respond(RESULT.success, [
          Uint8Array.of(STATUS.targetResistanceChanged, ...write.slice(1)),
        ]);
      default:
        // OP.setIndoorBikeSimulation: leaves ERG; the status echoes the six parameter bytes.
        this.ergTargetW = null;
        return respond(RESULT.success, [
          Uint8Array.of(STATUS.simulationChanged, ...write.slice(1)),
        ]);
    }
  }

  /** Advances the model to `nowMs` and returns the Indoor Bike Data notification(s). */
  tick(nowMs: number): Uint8Array[] {
    if (!this.connected) return [];
    const dt = Math.max(0, nowMs - this.lastTickMs);
    this.lastTickMs = nowMs;
    const cadence = Math.max(0, this.cadenceAt(nowMs - this.startMs));
    const target = cadence <= 0 ? 0 : this.effectiveTargetW(cadence);
    this.modelPowerW += (target - this.modelPowerW) * (1 - Math.exp(-dt / this.tauMs));
    const noise = cadence <= 0 ? 0 : (this.random() * 2 - 1) * this.noiseW;
    const power = Math.max(0, Math.round(this.modelPowerW + noise));
    const speed = Math.round(((cadence * METRES_PER_CRANK_REV * 60) / 1000) * 100);
    const cadenceHalf = Math.round(cadence * 2);
    const elapsedSec = Math.floor((nowMs - this.startMs) / 1000);

    const cadenceAndPower = [...le16(cadenceHalf), ...le16(power & 0xffff)];
    if (this.split) {
      // First: More Data (bit 0 = 1, no speed) + cadence (bit 2) + power (bit 6).
      // Second: speed (bit 0 = 0) + elapsed time (bit 11).
      return [
        Uint8Array.of(...le16(0x0045), ...cadenceAndPower),
        Uint8Array.of(...le16(0x0800), ...le16(speed), ...le16(elapsedSec)),
      ];
    }
    // Speed (bit 0 = 0) + cadence (bit 2) + power (bit 6) + elapsed time (bit 11).
    return [
      Uint8Array.of(...le16(0x0844), ...le16(speed), ...cadenceAndPower, ...le16(elapsedSec)),
    ];
  }

  /** Another app takes over: control is dropped and the 0xFF status is returned. */
  loseControl(): Uint8Array {
    this.control = false;
    this.ergTargetW = null;
    return Uint8Array.of(STATUS.controlPermissionLost);
  }

  /** Link drop: tick returns nothing and Control Point writes throw until reconnect(). */
  disconnect(): void {
    this.connected = false;
  }

  /** New link: like a real trainer, control must be requested again. */
  reconnect(): void {
    this.connected = true;
    this.control = false;
  }

  private effectiveTargetW(cadence: number): number {
    if (this.running && this.ergTargetW !== null) return this.ergTargetW;
    return (this.freeRidePowerW * cadence) / 90;
  }
}
