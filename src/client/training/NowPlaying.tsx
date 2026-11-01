import type { TrackRef } from '../../domain/workout';
import { useT } from '../i18n';
import hud from './hud/hud.module.css';
import styles from './NowPlaying.module.css';

export interface NowPlayingProps {
  track: TrackRef;
  muted: boolean;
}

/** Group S: small label with the track that plays right now (title and artist when known). */
export function NowPlaying({ track, muted }: NowPlayingProps) {
  const t = useT();
  const provider = track.provider === 'spotify' ? 'Spotify' : 'YouTube';
  const title = track.title || t('music.unknownTrack');
  return (
    <div
      className={`${hud.panel} ${styles.root}`}
      data-g="S"
      data-testid="now-playing"
      data-provider={track.provider}
      data-muted={muted}
      role="status"
      aria-label={t('music.nowPlaying')}
    >
      {muted ? (
        <svg className={styles.mute} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 9v6h4l5 4V5L7 9H3z" fill="currentColor" />
          <path
            d="M16 9l5 6M21 9l-5 6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      ) : (
        <span className={styles.icon} aria-hidden="true">
          {track.provider === 'spotify' ? '●' : '▶'}
        </span>
      )}
      <span className={styles.text}>
        <span className={styles.title}>{title}</span>
        <span className={styles.meta}>
          {track.artist ? `${track.artist} · ` : ''}
          {provider}
          {muted ? ` · ${t('music.nowPlayingMuted')}` : ''}
        </span>
      </span>
    </div>
  );
}
