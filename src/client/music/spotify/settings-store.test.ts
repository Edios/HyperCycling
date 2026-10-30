import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../../../domain/settings';

const db: { value?: Settings; failRead: boolean } = { failRead: false };
const put = vi.fn((s: Settings) => {
  db.value = s;
  return Promise.resolve();
});
vi.mock('../../data/repositories', () => ({
  getRepositories: () =>
    db.failRead && !put.mock.calls.length
      ? Promise.reject(new Error('offline'))
      : Promise.resolve({ settings: { get: () => Promise.resolve(db.value), put } }),
}));

import { loadSettings, resetSettingsForTests } from '../../data/useSettings';
import { settingsSpotifyStore } from './settings-store';

beforeEach(() => {
  db.value = undefined;
  db.failRead = false;
  put.mockClear();
  resetSettingsForTests();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('settingsSpotifyStore', () => {
  it('reads and writes settings.spotify through the shared settings store', async () => {
    db.value = { ...DEFAULT_SETTINGS, basicTheme: 'light', spotify: { clientId: 'cid' } };
    await loadSettings();
    expect(settingsSpotifyStore.read()).toEqual({ clientId: 'cid' });
    await settingsSpotifyStore.write({ clientId: 'cid', accessToken: 'AT' });
    expect(put).toHaveBeenCalledTimes(1);
    expect(db.value?.spotify).toEqual({ clientId: 'cid', accessToken: 'AT' });
    expect(db.value?.basicTheme).toBe('light'); // other settings are preserved
  });

  it('refuses to write after a failed settings load (it would replace real settings with defaults)', async () => {
    db.failRead = true;
    await loadSettings();
    await expect(settingsSpotifyStore.write({ clientId: 'cid' })).rejects.toThrow();
    expect(put).not.toHaveBeenCalled();
  });
});
