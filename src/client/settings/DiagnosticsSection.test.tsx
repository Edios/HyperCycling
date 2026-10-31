import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../../domain/settings';

const db = vi.hoisted(() => ({ settings: undefined as Settings | undefined }));
vi.mock('../data/repositories', () => ({
  getRepositories: () =>
    Promise.resolve({
      settings: {
        get: () => Promise.resolve(db.settings),
        put: (s: Settings) => {
          db.settings = s;
          return Promise.resolve();
        },
      },
    }),
}));

vi.mock('../diagnostics/PerformanceTestModal', () => ({
  testDurationMs: () => 1,
  PerformanceTestModal: (props: { onDone(r: unknown[]): void; onCancel(): void }) => (
    <div role="dialog" aria-label="mock test">
      <button
        type="button"
        onClick={() =>
          props.onDone([
            {
              world: 'neon-tunnel',
              quality: 'high',
              avgFps: 31.4,
              p5Fps: 20,
              slowPct: 12.5,
              width: 1280,
              height: 720,
            },
            {
              world: 'neon-tunnel',
              quality: 'low',
              avgFps: 58.2,
              p5Fps: 50,
              slowPct: 0,
              width: 640,
              height: 360,
            },
          ])
        }
      >
        finish
      </button>
      <button type="button" onClick={props.onCancel}>
        abort
      </button>
    </div>
  ),
}));

import { resetSettingsForTests } from '../data/useSettings';
import { useTestResults } from '../diagnostics/results-store';
import { setLang } from '../i18n';
import { DiagnosticsSection } from './DiagnosticsSection';
import { SaveProvider } from './save';

function renderSection(download = vi.fn()) {
  render(
    <MemoryRouter>
      <SaveProvider>
        <DiagnosticsSection download={download} />
      </SaveProvider>
    </MemoryRouter>,
  );
  return download;
}

beforeEach(() => {
  db.settings = undefined;
  resetSettingsForTests();
  useTestResults.getState().setResults([]);
  setLang('en');
});
afterEach(() => {
  setLang('en');
  vi.unstubAllGlobals();
});

async function enable(): Promise<void> {
  fireEvent.click(await screen.findByRole('switch', { name: 'Diagnostics mode' }));
  await waitFor(() => expect(db.settings?.diagnostics).toBe(true));
}

describe('DiagnosticsSection', () => {
  it('has the toggle off by default and hides the tools until it is on', async () => {
    renderSection();
    const toggle = await screen.findByRole('switch', { name: 'Diagnostics mode' });
    expect(toggle).not.toBeChecked();
    expect(screen.queryByTestId('device-card')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Run test' })).toBeNull();
  });

  it('turning it on saves the setting and shows the device card', async () => {
    renderSection();
    await enable();
    const card = await screen.findByTestId('device-card');
    expect(within(card).getByText('WebGL 2')).toBeInTheDocument();
    expect(within(card).getByText('CPU threads')).toBeInTheDocument();
    expect(within(card).getByText('Reduced motion')).toBeInTheDocument();
  });

  it('shows results and a recommendation after a test, and keeps nothing on cancel', async () => {
    renderSection();
    await enable();
    fireEvent.click(await screen.findByRole('button', { name: 'Run test' }));
    fireEvent.click(screen.getByRole('button', { name: 'abort' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('No test results yet.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Run test' }));
    fireEvent.click(screen.getByRole('button', { name: 'finish' }));
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getByText('31.4')).toBeInTheDocument();
    expect(within(table).getByText('1280x720')).toBeInTheDocument();
    expect(screen.getByText('Recommended quality: low.')).toBeInTheDocument();
  });

  it('copies the report to the clipboard and confirms with a toast', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    renderSection();
    await enable();
    fireEvent.click(await screen.findByRole('button', { name: 'Copy report' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(String(writeText.mock.calls[0]?.[0])).toContain('Spinning Tutor diagnostics report');
    expect(await screen.findByText('Report copied')).toBeInTheDocument();
  });

  it('points to Save report when copying fails', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    renderSection();
    await enable();
    fireEvent.click(await screen.findByRole('button', { name: 'Copy report' }));
    expect(await screen.findByText('Could not copy. Use Save report instead.')).toBeInTheDocument();
  });

  it('saves the report as a .txt download', async () => {
    const download = renderSection();
    await enable();
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Save report' }));
    });
    expect(download).toHaveBeenCalledTimes(1);
    const [blob, name] = download.mock.calls[0] as [Blob, string];
    expect(name).toMatch(/^spinning-tutor-diagnostics-.*\.txt$/);
    expect(blob.type).toContain('text/plain');
    expect(await screen.findByText('Report saved')).toBeInTheDocument();
  });

  it('reports in Polish when the language is Polish', async () => {
    setLang('pl');
    renderSection();
    expect(await screen.findByRole('switch', { name: 'Tryb diagnostyczny' })).toBeInTheDocument();
  });
});
