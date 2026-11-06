import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiagnosticsOverlay } from './DiagnosticsOverlay';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('DiagnosticsOverlay', () => {
  it('is hidden from assistive tech and shows scene and quality', () => {
    render(<DiagnosticsOverlay scene="World / road" quality="low" />);
    const el = screen.getByTestId('diagnostics-overlay');
    expect(el).toHaveAttribute('aria-hidden', 'true');
    expect(el).toHaveTextContent('World / road');
    expect(el).toHaveTextContent('low');
  });

  it('shows live fps and the canvas size once a second has passed', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    canvas.dataset.testid = 'world-canvas';
    document.body.appendChild(canvas);
    render(<DiagnosticsOverlay scene="World / road" quality="high" />);
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    const text = screen.getByTestId('diagnostics-overlay').textContent ?? '';
    expect(text).toMatch(/FPS\s*\d+/);
    expect(text).toContain('1280x720');
    canvas.remove();
  });
});
