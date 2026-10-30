import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../../domain/settings';

const db: { value?: Settings; fail: boolean } = { fail: false };
const put = vi.fn((s: Settings) => {
  db.value = s;
  return Promise.resolve();
});
vi.mock('./repositories', () => ({
  getRepositories: () =>
    db.fail
      ? Promise.reject(new Error('offline'))
      : Promise.resolve({ settings: { get: () => Promise.resolve(db.value), put } }),
}));

import { resetSettingsForTests, useSettings } from './useSettings';

beforeEach(() => {
  db.value = undefined;
  db.fail = false;
  put.mockClear();
  resetSettingsForTests();
});

describe('useSettings', () => {
  it('starts with defaults and keeps them when nothing is stored', async () => {
    const { result } = renderHook(() => useSettings());
    expect(result.current.loaded).toBe(false);
    expect(result.current.settings).toEqual(DEFAULT_SETTINGS);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('loads stored settings once and caches them', async () => {
    db.value = { ...DEFAULT_SETTINGS, basicTheme: 'light' };
    const first = renderHook(() => useSettings());
    await waitFor(() => expect(first.result.current.settings.basicTheme).toBe('light'));
    db.value = { ...DEFAULT_SETTINGS, basicTheme: 'dark' };
    const second = renderHook(() => useSettings());
    expect(second.result.current.settings.basicTheme).toBe('light');
  });

  it('fills missing equipment fields from defaults', async () => {
    db.value = { ...DEFAULT_SETTINGS, equipment: { showsWatts: false } } as unknown as Settings;
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.settings.equipment).toEqual({ ...DEFAULT_SETTINGS.equipment, showsWatts: false });
  });

  it('falls back to defaults when the repository fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    db.fail = true;
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('updateSettings merges the patch and persists it', async () => {
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(() => result.current.updateSettings({ coach: false }));
    expect(result.current.settings.coach).toBe(false);
    expect(put).toHaveBeenCalledWith(expect.objectContaining({ coach: false }));
  });

  it('updateSettings rejects and rolls back when saving fails', async () => {
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    put.mockRejectedValueOnce(new Error('disk full'));
    await act(async () => {
      await expect(result.current.updateSettings({ coach: false })).rejects.toThrow('disk full');
    });
    expect(result.current.settings.coach).toBe(DEFAULT_SETTINGS.coach);
  });
});
