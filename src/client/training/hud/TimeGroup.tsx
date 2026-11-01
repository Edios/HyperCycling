import type { CSSProperties } from 'react';
import { useT } from '../../i18n';
import { formatClock } from '../format';
import { fitStyle } from './fit';
import hud from './hud.module.css';
import styles from './TimeGroup.module.css';

export interface TimeGroupProps {
  remainingSec: number;
  durationSec: number;
  /** Pulse the clock (last seconds before a change). */
  pulse: boolean;
  reducedMotion?: boolean;
  /** Hide the caption (Minimal: the number alone). */
  hideLabel?: boolean;
  /** Size the clock to the width of its panel (Classic tiles); needs a panel with a set width. */
  fit?: boolean;
  /** A section of a column instead of a panel of its own. */
  section?: boolean;
  className?: string;
}

/** Group C: block time left, big, with the dash rail. */
export function TimeGroup({
  remainingSec,
  durationSec,
  pulse,
  reducedMotion = false,
  hideLabel = false,
  fit = false,
  section = false,
  className,
}: TimeGroupProps) {
  const t = useT();
  const pct = durationSec > 0 ? Math.min(100, Math.max(0, (remainingSec / durationSec) * 100)) : 0;
  const pulsing = pulse && !reducedMotion;
  const clock = formatClock(remainingSec);
  const valueStyle: CSSProperties | undefined = fit ? fitStyle(clock.length) : undefined;
  const classes = [
    section ? hud.sec : hud.panel,
    styles.time,
    fit ? styles.fit : '',
    pulsing ? styles.pulse : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={classes} data-g="C" data-testid="block-timer" data-pulse={pulsing}>
      {!hideLabel && <div className={hud.lbl}>{t('training.timeLeft')}</div>}
      <div
        data-testid="block-timer-value"
        className={`${hud.big} ${styles.clock}`}
        style={valueStyle}
      >
        {clock}
      </div>
      <div
        role="progressbar"
        aria-label={t('training.timeLeft')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        className={`${hud.rail} ${styles.rail}`}
      >
        <i style={{ transform: `scaleX(${pct / 100})` }} />
      </div>
    </div>
  );
}
