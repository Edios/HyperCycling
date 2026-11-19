import type { EngineStatus } from '../../domain/session-engine';
import { useT } from '../i18n';
import styles from './ControlsBar.module.css';
import { Icon } from '../ui/Icon';

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
  // Buttons keep focus (dialogs give it back to them); Space is a global pause, see keyboard.ts.
  const click = (fn: () => void) => () => fn();
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
        <Icon name="prev" size={22} />
      </button>
      <button
        type="button"
        aria-label={toggleLabel}
        className={styles.main}
        onClick={click(p.onToggle)}
      >
        <Icon name={running ? 'pause' : 'play'} size={26} />
      </button>
      <button type="button" aria-label={t('training.nextBlock')} onClick={click(p.onNext)}>
        <Icon name="next" size={22} />
      </button>
      <button
        type="button"
        aria-label={t('training.mute')}
        aria-pressed={p.muted}
        onClick={click(p.onMute)}
      >
        <Icon name={p.muted ? 'mute' : 'volume'} size={22} />
      </button>
      {p.hasPlayers && (
        <button type="button" aria-label={t('training.players')} onClick={click(p.onPlayers)}>
          <Icon name="players" size={22} />
        </button>
      )}
      <button type="button" aria-label={t('training.fullscreen')} onClick={click(p.onFullscreen)}>
        <Icon name="fullscreen" size={22} />
      </button>
      <button
        type="button"
        aria-label={t('training.quickSettings')}
        aria-pressed={p.quickOpen}
        onClick={click(p.onQuick)}
      >
        <Icon name="settings" size={22} />
      </button>
      <button type="button" aria-label={t('training.menu')} onClick={click(p.onMenu)}>
        <Icon name="menu" size={22} />
      </button>
    </div>
  );
}
