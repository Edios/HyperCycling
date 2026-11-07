import { useMePlayer } from './useMePlayer';
import { useSettings } from '../data/useSettings';

/** Pure rule: the stored toggle wins; otherwise on when the "me" player has an HRmax. */
export function resolveShowHrZones(
  stored: boolean | undefined,
  meHrMax: number | undefined,
): boolean {
  return stored ?? meHrMax !== undefined;
}

/** Whether heart-rate zones are shown (Settings → Zones; default depends on the "me" HRmax). */
export function useShowHrZones(): boolean {
  const { settings } = useSettings();
  const { me } = useMePlayer();
  return resolveShowHrZones(settings.showHrZones, me?.hrMax);
}
