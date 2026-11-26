import { useT } from '../i18n';
import styles from './RateButtons.module.css';

export type RateTap = 'up' | 'down' | 'love';

export interface RateButtonsProps {
  /** Placement from the parent (a row of its own, or inline). */
  className?: string | undefined;
  feedback?: { rating?: 'up' | 'down'; love?: true } | undefined;
  onRate: (tap: RateTap) => void;
}

const THUMB =
  'M7 10v10H4V10h3zm2 10h8.2a2 2 0 0 0 2-1.6l1.3-6.5A2 2 0 0 0 18.5 9.5H14l.8-4A1.6 1.6 0 0 0 12 4.6L9 10v10z';
const HEART =
  'M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20z';

/**
 * The owner's thumbs and heart for the song that plays (energy matching spec §9 J), next to its
 * title: in the now-playing label, or in the music player's caption when the player is shown.
 */
export function RateButtons({ className, feedback, onRate }: RateButtonsProps) {
  const t = useT();
  const buttons = [
    { tap: 'up', label: t('music.rateUp'), path: THUMB, on: feedback?.rating === 'up' },
    {
      tap: 'down',
      label: t('music.rateDown'),
      path: THUMB,
      on: feedback?.rating === 'down',
      flip: true,
    },
    { tap: 'love', label: t('music.rateLove'), path: HEART, on: feedback?.love === true },
  ] as const;
  return (
    <span
      className={className ? `${styles.rate} ${className}` : styles.rate}
      role="group"
      aria-label={t('music.rateLabel')}
    >
      {buttons.map((b) => (
        <button
          key={b.tap}
          type="button"
          className={styles.btn}
          aria-label={b.label}
          title={b.label}
          aria-pressed={b.on}
          data-testid={`rate-${b.tap}`}
          onClick={() => onRate(b.tap)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d={b.path}
              transform={'flip' in b ? 'rotate(180 12 12)' : undefined}
              fill={b.on ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      ))}
    </span>
  );
}
