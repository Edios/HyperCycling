import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSettingsSnapshot, updateSettings } from '../data/useSettings';
import { DiagnosticsOverlay } from './DiagnosticsOverlay';
import { installErrorLog, resetErrorLogForTests } from './error-log';
import { publishDiagScene } from './scene';

vi.mock('../data/repositories', () => ({
  getRepositories: () =>
    Promise.resolve({
      settings: { get: () => Promise.resolve(undefined), put: () => Promise.resolve() },
    }),
}));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  publishDiagScene(null);
  resetErrorLogForTests();
});

describe('DiagnosticsOverlay', () => {
  it('hides the readout from assistive tech and shows the published scene and quality', () => {
    publishDiagScene({ scene: 'World / road', quality: 'low' });
    render(<DiagnosticsOverlay />);
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
    render(<DiagnosticsOverlay />);
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    const text = screen.getByTestId('diagnostics-overlay').textContent ?? '';
    expect(text).toMatch(/FPS\s*\d+/);
    expect(text).toContain('1280x720');
    canvas.remove();
  });

  it('shows viewport, Bluetooth state and the last error', () => {
    const original = console.error;
    console.error = () => {};
    const stop = installErrorLog();
    render(<DiagnosticsOverlay />);
    act(() => {
      console.error('oops here');
      vi.advanceTimersByTime(1200);
    });
    stop();
    console.error = original;
    expect(screen.getByTestId('diagnostics-viewport').textContent).toMatch(/^\d+x\d+@/);
    expect(screen.getByTestId('diagnostics-bt')).toHaveTextContent('trainer none');
    expect(screen.getByTestId('diagnostics-errors')).toHaveTextContent('oops here');
  });

  it('saves one report file from the menu and can turn the mode off', async () => {
    vi.useRealTimers();
    await updateSettings({ diagnostics: true });
    const download = vi.fn().mockResolvedValue(undefined);
    render(<DiagnosticsOverlay download={download} />);
    fireEvent.click(screen.getByTestId('diagnostics-menu'));
    fireEvent.click(screen.getByTestId('diagnostics-save'));
    await vi.waitFor(() => expect(download).toHaveBeenCalled());
    const [blob, name] = download.mock.calls[0] as [Blob, string];
    expect(name).toMatch(/^hypercycling-diagnostics-.*\.txt$/);
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob);
    });
    expect(text).toContain('== Bluetooth ==');
    expect(text).toContain('== Errors and warnings ==');
    fireEvent.click(screen.getByTestId('diagnostics-off'));
    await vi.waitFor(() => expect(getSettingsSnapshot().diagnostics).toBe(false));
  });
});
