import type { ReactNode, RefObject } from 'react';
import type { TrackRef } from '../../domain/workout';
import { useT } from '../i18n';
import { Icon } from '../ui/Icon';
import styles from './MusicPlayerDock.module.css';

export interface MusicPlayerDockProps {
  /** The track that plays now; the dock is only seen while there is one. */
  track: TrackRef | null;
  /** The rider's choice (Settings, or the switch in the quick settings). */
  shown: boolean;
  /** Where YouTube's player is mounted (see `useMusicDirector`'s `playerSlot`). */
  slotRef: RefObject<HTMLDivElement | null>;
  /** Hides the player from the dock's own button. Without it the dock has no such button. */
  onHide?: () => void;
  /** Another look for a small screen (the wizard's preview uses the same dock). */
  variant?: 'ride' | 'inline';
  /** Shown in the caption next to the title (the ride's song thumbs). */
  extra?: ReactNode;
}

/**
 * The YouTube music player on screen: YouTube's terms ask for a visible player of at least
 * 200 x 200 px with the title of what plays. The player itself is mounted by the music provider
 * into the slot and is never moved (moving an iframe reloads it and stops the music); hiding
 * it only parks the dock off screen, so the music goes on. Spotify tracks have no video, so
 * the dock stays parked for them.
 */
export function MusicPlayerDock({
  track,
  shown,
  slotRef,
  onHide,
  variant = 'ride',
  extra,
}: MusicPlayerDockProps) {
  const t = useT();
  const visible = shown && track !== null && track.provider === 'youtube';
  return (
    <div
      className={`${styles.dock} ${variant === 'inline' ? styles.inline : styles.ride}`}
      data-testid="music-dock"
      data-visible={visible}
      role="region"
      aria-label={t('music.player.label')}
      aria-hidden={visible ? undefined : true}
    >
      <div ref={slotRef} className={styles.slot} data-testid="music-player-slot" />
      <div className={styles.bar}>
        <span className={styles.name} data-testid="music-player-name">
          {track?.title || t('music.unknownTrack')}
          {track?.artist ? <small>{track.artist}</small> : null}
        </span>
        {visible && extra ? <span className={styles.extra}>{extra}</span> : null}
        {onHide && (
          <button
            type="button"
            className={styles.hide}
            data-testid="music-player-hide"
            aria-label={t('music.player.hide')}
            title={t('music.player.hide')}
            tabIndex={visible ? 0 : -1}
            onClick={onHide}
          >
            <Icon name="close" size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
