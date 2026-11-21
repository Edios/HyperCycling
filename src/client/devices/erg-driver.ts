/**
 * ERG driver: turns the workout's moment into Control Point commands for the connected trainer.
 * Runs on its own 1 s interval (and on every trainer notification), never on the render loop, so
 * the target still changes at a block boundary in a hidden tab.
 *
 * - After every (re)connect: Request Control → Start/Resume → the current target (pitfall 1.8).
 *   Errors on Start are logged and do not block (pitfall table 2).
 * - Control refused (0x05) or lost (status 0xFF): one more Request Control, then "blocked" with
 *   a message; two timeouts with the link up → one forced reconnect (oss-trainer-pitfalls #2).
 * - Last target wins: at most one command in flight; the next tick computes a fresh target.
 * - Sprint blocks (D2) ride on fixed resistance; the cadence guard (D4) is optional.
 * - The rider can switch ERG off (free ride, flat road) and adjust ±5 %.
 */

import {
  requestControl,
  reset,
  setIndoorBikeSimulation,
  setTargetPower,
  setTargetResistance,
  startOrResume,
  stopOrPause,
  type ControlPointResponse,
} from '../../domain/ble/ftms';
import {
  BIAS_STEP_PCT,
  clampBias,
  controlModeFor,
  ergTargetWatts,
  GUARD_IDLE,
  guardFactor,
  rampValue,
  sanePowerRange,
  shouldWrite,
  SPRINT_RESISTANCE_PCT,
  startEntryRamp,
  startRamp,
  stepGuard,
  type ControlMode,
  type GuardState,
  type Ramp,
} from '../../domain/erg';
import { intensityAt, type Segment } from '../../domain/segments';
import type { TrainerSettings } from '../../domain/settings';
import type { DeviceStore } from './device-store';
import type { FtmsTrainer } from './trainer';

/** What the workout wants right now; null = no ride (setup, summary). */
export interface ErgMoment {
  segment: Segment;
  segmentIndex: number;
  elapsedInSegSec: number;
  /** Countdown, paused and finished are not running. */
  running: boolean;
  finished: boolean;
  ftp: number;
}

export type ErgStatus =
  /** No trainer, or not connected. */
  | 'idle'
  /** The trainer cannot take power targets (Feature bit 3, or answered 0x02). */
  | 'unsupported'
  /** The rider switched ERG off: free ride on a flat road. */
  | 'manual'
  /** Taking control (Request Control, Start). */
  | 'starting'
  | 'erg'
  /** Sprint block on fixed resistance. */
  | 'resistance'
  | 'paused'
  /** Another app holds the trainer. */
  | 'blocked';

export interface ErgSnapshot {
  status: ErgStatus;
  enabled: boolean;
  biasPct: number;
  /** Last target written (W), null in resistance / manual / idle. */
  targetW: number | null;
  /** The cadence guard lowered the target. */
  guardActive: boolean;
}

export interface ErgDriver {
  getSnapshot(): ErgSnapshot;
  subscribe(listener: () => void): () => void;
  setEnabled(on: boolean): void;
  /** ±1 step of 5 %. */
  nudge(steps: number): void;
  /** After "blocked": try to take control again. */
  retry(): void;
  /** Runs one decision step now (also called by the interval and on trainer data). */
  step(): Promise<void>;
  /** End of the ride: Stop and Reset so the trainer is not left on a high load (pitfall 1.10). */
  finish(): Promise<void>;
  dispose(): void;
}

export interface ErgDriverOptions {
  store: DeviceStore;
  moment: () => ErgMoment | null;
  settings: () => TrainerSettings;
  now?: () => number;
  tickMs?: number;
  /** No trainer data for this long during a ride forces a reconnect (pitfall 1.5). */
  watchdogMs?: number;
}

const FLAT_ROAD = { windMps: 0, gradePct: 0, crr: 0.004, cwKgPerM: 0.51 };

