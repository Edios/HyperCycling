import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../i18n';
import { createBleLog } from './ble-log';
import { buildBleLogExport } from './ble-log-export';
import { BleLogExport } from './BleLogExport';

const AT = new Date('2026-11-21T10:20:30.000Z');

function logWithEvents() {
  const log = createBleLog({ now: () => AT.getTime() });
  log.add('trainer', 'tx', '05 00');
  return log;
}

describe('buildBleLogExport', () => {
  it('adds a header and the log text', () => {
    const { text, fileName } = buildBleLogExport(logWithEvents(), '1.2.3', AT);
    expect(text).toContain('HyperCycling Bluetooth log (1.2.3)');
    expect(text).toContain('events 1');
    expect(text).toContain('2026-11-21T10:20:30.000Z trainer tx 05 00');
    expect(fileName).toBe('hypercycling-bluetooth-log-2026-11-21-10-20-30.txt');
  });

  it('says so when nothing was logged', () => {
    expect(buildBleLogExport(createBleLog(), 'dev', AT).text).toContain('(no events yet)');
  });
});

describe('BleLogExport', () => {
  beforeEach(() => setLang('en'));
  afterEach(() => vi.restoreAllMocks());

  it('warns about privacy in both languages', () => {
    render(<BleLogExport log={createBleLog()} />);
    expect(screen.getByTestId('ble-log')).toHaveTextContent(/nothing leaves this device/);
    setLang('pl');
    render(<BleLogExport log={createBleLog()} />);
    expect(screen.getAllByTestId('ble-log')[1]).toHaveTextContent(/nic nie opuszcza/);
  });

  it('copies the log to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<BleLogExport log={logWithEvents()} />);
    fireEvent.click(screen.getByTestId('ble-log-copy'));
    await waitFor(() => expect(screen.getByText('Log copied')).toBeInTheDocument());
    expect(writeText.mock.calls[0]![0]).toContain('trainer tx 05 00');
  });

  it('suggests the download when the clipboard is not available', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<BleLogExport log={logWithEvents()} />);
    fireEvent.click(screen.getByTestId('ble-log-copy'));
    await waitFor(() => expect(screen.getByText(/Could not copy/)).toBeInTheDocument());
  });

  it('downloads a .txt file', async () => {
    const download = vi.fn();
    render(<BleLogExport log={logWithEvents()} download={download} />);
    fireEvent.click(screen.getByTestId('ble-log-save'));
    await waitFor(() => expect(screen.getByText('Log saved')).toBeInTheDocument());
    const [blob, name] = download.mock.calls[0] as [Blob, string];
    expect(name).toMatch(/^hypercycling-bluetooth-log-.*\.txt$/);
    expect(blob.type).toContain('text/plain');
  });
});
