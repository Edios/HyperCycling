import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSettingsSnapshot, loadSettings, updateSettings } from '../data/useSettings';
import { resetErrorLogForTests } from './error-log';
import { GlobalDiagnostics } from './GlobalDiagnostics';

vi.mock('../data/repositories', () => ({
  getRepositories: () =>
    Promise.resolve({
      settings: { get: () => Promise.resolve(undefined), put: () => Promise.resolve() },
    }),
}));

afterEach(() => {
  resetErrorLogForTests();
  window.history.replaceState(null, '', '/');
});

const settle = async (): Promise<void> => {
  await act(async () => {
    await loadSettings();
  });
};

describe('GlobalDiagnostics', () => {
  it('renders nothing while the mode is off', async () => {
    await updateSettings({ diagnostics: false });
    render(<GlobalDiagnostics />);
    await settle();
    expect(screen.queryByTestId('diagnostics')).toBeNull();
  });

  it('Ctrl+Shift+D switches the overlay on and off anywhere', async () => {
    await updateSettings({ diagnostics: false });
    render(<GlobalDiagnostics />);
    await settle();
    await act(async () => {
      fireEvent.keyDown(window, { code: 'KeyD', key: 'D', ctrlKey: true, shiftKey: true });
      await Promise.resolve();
    });
    expect(getSettingsSnapshot().diagnostics).toBe(true);
    expect(await screen.findByTestId('diagnostics')).toBeInTheDocument();
    await act(async () => {
      fireEvent.keyDown(window, { code: 'KeyD', key: 'D', ctrlKey: true, shiftKey: true });
      await Promise.resolve();
    });
    expect(screen.queryByTestId('diagnostics')).toBeNull();
  });

  it('?diag in the address turns the mode on', async () => {
    await updateSettings({ diagnostics: false });
    window.history.replaceState(null, '', '/?diag');
    render(<GlobalDiagnostics />);
    await settle();
    expect(await screen.findByTestId('diagnostics')).toBeInTheDocument();
    expect(getSettingsSnapshot().diagnostics).toBe(true);
  });
});
