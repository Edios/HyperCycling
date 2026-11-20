import { describe, expect, it } from 'vitest';
import { FakeTrainer, FakeTrainerDisconnectedError } from './fake-trainer';
import {
  mergeIndoorBikeData,
  parseControlPointResponse,
  parseFitnessMachineFeature,
  parseIndoorBikeData,
  parseMachineStatus,
  parseSupportedPowerRange,
  requestControl,
  reset,
  setIndoorBikeSimulation,
  setTargetPower,
  setTargetResistance,
  startOrResume,
  stopOrPause,
  type IndoorBikeData,
} from './ftms';

const hex = (bytes: Uint8Array | null) =>
  bytes === null
    ? null
    : Array.from(bytes, (x) => x.toString(16).padStart(2, '0').toUpperCase()).join(' ');

/** Runs the trainer at 1 Hz from `fromMs` to `toMs` and returns the merged parsed data per tick. */
function ride(trainer: FakeTrainer, fromMs: number, toMs: number): IndoorBikeData[] {
  const out: IndoorBikeData[] = [];
  let state: IndoorBikeData = {};
  for (let t = fromMs; t <= toMs; t += 1000) {
    for (const packet of trainer.tick(t))
      state = mergeIndoorBikeData(state, parseIndoorBikeData(packet));
    out.push(state);
  }
  return out;
}

function startErg(trainer: FakeTrainer, watts: number) {
  return [requestControl(), startOrResume(), setTargetPower(watts)].map((w) =>
    trainer.handleControlPoint(w),
  );
}

describe('FakeTrainer: control point', () => {
  it('Request Control → Start → Set Target Power 200 W succeeds and reaches ±5 % in ≤ 6 s', () => {
    const trainer = new FakeTrainer({ seed: 7 });
    // Warm-up: 10 s of free riding (about 100 W at 90 rpm) before ERG starts.
    const warmUp = ride(trainer, 0, 10_000).at(-1)!;
    expect(warmUp.powerW).toBeGreaterThan(90);
    const results = startErg(trainer, 200);
    expect(results.map((r) => parseControlPointResponse(r.response!).result)).toEqual([
      'success',
      'success',
      'success',
    ]);
    expect(results.map((r) => r.status.map((s) => parseMachineStatus(s)))).toEqual([
      [],
      [{ kind: 'startedOrResumed' }],
      [{ kind: 'targetPowerChanged', watts: 200 }],
    ]);
    expect(trainer.targetPowerW).toBe(200);
    const readings = ride(trainer, 11_000, 16_000);
    const at6s = readings.at(-1)!;
    expect(at6s.powerW).toBeGreaterThanOrEqual(190);
    expect(at6s.powerW).toBeLessThanOrEqual(210);
    expect(at6s.cadenceRpm).toBe(90);
    expect(at6s.speedKmh).toBeCloseTo(32.4, 2);
    expect(at6s.elapsedSec).toBe(16);
  });

  it('answers 0x05 to commands sent without Request Control', () => {
    const trainer = new FakeTrainer();
    for (const write of [startOrResume(), setTargetPower(200), reset()]) {
      const res = parseControlPointResponse(trainer.handleControlPoint(write).response!);
      expect(res.result).toBe('controlNotPermitted');
      expect(res.requestOpcode).toBe(write[0]);
    }
    expect(trainer.isRunning).toBe(false);
  });

  it('answers 0x02 to op codes it does not know', () => {
    const trainer = new FakeTrainer();
    trainer.handleControlPoint(requestControl());
    expect(hex(trainer.handleControlPoint(Uint8Array.of(0x13, 0x01)).response)).toBe('80 13 02');
  });

  it('answers 0x03 to wrong parameter lengths and out-of-range values', () => {
    const trainer = new FakeTrainer();
    trainer.handleControlPoint(requestControl());
    const result = (w: Uint8Array) =>
      parseControlPointResponse(trainer.handleControlPoint(w).response!).result;
    expect(result(Uint8Array.of(0x05, 0xc8))).toBe('invalidParameter');
    expect(result(setTargetPower(1600))).toBe('invalidParameter');
    expect(result(Uint8Array.of(0x05, 0xf6, 0xff))).toBe('invalidParameter'); // -10 W
    expect(result(Uint8Array.of(0x08, 0x03))).toBe('invalidParameter');
    // Old FTMS 1.0 uint8 resistance target: rejected, as by a Tacx Flux.
    expect(result(Uint8Array.of(0x04, 0x32))).toBe('invalidParameter');
    expect(trainer.targetPowerW).toBeNull();
  });

  it('stop, pause, resistance, simulation and reset produce status notifications', () => {
    const trainer = new FakeTrainer();
    startErg(trainer, 250);
    const statusOf = (w: Uint8Array) =>
      trainer.handleControlPoint(w).status.map((s) => parseMachineStatus(s));

    expect(statusOf(stopOrPause('pause'))).toEqual([{ kind: 'stoppedOrPaused', reason: 'pause' }]);
    expect(trainer.isRunning).toBe(false);
    expect(statusOf(stopOrPause('stop'))).toEqual([{ kind: 'stoppedOrPaused', reason: 'stop' }]);
    expect(statusOf(setTargetResistance(5))).toEqual([
      { kind: 'targetResistanceChanged', level: 5 },
    ]);
    expect(trainer.targetPowerW).toBeNull();
    const params = { windMps: 0, gradePct: 2, crr: 0.004, cwKgPerM: 0.51 };
    expect(statusOf(setIndoorBikeSimulation(params))).toEqual([
      { kind: 'simulationChanged', params },
    ]);
    expect(statusOf(reset())).toEqual([{ kind: 'reset' }]);
    expect(trainer.hasControl).toBe(false);
  });

  it('ignores an empty write', () => {
    expect(new FakeTrainer().handleControlPoint(new Uint8Array(0))).toEqual({
      response: null,
      status: [],
    });
  });
});

