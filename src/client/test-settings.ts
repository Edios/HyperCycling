import { DEFAULT_SETTINGS, type Settings } from '../domain/settings';

/**
 * Settings of a rider whose bike measures power. The app's default bike is a plain knob without
 * watts (DEFAULT_SETTINGS); tests of plans, FTP and watts need the metered one.
 */
export const METERED_SETTINGS: Settings = {
  ...DEFAULT_SETTINGS,
  equipment: { ...DEFAULT_SETTINGS.equipment, showsWatts: true },
};
