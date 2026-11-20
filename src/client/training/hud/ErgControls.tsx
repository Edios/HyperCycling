import type { ErgStatus } from '../../devices/erg-driver';
import { useT, type MessageKey } from '../../i18n';
import { Icon } from '../../ui/Icon';
import styles from './ErgControls.module.css';

/** What the trainer-mode HUD needs about ERG. */
export interface TrainerHud {
  /** Live 3 s power, null without a signal. */
  watts: number | null;
  /** The block's target (with the bias), null when ERG does not set one. */
  targetW: number | null;
  /** Ring levels 0..10 (owner decision D13). */
  level: number;
  targetLevel: number;
  status: ErgStatus;
  enabled: boolean;
  biasPct: number;
  onToggle(): void;
  onNudge(steps: number): void;
  onRetry(): void;
}

const CHIP: Record<ErgStatus, MessageKey> = {
  idle: 'training.erg.idle',
  unsupported: 'training.erg.unsupported',
  manual: 'training.erg.manual',
  starting: 'training.erg.starting',
  erg: 'training.erg.on',
  resistance: 'training.erg.resistance',
  paused: 'training.erg.paused',
  blocked: 'training.erg.blocked',
};

/**
 * The quiet trainer-mode marker (owner decision D13, variant A): one chip that says the mode and
 * switches ERG on and off, plus ±5 %. The only coloured outline is the chip while ERG holds.
 */
export function ErgControls({ hud }: { hud: TrainerHud }) {
  const t = useT();
  const { status, enabled, biasPct } = hud;
  const active = status === 'erg' || status === 'resistance' || status === 'starting';
  const canToggle = status !== 'unsupported' && status !== 'blocked';
  const showBias = enabled && status !== 'unsupported' && status !== 'blocked';
  return (
    <div className={styles.row} data-testid="erg-controls" data-status={status}>
      <button
        type="button"
        className={`${styles.chip} ${active ? styles.on : ''}`}
        aria-pressed={enabled}
        disabled={!canToggle}
        title={t(enabled ? 'training.erg.turnOff' : 'training.erg.turnOn')}
        onClick={hud.onToggle}
        data-testid="erg-toggle"
      >
        <Icon name="bolt" size="1em" />
        <span>{t(CHIP[status])}</span>
      </button>
      {status === 'blocked' && (
        <button
          type="button"
          className={styles.small}
          onClick={hud.onRetry}
          data-testid="erg-retry"
        >
          {t('training.erg.retry')}
        </button>
      )}
      {showBias && (
        <>
          <button
            type="button"
            className={styles.small}
            aria-label={t('training.erg.easier')}
            onClick={() => hud.onNudge(-1)}
            data-testid="erg-easier"
          >
            {t('training.erg.minus')}
          </button>
          {biasPct !== 0 && (
            <span className={styles.bias} data-testid="erg-bias">
              {t('training.erg.bias', { pct: biasPct > 0 ? `+${biasPct}` : String(biasPct) })}
            </span>
          )}
          <button
            type="button"
            className={styles.small}
            aria-label={t('training.erg.harder')}
            onClick={() => hud.onNudge(1)}
            data-testid="erg-harder"
          >
            {t('training.erg.plus')}
          </button>
        </>
      )}
    </div>
  );
}
