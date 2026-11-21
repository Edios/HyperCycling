import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { RideEventKind } from '../../domain/ride';
import type { EngineStatus } from '../../domain/session-engine';
import type { LinkState } from '../devices/live-metrics';
import {
  clearRideBuffer,
  createRideRecorder,
  loadRideBuffer,
  saveRideBuffer,
  type RideRecorder,
} from './ride-recorder';

export const RIDE_SAMPLE_MS = 1000;
/** How often the recording is copied to session storage while riding. */
export const RIDE_FLUSH_MS = 5000;

export interface RideRecorderInput {
  status: EngineStatus;
  /** The trainer link: 'off' when there is no trainer. */
  trainerLink: LinkState;
  powerW: number | null;
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
  sampleMs?: number;
  flushMs?: number;
}

export interface RideRecorderHandle {
  recorder: RideRecorder;
  /** Copies the recording to session storage (nothing once finished). */
  flush(): void;
  /** The ride ended (or was left without saving): drop the reload buffer and stop keeping it. */
  finish(): void;
}

/** A resumed ride carries on with the kept buffer; a new one starts empty and drops it. */
export function createRideSession(workoutId: string, resumed: boolean): RideRecorderHandle {
  const kept = resumed ? loadRideBuffer(workoutId) : undefined;
  if (!resumed) clearRideBuffer();
  const recorder = createRideRecorder(kept);
  let finished = false;
  return {
    recorder,
    flush() {
      if (!finished) saveRideBuffer(workoutId, recorder.data());
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
  const { recorder } = handle;
  const latest = useRef(input);
  useEffect(() => {
    latest.current = input;
  });

  const running = input.status === 'running';
  useEffect(() => {
    if (!running) return;
    const flushEvery = Math.max(1, Math.round(flushMs / sampleMs));
    let ticks = 0;
    const id = setInterval(() => {
      const i = latest.current;
      if (i.status !== 'running') return;
      recorder.sample(i);
      ticks += 1;
      if (ticks % flushEvery === 0) handle.flush();
    }, sampleMs);
    return () => clearInterval(id);
  }, [running, recorder, handle, sampleMs, flushMs]);

  // Pause / resume.
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
    recorder.event(live ? 'signalBack' : 'signalLost');
  }, [input.trainerLink, live, started, recorder]);

  const prevErg = useRef<boolean | null>(null);
  useEffect(() => {
    const on = input.ergEnabled;
    const prev = prevErg.current;
    prevErg.current = on;
    if (!started || on === null || prev === null || prev === on) return;
    recorder.event(on ? 'ergOn' : 'ergOff');
  }, [input.ergEnabled, started, recorder]);

  // Leaving the screen without ending (the ride can be resumed): keep what was recorded.
  useEffect(() => () => handle.flush(), [handle]);

  return handle;
}
