import type { TrackRef } from '../../domain/workout';
import { useT } from '../i18n';
import hud from './hud/hud.module.css';
import styles from './NowPlaying.module.css';
import { Icon } from '../ui/Icon';

export interface NowPlayingProps {
  track: TrackRef;
  muted: boolean;
  /** The owner's thumbs for this song (spec §9 J); the buttons show only with `onRate`. */
  feedback?: { rating?: 'up' | 'down'; love?: true } | undefined;
  onRate?: (tap: 'up' | 'down' | 'love') => void;
}

const THUMB =
  'M7 10v10H4V10h3zm2 10h8.2a2 2 0 0 0 2-1.6l1.3-6.5A2 2 0 0 0 18.5 9.5H14l.8-4A1.6 1.6 0 0 0 12 4.6L9 10v10z';
const HEART =
  'M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20z';

/** Group S: small label with the track that plays right now (title and artist when known). */
export function NowPlaying({ track, muted, feedback, onRate }: NowPlayingProps) {
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
          <Icon name={track.provider === 'spotify' ? 'music' : 'play'} size={18} />
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
      {onRate && (
        <span className={styles.rate} role="group" aria-label={t('music.rateLabel')}>
          {(
            [
              ['up', 'music.rateUp', THUMB, feedback?.rating === 'up', undefined],
              ['down', 'music.rateDown', THUMB, feedback?.rating === 'down', 'rotate(180 12 12)'],
              ['love', 'music.rateLove', HEART, feedback?.love === true, undefined],
            ] as const
          ).map(([tap, label, path, on, transform]) => (
            <button
              key={tap}
              type="button"
              className={styles.rateBtn}
              aria-label={t(label)}
              aria-pressed={on}
              data-testid={`rate-${tap}`}
              onClick={() => onRate(tap)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d={path}
                  transform={transform}
                  fill={on ? 'currentColor' : 'none'}
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          ))}
        </span>
      )}
    </div>
  );
}
