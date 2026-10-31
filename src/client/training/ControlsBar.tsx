import type { EngineStatus } from '../../domain/session-engine';
import { useT } from '../i18n';
import styles from './ControlsBar.module.css';

export interface ControlsBarProps {
  status: EngineStatus;
  muted: boolean;
  /** Fades the bar out (auto-hide). */
  hidden: boolean;
  hasPlayers: boolean;
  onPrev(): void;
  onToggle(): void;
  onNext(): void;
  onMute(): void;
  onFullscreen(): void;
  onPlayers(): void;
  /** Opens the exit dialog (end / leave / cancel). */
  onMenu(): void;
  quickOpen: boolean;
  onQuick(): void;
}

export function ControlsBar(p: ControlsBarProps) {
  const t = useT();
  const running = p.status === 'running' || p.status === 'countdown';
  // Buttons give up focus after a click so Space keeps meaning "pause" instead of re-clicking.
  const click = (fn: () => void) => (e: { currentTarget: HTMLButtonElement }) => {
    e.currentTarget.blur();
    fn();
  };
  const toggleLabel = running
    ? t('training.pause')
    : p.status === 'idle'
      ? t('training.start')
      : t('training.resume');
  return (
    <div
      data-testid="controls"
      data-hidden={p.hidden}
      className={`${styles.bar} ${p.hidden ? styles.hidden : ''}`}
      role="group"
      aria-label={t('training.controls')}
      inert={p.hidden}
    >
      <button type="button" aria-label={t('training.previous')} onClick={click(p.onPrev)}>
        <span aria-hidden="true">⏮</span>
      </button>
      <button
        type="button"
        aria-label={toggleLabel}
        className={styles.main}
        onClick={click(p.onToggle)}
      >
        <span aria-hidden="true">{running ? '⏸' : '▶'}</span>
      </button>
      <button type="button" aria-label={t('training.nextBlock')} onClick={click(p.onNext)}>
        <span aria-hidden="true">⏭</span>
      </button>
      <button
        type="button"
        aria-label={t('training.mute')}
        aria-pressed={p.muted}
        onClick={click(p.onMute)}
      >
        <span aria-hidden="true">{p.muted ? '🔇' : '🔊'}</span>
      </button>
      {p.hasPlayers && (
        <button type="button" aria-label={t('training.players')} onClick={click(p.onPlayers)}>
          <span aria-hidden="true">👥</span>
        </button>
      )}
      <button type="button" aria-label={t('training.fullscreen')} onClick={click(p.onFullscreen)}>
        <span aria-hidden="true">⛶</span>
      </button>
      <button
        type="button"
        aria-label={t('training.quickSettings')}
        aria-pressed={p.quickOpen}
        onClick={click(p.onQuick)}
      >
        <span aria-hidden="true">⚙</span>
      </button>
      <button type="button" aria-label={t('training.menu')} onClick={click(p.onMenu)}>
        <span aria-hidden="true">☰</span>
      </button>
    </div>
  );
}
