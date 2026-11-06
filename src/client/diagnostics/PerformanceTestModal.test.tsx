import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TestResult } from './recommendation';

const canvasMock = vi.hoisted(() => ({
  available: true,
  props: [] as { quality: string; world?: string }[],
}));
vi.mock('../world/WorldCanvas', () => ({
  webglAvailable: () => canvasMock.available,
  WorldCanvas: (props: { quality: string; world?: string }) => {
    canvasMock.props.push(props);
    return <canvas data-testid="world-canvas" width={640} height={360} />;
  },
}));

import { PerformanceTestModal, testDurationMs } from './PerformanceTestModal';

/** Advances time in frame-sized steps, each in its own act, so React renders between frames. */
function advance(ms: number): void {
  for (let t = 0; t < ms; t += 16) {
    act(() => {
      vi.advanceTimersByTime(16);
    });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  canvasMock.available = true;
  canvasMock.props = [];
});
afterEach(() => vi.useRealTimers());

describe('PerformanceTestModal', () => {
  it('runs world x quality combinations in order and reports measured results', () => {
    const onDone = vi.fn<(r: TestResult[]) => void>();
    render(<PerformanceTestModal durationMs={1000} onDone={onDone} onCancel={() => undefined} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Step 1 of 6/)).toBeInTheDocument();
    advance(6 * 1000 + 800);
    expect(onDone).toHaveBeenCalledTimes(1);
    const results = onDone.mock.calls[0]![0];
    expect(results.map((r) => `${r.world}/${r.quality}`)).toEqual([
      'neon-tunnel/high',
      'neon-tunnel/low',
      'road/high',
      'road/low',
      'scenes/high',
      'scenes/low',
    ]);
    for (const r of results) {
      expect(r.avgFps).toBeGreaterThan(30);
      expect(r.width).toBe(640);
      expect(r.height).toBe(360);
    }
    const shown = [...new Set(canvasMock.props.map((p) => `${p.world}/${p.quality}`))];
    expect(shown).toEqual([
      'neon-tunnel/high',
      'neon-tunnel/low',
      'road/high',
      'road/low',
      'scenes/high',
      'scenes/low',
    ]);
  });

  it('cancels without reporting results', () => {
    const onDone = vi.fn();
    const onCancel = vi.fn();
    render(<PerformanceTestModal durationMs={1000} onDone={onDone} onCancel={onCancel} />);
    advance(1500);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    advance(5000);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('says so and does not start when WebGL is missing', () => {
    canvasMock.available = false;
    render(
      <PerformanceTestModal
        durationMs={1000}
        onDone={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(screen.getByText(/WebGL is not available/)).toBeInTheDocument();
    expect(canvasMock.props).toHaveLength(0);
  });
});

describe('testDurationMs', () => {
  it('defaults to 10 seconds', () => {
    expect(testDurationMs(new URLSearchParams(), true)).toBe(10_000);
  });
  it('honours the override only where overrides are allowed', () => {
    const p = new URLSearchParams('diagMs=800');
    expect(testDurationMs(p, true)).toBe(800);
    expect(testDurationMs(p, false)).toBe(10_000);
  });
  it('ignores junk and absurd values', () => {
    expect(testDurationMs(new URLSearchParams('diagMs=abc'), true)).toBe(10_000);
    expect(testDurationMs(new URLSearchParams('diagMs=5'), true)).toBe(10_000);
    expect(testDurationMs(new URLSearchParams('diagMs=999999'), true)).toBe(10_000);
  });
});
