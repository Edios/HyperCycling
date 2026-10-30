import { formatClock } from '../format';
import { useT } from '../../i18n';
import { fitStyle } from './fit';
import tile from './Tile.module.css';
import styles from './BlockTimer.module.css';

export interface BlockTimerProps {
  remainingSec: number;
  durationSec: number;
  /** Zero-based block index. */
  index: number;
  total: number;
  /** Pulse the clock (last seconds before a change). */
  pulse: boolean;
  size?: 'xl' | 'lg' | 'md';
  reducedMotion?: boolean;
}

export function BlockTimer({
  remainingSec,
  durationSec,
  index,
  total,
  pulse,
  size = 'xl',
  reducedMotion = false,
}: BlockTimerProps) {
  const t = useT();
  const pct = durationSec > 0 ? Math.min(100, Math.max(0, (remainingSec / durationSec) * 100)) : 0;
  const pulsing = pulse && !reducedMotion;
  const clock = formatClock(remainingSec);
  return (
    <div
      data-testid="block-timer"
      data-pulse={pulsing}
      className={`${tile.tile} ${tile[size]} ${pulsing ? styles.pulse : ''}`}
    >
      <div className={tile.label}>{t('training.timeLeft')}</div>
      <div
        data-testid="block-timer-value"
        className={`${tile.value} ${styles.clock}`}
        style={fitStyle(clock.length)}
      >
        {clock}
      </div>
      <div
        role="progressbar"
        aria-label={t('training.timeLeft')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        className={styles.bar}
      >
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className={tile.sub}>{t('training.blockOf', { n: index + 1, total })}</div>
    </div>
  );
}
