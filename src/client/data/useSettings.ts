import { useEffect } from 'react';
import { create } from 'zustand';
import {
  DEFAULT_SETTINGS,
  parseWorldSetting,
  type Settings,
} from '../../domain/settings';
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

/** Fields older versions stored; dropped on load, so the next save removes them for good. */
function withoutRemovedFields(stored: Partial<Settings>): Partial<Settings> {
  const copy: Partial<Settings> & { knobSteps?: unknown } = { ...stored };
  delete copy.knobSteps;
  return copy;
}

function mergeSettings(stored: Partial<Settings>): Settings {
  const merged: Settings = {
    ...DEFAULT_SETTINGS,
    ...withoutRemovedFields(stored),
    equipment: { ...DEFAULT_SETTINGS.equipment, ...stored.equipment },
    // A world id this build does not know (e.g. written by a newer version) shows the default.
    hyperrideWorld: parseWorldSetting(stored.hyperrideWorld),
  };
  // Stored before stepped effort existed: leave the mode unset (it reads as smooth, and the
  // one-time KnobPrompt asks) instead of inheriting the fresh-profile default.
  if (stored.resistanceMode === undefined) delete merged.resistanceMode;
  return merged;
}

/** e2e builds only: the localStorage switch that starts a fresh profile on a metered bike. */
export const E2E_METERED_BIKE_KEY = 'hypercycling.e2e.meteredBike';

/**
 * Settings of a profile that has stored nothing yet: the plain knob bike without watts. The e2e
 * builds can start on a bike with a power meter instead (most ride tests need watts and FTP).
 */
function freshSettings(): Settings {
  if (import.meta.env.VITE_E2E === '1') {
    try {
      if (localStorage.getItem(E2E_METERED_BIKE_KEY) === '1') {
        return {
          ...DEFAULT_SETTINGS,
          equipment: { ...DEFAULT_SETTINGS.equipment, showsWatts: true },
        };
      }
    } catch {
      // storage blocked: the plain default
    }
  }
  return DEFAULT_SETTINGS;
}

let loading: Promise<void> | undefined;

export function loadSettings(): Promise<void> {
  loading ??= (async () => {
    try {
      const repos = await getRepositories();
      const stored = await repos.settings.get();
      useSettingsStore.setState({
        settings: stored ? mergeSettings(stored) : freshSettings(),
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
