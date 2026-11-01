import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_EFFORT_TABLE } from '../../domain/effort';
import { HyperrideCanvas } from './HyperrideCanvas';
import type { FrameInput, HyperrideWorld } from './world';

const log = vi.hoisted(() => ({ events: [] as string[] }));

vi.mock('./worlds', () => ({
  DEFAULT_WORLD: 'neon-tunnel',
  WORLDS: {
    'neon-tunnel': async (): Promise<HyperrideWorld> => ({
      init: (_canvas, quality) => void log.events.push(`init:${quality}`),
      update: () => undefined,
      resize: () => undefined,
      setViewOffsetX: () => undefined,
      speed: 0,
      distance: 0,
      dispose: () => undefined,
    }),
  },
}));

const input = {
  segments: [],
  table: DEFAULT_EFFORT_TABLE,
  state: { workoutElapsedSec: 0, segmentIndex: 0, status: 'running' },
} as unknown as FrameInput;

let pending: ((t: number) => void) | undefined;
/** Runs animation frames of `dtMs` from `from`, until `until`. */
function frames(dtMs: number, from: number, until: number): void {
  for (let t = from; t <= until; t += dtMs) {
    const cb = pending;
    pending = undefined;
    act(() => cb?.(t));
  }
}

beforeEach(() => {
  log.events.length = 0;
  pending = undefined;
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
    pending = cb;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(performance, 'now').mockReturnValue(0);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    getExtension: () => null,
  } as unknown as RenderingContext);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('HyperrideCanvas automatic quality', () => {
  it('starts on high and drops to low once after two 5 s windows under 45 fps (past the warm-up)', async () => {
    const lowered = vi.fn();
    render(<HyperrideCanvas getFrameInput={() => input} quality="auto" onAutoLowered={lowered} />);
    await waitFor(() => expect(log.events).toEqual(['init:high']));
    frames(40, 0, 12_500); // 25 fps
    await waitFor(() => expect(log.events).toEqual(['init:high', 'init:low']));
    expect(lowered).toHaveBeenCalledTimes(1);
    frames(40, 13_000, 40_000);
    expect(lowered).toHaveBeenCalledTimes(1);
    expect(log.events).toEqual(['init:high', 'init:low']);
  });

  it('stays on high at 60 fps', async () => {
    const lowered = vi.fn();
    render(<HyperrideCanvas getFrameInput={() => input} quality="auto" onAutoLowered={lowered} />);
    await waitFor(() => expect(log.events).toEqual(['init:high']));
    frames(1000 / 60, 0, 20_000);
    expect(lowered).not.toHaveBeenCalled();
    expect(log.events).toEqual(['init:high']);
  });

  it('never switches a fixed quality', async () => {
    const lowered = vi.fn();
    render(<HyperrideCanvas getFrameInput={() => input} quality="high" onAutoLowered={lowered} />);
    await waitFor(() => expect(log.events).toEqual(['init:high']));
    frames(40, 0, 20_000);
    expect(lowered).not.toHaveBeenCalled();
  });
});
