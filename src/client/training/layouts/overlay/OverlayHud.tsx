import type { CSSProperties } from 'react';
import { targetWatts } from '../../../../domain/effort';
import { useT } from '../../../i18n';
import { translateContentText } from '../../content-text';
import { formatClock } from '../../format';
import { Timeline } from '../../hud/Timeline';
import type { BasicLayoutProps } from '../types';
import styles from './overlay.module.css';

export type OverlayKind = 'immersive' | 'column' | 'cockpit' | 'tunnel';

export interface OverlayLayoutProps extends BasicLayoutProps {
  /** Show the players column (Immersive and Column only). */
  withPlayers?: boolean;
}

interface OverlayHudProps extends OverlayLayoutProps {
  kind: OverlayKind;
}

function safeWatts(ftp: number, ftpPct: number): string {
  if (!Number.isFinite(ftp) || ftp <= 0 || !Number.isFinite(ftpPct)) return '—';
  return String(targetWatts(ftp, ftpPct));
}

/** Shared markup of the four Hyperride overlay layouts; the CSS places the pieces per layout. */
export function OverlayHud({
  kind,
  view,
  segments,
  players,
  showsWatts,
  rpmIsTarget,
  hideRpmTile,
  reducedMotion,
  controls,
  coach,
  withPlayers = false,
}: OverlayHudProps) {
  const t = useT();
  const showPlayers =
    withPlayers && players.length > 0 && (kind === 'immersive' || kind === 'column');
  const next = view.next;
  const nextStyle = { '--nextzone': view.nextColor } as CSSProperties;
  const rpmValue = view.segment.rpm === undefined ? '—' : String(Math.round(view.segment.rpm));
  const rpmParts = [t('training.rpm')];
  if (view.segment.position) {
    rpmParts.push(
      t(view.segment.position === 'standing' ? 'training.standing' : 'training.seated'),
    );
  }
  if (rpmIsTarget) rpmParts.push(t('training.target'));
  const pct =
    view.durationSec > 0
      ? Math.min(100, Math.max(0, (view.remainingSec / view.durationSec) * 100))
      : 0;

  return (
    <div
      className={styles.root}
      data-testid={`layout-${kind}`}
      data-layout={kind}
      data-players={showPlayers}
    >
      <div className={styles.edge} data-testid="overlay-edge" aria-hidden="true" />
      {showPlayers && (
        <div className={styles.players} data-testid="players-list">
          <div className={styles.pHead}>
            {showsWatts
              ? t('training.playersTarget', { pct: Math.round(view.ftpPct) })
              : t('training.playersTargetEffort', { effort: Math.round(view.effort) })}
          </div>
          {players.map((p) => (
            <div key={p.id} className={styles.pRow}>
              <span className={styles.pName}>{p.name}</span>
              {showsWatts && (
                <span className={styles.pWatts}>
                  {safeWatts(p.ftp, view.ftpPct)}
                  <small>{t('training.watts')}</small>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      <div className={styles.panel}>
        <div
          className={`${styles.m} ${styles.eff}`}
          data-testid="effort-value"
          data-variant="overlay"
        >
          <div className={styles.l}>{t('training.effort')}</div>
          <div className={styles.v} data-testid="effort-value-number">
            {Math.round(view.effort)}
          </div>
          <div className={styles.s}>
            {t(`effort.${view.labelKey}`)} ·{' '}
            {t('training.ftpApprox', { pct: Math.round(view.ftpPct) })}
          </div>
        </div>
        {!hideRpmTile && (
          <div className={`${styles.m} ${styles.rpm}`} data-testid="rpm-value">
            <div className={styles.l}>{t('training.cadence')}</div>
            <div className={styles.v} data-testid="rpm-value-number">
              {rpmValue}
            </div>
            <div className={styles.s}>{rpmParts.join(' · ')}</div>
          </div>
        )}
        <div
          className={`${styles.m} ${styles.time} ${view.pulse && !reducedMotion ? styles.pulse : ''}`}
          data-testid="block-timer"
        >
          <div className={styles.l}>{t('training.timeLeft')}</div>
          <div className={styles.v} data-testid="block-timer-value">
            {formatClock(view.remainingSec)}
          </div>
          <div
            className={styles.tbar}
            role="progressbar"
            aria-label={t('training.timeLeft')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct)}
          >
            <i style={{ width: `${pct}%` }} />
          </div>
          <div className={styles.s}>
            {t('training.blockOf', { n: view.index + 1, total: view.total })}
          </div>
        </div>
        <div className={styles.next} data-testid="next-block" style={nextStyle}>
          <span>{t('training.next')}</span>
          {next ? (
            <b>
              {next.effortStart}
              {next.rpm !== undefined && ` · ${next.rpm} ${t('training.rpm')}`}
              {` · ${formatClock(next.durationSec)}`}
              {next.label && <em>{translateContentText(next.label, 'label')}</em>}
            </b>
          ) : (
            <b>{t('training.finish')}</b>
          )}
        </div>
      </div>
      <div className={styles.free}>{coach}</div>
      <div className={styles.controls}>{controls}</div>
      <div className={styles.bottom}>
        <Timeline segments={segments} elapsedSec={view.elapsedSec} compact tone="mono" />
      </div>
    </div>
  );
}
