import type { CSSProperties } from 'react';
import { EffortRing } from '../../brand';
import { useT } from '../../i18n';
import { formatClock } from '../format';
import { FOCUS_IN_MS, FOCUS_OUT_MS, fadeStyle } from '../hud/motion';
import hud from '../hud/hud.module.css';
import type { TrainingView } from '../view';
import styles from './FocusRest.module.css';

export interface FocusRestProps {
  view: TrainingView;
  /** True while the Focus HUD is hidden: this calm screen is what the rider sees. */
  active: boolean;
  /** Reduced motion or Effects off: the swap is instant. */
  reducedMotion: boolean;
}

function pctOf(view: TrainingView): number {
  if (view.durationSec <= 0) return 0;
  return Math.min(100, Math.max(0, (view.remainingSec / view.durationSec) * 100));
}

/**
 * Focus on the plain background, at rest (variant E-b): a dark field with a thin frame in the
 * effort colour, the ring and its number in the zone colour, and the time. No panels, no motion.
 */
export function FocusRest({ view, active, reducedMotion }: FocusRestProps) {
  const t = useT();
  const label = `${t(`effort.${view.labelKey}`)} · ${t('training.ftpApprox', { pct: Math.round(view.ftpPct) })}`;
  return (
    <div
      className={`${styles.root} ${active ? styles.on : ''}`}
      style={fadeStyle(active, FOCUS_OUT_MS, FOCUS_IN_MS, reducedMotion)}
      data-testid="focus-rest"
      data-active={active}
      aria-hidden={!active}
    >
      <div className={styles.content}>
        <div className={styles.ringBox}>
          <EffortRing
            effort={view.effort}
            size="min(calc(52 * var(--u)), 40vw)"
            outline="rgba(255, 255, 255, 0.22)"
            numColor="var(--zone)"
            numberTestId="focus-rest-effort"
          />
          <div className={styles.name}>{label}</div>
        </div>
        <div className={styles.timeBox}>
          <div className={styles.caption}>{t('training.timeLeft')}</div>
          <div className={`${hud.big} ${styles.time}`}>{formatClock(view.remainingSec)}</div>
          <div
            className={`${hud.rail} ${styles.rail}`}
            style={{ '--on': 'var(--zone)', '--track': 'rgba(255,255,255,.14)' } as CSSProperties}
          >
            <i style={{ transform: `scaleX(${pctOf(view) / 100})` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Focus over a background, at rest: a small glass badge (ring and time) where the HUD was, so the
 * picture stays clean but the rider can still see the effort.
 */
export function FocusBadge({ view, active, reducedMotion }: FocusRestProps) {
  return (
    <div
      className={`${styles.badge} ${hud.panel} ${hud.zoned} ${active ? styles.badgeOn : ''}`}
      style={fadeStyle(active, FOCUS_OUT_MS, FOCUS_IN_MS, reducedMotion)}
      data-testid="focus-badge"
      data-active={active}
      aria-hidden={!active}
    >
      <EffortRing
        effort={view.effort}
        size="calc(14 * var(--u))"
        outline="#8a93a3"
        numColor="var(--zt)"
        numberTestId="focus-badge-effort"
      />
      <div className={styles.badgeTime}>
        <div className={`${hud.big} ${styles.badgeClock}`}>{formatClock(view.remainingSec)}</div>
        <div className={`${hud.rail} ${styles.badgeRail}`}>
          <i style={{ transform: `scaleX(${pctOf(view) / 100})` }} />
        </div>
      </div>
    </div>
  );
}
