import { musicPlayerShown } from '../../domain/settings';
import { useSettings } from '../data/useSettings';
import { useMediaQuery } from '../training/useMediaQuery';

/**
 * A mobile device: a touch screen as the main pointer, or a small window (a phone in either
 * orientation, a narrow tablet window). Simple on purpose: it only decides a default.
 */
export const MOBILE_QUERY = '(pointer: coarse), (max-width: 760px), (max-height: 500px)';

/** Whether the music player is shown on this device (see `musicPlayerShown`). */
export function useMusicPlayerShown(): boolean {
  const { settings } = useSettings();
  const mobile = useMediaQuery(MOBILE_QUERY);
  return musicPlayerShown(settings, mobile);
}
