import { useEffect } from 'react';
import { create } from 'zustand';
import { DEFAULT_SETTINGS, parseHyperrideWorld, type Settings } from '../../domain/settings';
import { getRepositories } from './repositories';

interface SettingsStore {
  settings: Settings;
  loaded: boolean;
  /** True when reading the stored settings failed and the defaults stand in for them. */
  loadFailed: boolean;
}

const useSettingsStore = create<SettingsStore>(() => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  loadFailed: false,
}));

function mergeSettings(stored: Partial<Settings>): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    equipment: { ...DEFAULT_SETTINGS.equipment, ...stored.equipment },
    // A world id this build does not know (e.g. written by a newer version) shows the default.
    hyperrideWorld: parseHyperrideWorld(stored.hyperrideWorld),
  };
}

let loading: Promise<void> | undefined;

export function loadSettings(): Promise<void> {
  loading ??= (async () => {
    try {
      const repos = await getRepositories();
      const stored = await repos.settings.get();
      useSettingsStore.setState({
        settings: stored ? mergeSettings(stored) : DEFAULT_SETTINGS,
        loaded: true,
        loadFailed: false,
      });
    } catch (err) {
      console.warn('Loading settings failed, using defaults', err);
      useSettingsStore.setState({ settings: DEFAULT_SETTINGS, loaded: true, loadFailed: true });
    }
  })();
  return loading;
}

/** Applies the patch immediately and persists it; on failure rolls back and rejects. */
export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const previous = useSettingsStore.getState().settings;
  const next = { ...previous, ...patch };
  useSettingsStore.setState({ settings: next });
  try {
    const repos = await getRepositories();
    await repos.settings.put(next);
  } catch (err) {
    // Only undo our own write: a newer update may already have replaced it.
    if (useSettingsStore.getState().settings === next) {
      useSettingsStore.setState({ settings: previous });
    }
    throw err;
  }
}

/** True when the stored settings could not be read; writing then would replace them with defaults. */
export function didSettingsLoadFail(): boolean {
  return useSettingsStore.getState().loadFailed;
}

/** Current settings outside React (for non-component code such as music providers). */
export function getSettingsSnapshot(): Settings {
  return useSettingsStore.getState().settings;
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
    void loadSettings();
  }, []);
  return { settings, loaded, updateSettings };
}

export function resetSettingsForTests(): void {
  loading = undefined;
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, loaded: false, loadFailed: false });
}
