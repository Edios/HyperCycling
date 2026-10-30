import type { CSSProperties } from 'react';
import type { EffortLabelKey } from '../../../domain/effort';
import { useT } from '../../i18n';
import { fitStyle } from './fit';
import tile from './Tile.module.css';
import styles from './EffortValue.module.css';

export interface EffortValueProps {
  effort: number;
  ftpPct: number;
  labelKey: EffortLabelKey;
  variant: 'tile' | 'overlay';
  showFtp?: boolean;
  /** Zone color; defaults to the inherited --zone. */
  color?: string;
  size?: 'xl' | 'lg' | 'md';
  /** Changing key replays the flip animation (e.g. the segment index). */
  animationKey?: number | string;
  reducedMotion?: boolean;
}

export function EffortValue({
  effort,
  ftpPct,
  labelKey,
  variant,
  showFtp = true,
  color,
  size = 'xl',
  animationKey,
  reducedMotion = false,
}: EffortValueProps) {
  const t = useT();
  const style: CSSProperties & Record<'--c', string> = { '--c': color ?? 'var(--zone)' };
  const label = t(`effort.${labelKey}`);
  const text = showFtp
    ? `${label} · ${t('training.ftpApprox', { pct: Math.round(ftpPct) })}`
    : label;
  const digits = String(Math.round(effort));
  // The tile adds a small "/10" after the digits, worth about one more character of width.
  const fit = variant === 'tile' ? fitStyle(digits.length + 1) : undefined;
  const flip = reducedMotion ? '' : styles.flip;
  return (
    <div
      data-testid="effort-value"
      data-variant={variant}
      className={`${variant === 'tile' ? tile.tile : styles.overlay} ${tile[size]} ${styles.root}`}
      style={style}
    >
      {variant === 'tile' && <div className={tile.label}>{t('training.effort')}</div>}
      <div
        key={animationKey}
        data-testid="effort-value-number"
        className={`${tile.value} ${styles.number} ${flip}`}
        style={fit}
      >
        <span>{digits}</span>
        {variant === 'tile' && <span className={styles.scale}>{t('training.effortScale')}</span>}
      </div>
      <div className={tile.sub}>{text}</div>
    </div>
  );
}
