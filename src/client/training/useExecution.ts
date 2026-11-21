import { useEffect, useRef, useState } from 'react';
import {
  createExecutionTracker,
  type BlockResult,
  type ExecutionTracker,
} from '../../domain/execution';

/** One sample per second, whether or not the shown power changed (review #115 B1). */
export const EXECUTION_SAMPLE_MS = 1000;
/** How long the "block met / not met" message stays. */
export const BLOCK_RESULT_MS = 5000;

export interface ExecutionInput {
  /** Trainer mode and the ride is running. */
  active: boolean;
  segmentIndex: number;
  powerW: number | null;
  targetW: number | null;
}

/**
 * Execution score of the ride (D21). Samples the latest power and target on a fixed interval:
 * a steady ERG power exactly on target produces no new readings to react to, yet every second of
 * it counts as on target.
 */
export function useExecution(
  input: ExecutionInput,
  { now = () => Date.now(), sampleMs = EXECUTION_SAMPLE_MS } = {},
): {
  tracker: ExecutionTracker;
  blockScore: number | null;
  blockResult: BlockResult | null;
  dismissBlockResult(): void;
} {
  const [tracker] = useState(createExecutionTracker);
  const latest = useRef(input);
  const clock = useRef(now);
  useEffect(() => {
    latest.current = input;
    clock.current = now;
  });
  const [blockScore, setBlockScore] = useState<number | null>(null);
  const [blockResult, setBlockResult] = useState<BlockResult | null>(null);

  useEffect(() => {
    if (!input.active) return;
    const sample = () => {
      const { segmentIndex, powerW, targetW, active } = latest.current;
      if (!active || segmentIndex < 0) return;
      const before = tracker.results().length;
      tracker.add(segmentIndex, powerW, targetW, clock.current());
      const results = tracker.results();
      if (results.length > before) setBlockResult(results[results.length - 1] ?? null);
      setBlockScore(tracker.current());
    };
    const id = setInterval(sample, sampleMs);
    return () => clearInterval(id);
  }, [input.active, sampleMs, tracker]);

  useEffect(() => {
    if (!blockResult) return;
    const id = setTimeout(() => setBlockResult(null), BLOCK_RESULT_MS);
    return () => clearTimeout(id);
  }, [blockResult]);

  return { tracker, blockScore, blockResult, dismissBlockResult: () => setBlockResult(null) };
}