export function createErgDriver({
  store,
  moment,
  settings,
  now = () => Date.now(),
  tickMs = 1000,
  watchdogMs = 12_000,
}: ErgDriverOptions): ErgDriver {
  const listeners = new Set<() => void>();
  let snapshot: ErgSnapshot = {
    status: 'idle',
    enabled: true,
    biasPct: 0,
    targetW: null,
    guardActive: false,
  };
  let trainer: FtmsTrainer | null = null;
  let offTrainer: (() => void)[] = [];
  let controlled = false;
  let blocked = false;
  let refusals = 0;
  let timeouts = 0;
  let busy = false;
  let lastW: number | null = null;
  let lastAtMs: number | null = null;
  let lastSegment = -1;
  let lastMode: ControlMode | 'manual' | 'paused' | null = null;
  let ramp: Ramp | null = null;
  let guard: GuardState = GUARD_IDLE;
  let unsupported = false;

  function publish(patch: Partial<ErgSnapshot>): void {
    const next = { ...snapshot, ...patch };
    if (
      next.status === snapshot.status &&
      next.enabled === snapshot.enabled &&
      next.biasPct === snapshot.biasPct &&
      next.targetW === snapshot.targetW &&
      next.guardActive === snapshot.guardActive
    )
      return;
    snapshot = next;
    for (const l of listeners) l();
  }

  function loseControl(): void {
    controlled = false;
    lastW = null;
    lastAtMs = null;
    lastMode = null;
    ramp = null;
  }

  function follow(): void {
    const next = store.trainer();
    if (next === trainer) return;
    for (const off of offTrainer) off();
    offTrainer = [];
    trainer = next;
    loseControl();
    unsupported = false;
    blocked = false;
    refusals = 0;
    if (!trainer) return;
    offTrainer.push(
      trainer.connection.subscribe((s) => {
        // A new link: the trainer forgot who controls it and the target (pitfall 1.8).
        if (s.state !== 'connected') loseControl();
        void step();
      }),
      trainer.onStatus((s) => {
        if (s.kind === 'controlPermissionLost') {
          store.log.add('trainer', 'state', 'ERG: control lost (0xFF)');
          loseControl();
        } else if (s.kind === 'unknown' && s.code === 0x03) {
          // Stopped by the safety key: treat as a stop, take control again on the next step.
          store.log.add('trainer', 'state', 'ERG: stopped by safety key (0x03)');
          loseControl();
        }
      }),
      trainer.onData(() => void step()),
    );
  }

  async function send(bytes: Uint8Array): Promise<ControlPointResponse | null> {
    if (!trainer) return null;
    try {
      const res = await trainer.command(bytes);
      timeouts = 0;
      return res;
    } catch (error) {
      const name = (error as Error).name;
      store.log.add('trainer', 'error', `ERG ${name}: ${(error as Error).message}`);
      if (name === 'ControlPointTimeoutError') {
        timeouts += 1;
        // Some trainers accept control only on a fresh connection (oss-trainer-pitfalls #2).
        if (timeouts >= 2) {
          timeouts = 0;
          forceReconnect('two Control Point timeouts');
        }
      }
      loseControl();
      return null;
    }
  }

  function forceReconnect(reason: string): void {
    const gatt = trainer?.connection.device.gatt;
    if (!gatt?.connected) return;
    store.log.add('trainer', 'state', `ERG: forcing a reconnect (${reason})`);
    // The connection sees a dropped link and runs its usual reconnect cycle.
    gatt.disconnect();
  }

  /** Stop, then Reset: the trainer drops the ERG load and gives control back (pitfall 1.10). */
  async function stopAndReset(): Promise<void> {
    await send(stopOrPause('stop'));
    await send(reset());
    loseControl();
  }

  async function takeControl(): Promise<boolean> {
    publish({ status: 'starting' });
    const res = await send(requestControl());
    if (!res) return false;
    if (res.result !== 'success') {
      refusals += 1;
      if (refusals >= 2) {
        blocked = true;
        publish({ status: 'blocked', targetW: null });
      }
      return false;
    }
    refusals = 0;
    const start = await send(startOrResume());
    if (start && start.result !== 'success') {
      store.log.add('trainer', 'state', `ERG: Start answered ${start.result}, going on`);
    }
    controlled = true;
    lastW = null;
    lastAtMs = null;
    lastMode = null;
    return true;
  }

  async function decide(): Promise<void> {
    follow();
    const connected = trainer?.connection.status().state === 'connected';
    if (!trainer || !connected) {
      publish({ status: 'idle', targetW: null, guardActive: false });
      return;
    }
    const features = trainer.features();
    if (unsupported || (features && !features.supportsTargetPower)) {
      publish({ status: 'unsupported', targetW: null });
      return;
    }
    if (blocked) {
      publish({ status: 'blocked', targetW: null });
      return;
    }
    const m = moment();
    const t = now();

    // Watchdog: connected but silent while riding.
    const latest = trainer.latest();
    if (m?.running && latest && t - latest.atMs > watchdogMs) {
      forceReconnect('no data');
      return;
    }

    if (m?.finished) {
      // End of the ride: leave the trainer free, not on the last ERG load (review #113 B1).
      if (controlled) await stopAndReset();
      publish({ status: 'idle', targetW: null, guardActive: false });
      return;
    }
    if (!m) {
      publish({ status: controlled ? 'paused' : 'idle', targetW: null });
      return;
    }
    if (!controlled && !(await takeControl())) return;

    if (!snapshot.enabled) {
      if (lastMode !== 'manual') {
        const res = await send(setIndoorBikeSimulation(FLAT_ROAD));
        if (res) lastMode = 'manual';
      }
      publish({ status: 'manual', targetW: null, guardActive: false });
      return;
    }

    if (!m.running) {
      if (lastMode !== 'paused') {
        const res = await send(stopOrPause('pause'));
        if (res) lastMode = 'paused';
        lastW = null;
      }
      publish({ status: 'paused', targetW: null });
      return;
    }
    if (lastMode === 'paused') {
      await send(startOrResume());
      lastMode = null;
    }

    const boundary = m.segmentIndex !== lastSegment;
    const mode = controlModeFor(m.segment, settings().sprintMode);
    if (mode === 'resistance') {
      if (lastMode !== 'resistance' || boundary) {
        const res = await send(setTargetResistance(SPRINT_RESISTANCE_PCT));
        if (res) {
          // Even when refused, do not repeat it every second; the block ends soon.
          if (res.result !== 'success') {
            store.log.add('trainer', 'state', `ERG: resistance answered ${res.result}`);
          }
          lastMode = 'resistance';
          lastSegment = m.segmentIndex;
          lastW = null;
        }
      }
      publish({ status: 'resistance', targetW: null, guardActive: false });
      return;
    }

    const trainerSettings = settings();
    guard = trainerSettings.cadenceGuard
      ? stepGuard(guard, latest?.data.cadenceRpm ?? null, t)
      : GUARD_IDLE;
    const { ftpPct } = intensityAt(m.segment, m.elapsedInSegSec);
    const goal = Math.round(
      ergTargetWatts({
        ftp: m.ftp,
        ftpPct,
        biasPct: snapshot.biasPct,
        range: sanePowerRange(trainer.powerRange()),
      }) * guardFactor(guard, t),
    );
    if (boundary || lastMode !== 'erg') {
      // No previous target (new control, after a pause, a reconnect or ERG back on): an entry
      // ramp from the measured power, never the full target at once (review #113 B3).
      const fresh = latest && t - latest.atMs <= 3000 ? (latest.data.powerW ?? null) : null;
      ramp = lastW === null ? startEntryRamp(fresh, goal, t) : startRamp(lastW, goal, m.ftp, t);
    } else if (ramp && ramp.toW !== goal) {
      ramp = { ...ramp, toW: goal };
    }
    const target = ramp ? rampValue(ramp, t) : goal;
    // The last step of a ramp is always written, even if it is only 1–2 W from the previous one.
    const rampEnds = ramp !== null && target === ramp.toW && lastW !== target;
    if (ramp && target === ramp.toW) ramp = null;
    if (
      shouldWrite({
        lastW,
        lastAtMs,
        nextW: target,
        nowMs: t,
        ftp: m.ftp,
        boundary: boundary || rampEnds,
      }) ||
      lastMode !== 'erg'
    ) {
      const res = await send(setTargetPower(target));
      if (res?.result === 'success') {
        lastW = target;
        lastAtMs = t;
        lastMode = 'erg';
        lastSegment = m.segmentIndex;
      } else if (res?.result === 'notSupported') {
        unsupported = true;
        publish({ status: 'unsupported', targetW: null });
        return;
      } else if (res?.result === 'controlNotPermitted') {
        loseControl();
      }
    }
    publish({
      status: controlled ? 'erg' : 'starting',
      targetW: lastW,
      guardActive: guard.phase === 'active' || guard.phase === 'recovering',
    });
  }

  async function step(): Promise<void> {
    if (busy) return; // last wins: the next tick computes a fresh target
    busy = true;
    try {
      await decide();
    } finally {
      busy = false;
    }
  }

  const offStore = store.subscribe(() => void step());
  const timer = setInterval(() => void step(), tickMs);

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setEnabled(on) {
      publish({ enabled: on });
      // Back to ERG: the next step writes the current target at once.
      if (on) lastMode = null;
      void step();
    },
    nudge(steps) {
      publish({ biasPct: clampBias(snapshot.biasPct + steps * BIAS_STEP_PCT) });
      void step();
    },
    retry() {
      blocked = false;
      refusals = 0;
      loseControl();
      void step();
    },
    step,
    async finish() {
      if (trainer && controlled) await stopAndReset();
      loseControl();
      publish({ status: 'idle', targetW: null });
    },
    dispose() {
      clearInterval(timer);
      offStore();
      for (const off of offTrainer) off();
      offTrainer = [];
      listeners.clear();
    },
  };
}