describe('FakeTrainer: injected faults', () => {
  it('rejectControl: Request Control is answered with 0x05', () => {
    const trainer = new FakeTrainer({ faults: { rejectControl: true } });
    expect(hex(trainer.handleControlPoint(requestControl()).response)).toBe('80 00 05');
    expect(trainer.hasControl).toBe(false);
  });

  it('unsupportedOpcodes: Set Target Power is answered with 0x02', () => {
    const trainer = new FakeTrainer({ faults: { unsupportedOpcodes: [0x05] } });
    trainer.handleControlPoint(requestControl());
    expect(hex(trainer.handleControlPoint(setTargetPower(200)).response)).toBe('80 05 02');
  });

  it('dropResponses: no response and no state change; can be switched off later', () => {
    const trainer = new FakeTrainer({ faults: { dropResponses: true } });
    expect(trainer.handleControlPoint(requestControl())).toEqual({ response: null, status: [] });
    expect(trainer.hasControl).toBe(false);
    trainer.faults = {};
    expect(hex(trainer.handleControlPoint(requestControl()).response)).toBe('80 00 01');
  });

  it('loseControl: 0xFF status, control and target dropped, power falls back to free ride', () => {
    const trainer = new FakeTrainer({ noiseW: 0 });
    startErg(trainer, 300);
    ride(trainer, 0, 10_000);
    expect(parseMachineStatus(trainer.loseControl())).toEqual({ kind: 'controlPermissionLost' });
    expect(trainer.hasControl).toBe(false);
    expect(trainer.targetPowerW).toBeNull();
    expect(
      parseControlPointResponse(trainer.handleControlPoint(setTargetPower(300)).response!).result,
    ).toBe('controlNotPermitted');
    const after = ride(trainer, 11_000, 30_000).at(-1)!;
    expect(after.powerW).toBe(100);
  });

  it('disconnect: no data, writes throw; reconnect needs Request Control again', () => {
    const trainer = new FakeTrainer();
    startErg(trainer, 200);
    trainer.disconnect();
    expect(trainer.isConnected).toBe(false);
    expect(trainer.tick(1000)).toEqual([]);
    expect(() => trainer.handleControlPoint(requestControl())).toThrow(
      FakeTrainerDisconnectedError,
    );
    trainer.reconnect();
    expect(trainer.isConnected).toBe(true);
    expect(trainer.tick(2000)).toHaveLength(1);
    expect(hex(trainer.handleControlPoint(setTargetPower(200)).response)).toBe('80 05 05');
  });
});

describe('FakeTrainer: data model', () => {
  it('is deterministic for the same seed and differs for another seed', () => {
    const run = (seed: number) => {
      const trainer = new FakeTrainer({ seed });
      startErg(trainer, 220);
      return [0, 1000, 2000, 3000, 4000].flatMap((t) => trainer.tick(t)).map(hex);
    };
    expect(run(42)).toEqual(run(42));
    expect(run(42)).not.toEqual(run(43));
  });

  it('splits each reading into two packets that merge into a complete one', () => {
    const trainer = new FakeTrainer({ splitPackets: true, noiseW: 0 });
    startErg(trainer, 200);
    const packets = trainer.tick(30_000);
    expect(packets).toHaveLength(2);
    const [first, second] = packets.map((p) => parseIndoorBikeData(p));
    expect(first).not.toHaveProperty('speedKmh');
    expect(second).not.toHaveProperty('powerW');
    expect(mergeIndoorBikeData(first!, second!)).toEqual({
      cadenceRpm: 90,
      powerW: 200,
      speedKmh: 32.4,
      elapsedSec: 30,
    });
  });

  it('follows the cadence scenario; zero cadence means zero power', () => {
    const trainer = new FakeTrainer({
      startMs: 1000,
      cadenceRpm: (t) => (t < 5000 ? 80.5 : 0),
    });
    startErg(trainer, 200);
    const readings = ride(trainer, 1000, 20_000);
    expect(readings[2]!.cadenceRpm).toBe(80.5);
    expect(readings.at(-1)).toMatchObject({ cadenceRpm: 0, powerW: 0, speedKmh: 0 });
  });

  it('without ERG the power follows the free-ride level scaled by cadence', () => {
    const trainer = new FakeTrainer({ noiseW: 0, freeRidePowerW: 150, cadenceRpm: () => 60 });
    expect(ride(trainer, 0, 30_000).at(-1)!.powerW).toBe(100);
  });

  it('a target change while paused waits until resume', () => {
    const trainer = new FakeTrainer({ noiseW: 0, freeRidePowerW: 90 });
    startErg(trainer, 250);
    trainer.handleControlPoint(stopOrPause('pause'));
    expect(ride(trainer, 0, 30_000).at(-1)!.powerW).toBe(90);
    trainer.handleControlPoint(startOrResume());
    expect(ride(trainer, 31_000, 60_000).at(-1)!.powerW).toBe(250);
  });

  it('describes itself with feature and power range bytes the parsers accept', () => {
    const trainer = new FakeTrainer({ maxPowerW: 1200 });
    expect(parseFitnessMachineFeature(trainer.featureBytes())).toMatchObject({
      supportsCadence: true,
      supportsPowerMeasurement: true,
      supportsTargetPower: true,
      supportsResistance: true,
      supportsSimulation: true,
    });
    expect(parseSupportedPowerRange(trainer.powerRangeBytes())).toEqual({
      min: 0,
      max: 1200,
      step: 1,
    });
  });
});
