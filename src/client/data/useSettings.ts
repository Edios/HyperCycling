import { useEffect } from 'react';
import { create } from 'zustand';
import { DEFAULT_SETTINGS, type Settings } from '../../domain/settings';
import { getRepositories } from './repositories';

interface SettingsStore {
  settings: Settings;
  loaded: boolean;
}

const useSettingsStore = create<SettingsStore>(() => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
}));

let loading: Promise<void> | undefined;

function load(): Promise<void> {
  loading ??= (async () => {
    try {
      const repos = await getRepositories();
      const stored = await repos.settings.get();
      useSettingsStore.setState({
        settings: stored ? { ...DEFAULT_SETTINGS, ...stored } : DEFAULT_SETTINGS,
        loaded: true,
      });
    } catch (err) {
      console.warn('Loading settings failed, using defaults', err);
      useSettingsStore.setState({ settings: DEFAULT_SETTINGS, loaded: true });
    }
  })();
  return loading;
}

async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const next = { ...useSettingsStore.getState().settings, ...patch };
  useSettingsStore.setState({ settings: next });
  try {
    const repos = await getRepositories();
    await repos.settings.put(next);
  } catch (err) {
    console.warn('Saving settings failed', err);
  }
}

/** Settings loaded once from the repositories and cached; falls back to defaults on failure. */
export function useSettings(): {
  settings: Settings;
  loaded: boolean;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
} {
  const settings = useSettingsStore((s) => s.settings);
  const loaded = useSettingsStore((s) => s.loaded);
  useEffect(() => {
    void load();
  }, []);
  return { settings, loaded, updateSettings };
}

export function resetSettingsForTests(): void {
  loading = undefined;
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, loaded: false });
}
