import { useEffect, useRef, useState } from 'react';
import { frameStats, type FrameStats } from './frame-stats';

const PAUSE_MS = 1000;

export interface FrameMeter {
  /** Feed every frame timestamp (ms). */
  push(nowMs: number): void;
  stats(): FrameStats;
}

/** Rolling frame-time window. Gaps over 1 s (hidden tab) are not counted as frames. */
export function createFrameMeter(windowMs = 1000): FrameMeter {
  const times: number[] = [];
  const durations: number[] = [];
  let last: number | undefined;
  return {
    push(now) {
      if (last !== undefined && now - last <= PAUSE_MS) {
        times.push(now);
        durations.push(now - last);
      }
      last = now;
      while (times.length > 0 && now - (times[0] ?? now) >= windowMs) {
        times.shift();
        durations.shift();
      }
    },
    stats: () => frameStats(durations),
  };
}

export interface UseFrameMeterOptions {
  enabled?: boolean;
  windowMs?: number;
  /** How often the returned stats refresh. */
  publishMs?: number;
  /** Called for every frame with its duration, e.g. to collect all samples of a test. */
  onFrame?: (dtMs: number, nowMs: number) => void;
}

const EMPTY = frameStats([]);

/** The one FPS meter: samples requestAnimationFrame and publishes rolling stats about once a second. */
export function useFrameMeter(options: UseFrameMeterOptions = {}): FrameStats {
  const { enabled = true, windowMs = 1000, publishMs = 1000 } = options;
  const [stats, setStats] = useState<FrameStats>(EMPTY);
  const onFrame = useRef(options.onFrame);
  useEffect(() => {
    onFrame.current = options.onFrame;
  });

  useEffect(() => {
    if (!enabled) return undefined;
    const meter = createFrameMeter(windowMs);
    let raf = 0;
    let last: number | undefined;
    let published = performance.now();
    const loop = (now: number): void => {
      raf = requestAnimationFrame(loop);
      if (last !== undefined) onFrame.current?.(now - last, now);
      last = now;
      meter.push(now);
      if (now - published >= publishMs) {
        published = now;
        setStats(meter.stats());
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [enabled, windowMs, publishMs]);

  return stats;
}
