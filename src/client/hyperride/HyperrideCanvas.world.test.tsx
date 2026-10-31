import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_EFFORT_TABLE } from '../../domain/effort';
import { HyperrideCanvas } from './HyperrideCanvas';
import type { FrameInput, HyperrideWorld } from './world';
import type { WorldId } from './worlds';

/** 'road' is registered by the Road world module; the registry is mocked here. */
const ROAD = 'road' as unknown as WorldId;

const log = vi.hoisted(() => ({ events: [] as string[] }));

vi.mock('./worlds', () => {
  const fakeWorld = (name: string): HyperrideWorld => ({
    init: () => void log.events.push(`init:${name}`),
    update: () => undefined,
    resize: () => undefined,
    setViewOffsetX: () => undefined,
    speed: 0,
    distance: 0,
    dispose: () => void log.events.push(`dispose:${name}`),
  });
  return {
    DEFAULT_WORLD: 'neon-tunnel',
    WORLDS: {
      'neon-tunnel': async () => fakeWorld('neon-tunnel'),
      road: async () => fakeWorld('road'),
    },
  };
});

const input = {
  segments: [],
  table: DEFAULT_EFFORT_TABLE,
  state: { workoutElapsedSec: 0, segmentIndex: 0, status: 'running' },
} as unknown as FrameInput;

beforeEach(() => {
  log.events.length = 0;
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    { getExtension: () => null } as unknown as RenderingContext,
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('HyperrideCanvas world switch', () => {
  it('disposes the first world before initialising the second', async () => {
    const view = render(
      <HyperrideCanvas getFrameInput={() => input} quality="high" world="neon-tunnel" />,
    );
    await waitFor(() => expect(log.events).toContain('init:neon-tunnel'));
    view.rerender(
      <HyperrideCanvas getFrameInput={() => input} quality="high" world={ROAD} />,
    );
    await waitFor(() => expect(log.events).toContain('init:road'));
    expect(log.events).toEqual(['init:neon-tunnel', 'dispose:neon-tunnel', 'init:road']);
    view.unmount();
    expect(log.events.at(-1)).toBe('dispose:road');
  });
});
