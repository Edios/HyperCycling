import type { Position } from '../../../domain/workout';
import { useT } from '../../i18n';
import styles from './PositionBadge.module.css';

export interface PositionBadgeProps {
  /** A missing position (older data) reads as seated. */
  position: Position | undefined;
  className?: string;
}

/** Rider seated on the saddle, torso leaning to the bars. */
function SeatedIcon() {
  return (
    <svg viewBox="0 0 32 32" className={styles.icon} aria-hidden="true" focusable="false">
      <path d="M4 25h13" />
      <path d="M9 25v-5l4-6 6 1" />
      <path d="M19 15l7 2" />
      <circle cx="12" cy="9" r="2.4" />
      <path d="M13 14l4-3" />
    </svg>
  );
}

/** Rider out of the saddle, hips up over the pedals. */
function StandingIcon() {
  return (
    <svg viewBox="0 0 32 32" className={styles.icon} aria-hidden="true" focusable="false">
      <path d="M4 27h13" />
      <path d="M11 27l2-9 5-5" />
      <path d="M18 13l8 3" />
      <circle cx="12" cy="7" r="2.4" />
      <path d="M13 11l5 2" />
      <path d="M13 18l5 4" />
    </svg>
  );
}

/**
 * Seated / standing as an icon and a word (never colour alone). Standing is the loud one:
 * filled, because the rider has to act; seated is the quiet default.
 */
export function PositionBadge({ position, className }: PositionBadgeProps) {
  const t = useT();
  const resolved: Position = position === 'standing' ? 'standing' : 'seated';
  const word = t(resolved === 'standing' ? 'training.standing' : 'training.seated');
  return (
    <div
      className={`${styles.badge} ${className ?? ''}`}
      data-testid="position-badge"
      data-position={resolved}
      role="img"
      aria-label={`${t('training.position')}: ${word}`}
    >
      {resolved === 'standing' ? <StandingIcon /> : <SeatedIcon />}
      <span className={styles.word} aria-hidden="true">
        {word}
      </span>
    </div>
  );
}
