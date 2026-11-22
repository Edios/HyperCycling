import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { RideBlock, RideEventKind } from '../../domain/ride';
import type { EngineStatus } from '../../domain/session-engine';
import type { LinkState } from '../devices/live-metrics';
import {
  clearRideBuffer,
  createRideRecorder,
  loadRideBuffer,
  saveRideBuffer,
  type RideRecorder,
  type RideSampleInput,
} from './ride-recorder';

/** How often the riding clock is checked; samples follow the clock, not this timer. */
export const RIDE_SAMPLE_MS = 250;
/** How often the recording is copied to session storage while riding. */
export const RIDE_FLUSH_MS = 5000;

const PAUSE_KINDS: ReadonlySet<RideEventKind> = new Set(['pause', 'autoPause', 'deviceStop']);

export interface RideRecorderInput {
  status: EngineStatus;
  /** The trainer link: 'off' when there is no trainer. */
  trainerLink: LinkState;
  /** Power of the second just ended (raw readings, not the HUD's 3 s average); null = none. */
  readPowerW: () => number | null;
  cadenceRpm: number | null;
  hrBpm: number | null;
  targetW: number | null;
  segmentIndex: number;
  /** ERG switched on by the rider; null without ERG. */
  ergEnabled: boolean | null;
}

export interface RideRecorderOptions {
  workoutId: string;
  /** The ride was resumed (reload, back from another screen): carry on with the kept buffer. */
  resumed: boolean;
  /**
   * Why the next pause happens ('autoPause' / 'deviceStop'), set by whoever pauses; read and
   * cleared when the pause is recorded. Unset means the rider paused.
   */
  pauseReasonRef: MutableRefObject<RideEventKind | null>;
  /** D21 results of the closed blocks, kept with the buffer for a reload. */
  blocks?: () => readonly RideBlock[];
  sampleMs?: number;
  flushMs?: number;
}

export interface RideRecorderHandle {
  recorder: RideRecorder;
  /** Where the D21 results of the closed blocks come from (kept with the buffer). */
  setBlocks(read: () => readonly RideBlock[]): void;
  /** Copies the recording to session storage (nothing once finished). */
  flush(): void;
  /** The ride ended (or was left without saving): drop the reload buffer and stop keeping it. */
  finish(): void;
}

/** A resumed ride carries on with the kept buffer; a new one starts empty and drops it. */
export function createRideSession(
  workoutId: string,
  resumed: boolean,
  initialBlocks: () => readonly RideBlock[] = () => [],
): RideRecorderHandle {
  let blocks = initialBlocks;
  const kept = resumed ? loadRideBuffer(workoutId) : undefined;
  if (!resumed) clearRideBuffer();
  const recorder = createRideRecorder(kept);
  // A reload cut the ride: unless it was paused already, the time until the resume is a pause.
  const lastKind = kept?.events.at(-1)?.kind;
  if (kept && kept.samples.power.length > 0 && !(lastKind && PAUSE_KINDS.has(lastKind))) {
    // At the last kept second: what came after it until the reload is lost, not ridden.
    recorder.event('pause', kept.samples.timeMs.at(-1));
  }
  let finished = false;
  return {
    recorder,
    setBlocks(read) {
      blocks = read;
    },
    flush() {
      if (!finished) saveRideBuffer(workoutId, recorder.data(), blocks());
    },
    finish() {
      finished = true;
      clearRideBuffer();
    },
  };
}

/**
 * Records the ride (T6): one sample per second while running, plus pauses, signal loss and ERG
 * changes as events. The recording is copied to session storage every few seconds so a reload in
 * the middle of a ride keeps it.
 */
export function useRideRecorder(
  input: RideRecorderInput,
  options: RideRecorderOptions,
): RideRecorderHandle {
  const { workoutId, resumed, pauseReasonRef } = options;
  const sampleMs = options.sampleMs ?? RIDE_SAMPLE_MS;
  const flushMs = options.flushMs ?? RIDE_FLUSH_MS;
  const [handle] = useState(() => createRideSession(workoutId, resumed));
  const { blocks } = options;
  useEffect(() => {
    if (blocks) handle.setBlocks(blocks);
  });
  const { recorder } = handle;
  const latest = useRef(input);
  useEffect(() => {
    latest.current = input;
  });
  /** The live values at the moment a sample is taken. */
  const [read] = useState(() => (): RideSampleInput => {
    const { readPowerW, cadenceRpm, hrBpm, targetW, segmentIndex } = latest.current;
    return { powerW: readPowerW(), cadenceRpm, hrBpm, targetW, segmentIndex };
  });

  // The riding clock runs with the ride; samples are added as it says they are due.
  const running = input.status === 'running';
  useEffect(() => {
    if (!running) return;
    recorder.run();
    let savedAt = Date.now();
    const id = setInterval(() => {
      recorder.catchUp(read);
      if (Date.now() - savedAt >= flushMs) {
        savedAt = Date.now();
        handle.flush();
      }
    }, sampleMs);
    return () => {
      clearInterval(id);
      recorder.halt(read);
    };
  }, [running, recorder, handle, read, sampleMs, flushMs]);

  // Pause / resume (the riding clock has already stopped when this runs).
  const prevStatus = useRef<EngineStatus>(input.status);
  useEffect(() => {
    const prev = prevStatus.current;
    prevStatus.current = input.status;
    if (prev === input.status) return;
    if (prev === 'running' && input.status === 'paused') {
      recorder.event(pauseReasonRef.current ?? 'pause');
      pauseReasonRef.current = null;
      handle.flush();
    } else if (prev === 'paused' && input.status === 'running') {
      recorder.event('resume');
    }
  }, [input.status, recorder, handle, pauseReasonRef]);

  // Trainer signal lost / back, ERG off / on: only once the ride has started.
  const started = input.status !== 'idle' && input.status !== 'countdown';
  const live = input.trainerLink === 'live';
  const prevLive = useRef<boolean | null>(null);
  useEffect(() => {
    if (input.trainerLink === 'off' || !started) {
      prevLive.current = input.trainerLink === 'off' ? null : live;
      return;
    }
    const prev = prevLive.current;
    prevLive.current = live;
    if (prev === null || prev === live) return;
    recorder.catchUp(read);
    recorder.event(live ? 'signalBack' : 'signalLost');
  }, [input.trainerLink, live, started, recorder, read]);

  const prevErg = useRef<boolean | null>(null);
  useEffect(() => {
    const on = input.ergEnabled;
    const prev = prevErg.current;
    prevErg.current = on;
    if (!started || on === null || prev === null || prev === on) return;
    recorder.catchUp(read);
    recorder.event(on ? 'ergOn' : 'ergOff');
  }, [input.ergEnabled, started, recorder, read]);

  // Leaving the screen without ending (the ride can be resumed): keep what was recorded.
  useEffect(() => () => handle.flush(), [handle]);

  return handle;
}
