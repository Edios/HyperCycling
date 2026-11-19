import { useT } from '../i18n';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import styles from './StartBar.module.css';

interface Shortcut {
  label: string;
  /** Accessible name when the visible text is not enough. */
  ariaLabel?: string;
  /** A toggle shortcut reports its state; an opener leaves this out. */
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  testId: string;
}

interface Props {
  /** `shortcuts`: chips above Start (Plan, Freestyle). `status`: one status line and Start (Experience). */
  variant: 'shortcuts' | 'status';
  music: Shortcut;
  layout?: Shortcut;
  more?: Shortcut;
  /** The one line above Start in the `status` variant. */
  status?: string;
  /** Why Start is off, with the way out; shown above Start. */
  notice?: { text: string; action: string; onAction: () => void };
  disabled: boolean;
  onStart: () => void;
}

function Chip({ s, icon }: { s: Shortcut; icon: 'music' | 'layout' | 'settings' }) {
  return (
    <button
      type="button"
      className={`${styles.chip} ${s.pressed ? styles.chipOn : ''}`}
      {...(s.pressed !== undefined ? { 'aria-pressed': s.pressed } : {})}
      {...(s.ariaLabel ? { 'aria-label': s.ariaLabel } : {})}
      disabled={s.disabled === true}
      onClick={s.onClick}
      data-testid={s.testId}
    >
      <Icon name={icon} size={18} />
      <span>{s.label}</span>
    </button>
  );
}

/**
 * The sticky bottom bar of the ride setup: optional shortcuts (music on/off, screen layout, more
 * settings) over a big Start in the mode's colour. It keeps clear of the phone's home indicator.
 */
export function StartBar({
  variant,
  music,
  layout,
  more,
  status,
  notice,
  disabled,
  onStart,
}: Props) {
  const t = useT();
  return (
    <div className={styles.wrap} data-testid="start-bar">
      <div className={styles.bar} role="group" aria-label={t('setup.startBar')}>
        {notice && (
          <p className={styles.notice} role="status" data-testid="start-notice">
            <span>{notice.text}</span>
            <button type="button" className={styles.noticeAction} onClick={notice.onAction}>
              {notice.action}
            </button>
          </p>
        )}
        {variant === 'shortcuts' ? (
          <div className={styles.chips}>
            <Chip s={music} icon="music" />
            {layout && <Chip s={layout} icon="layout" />}
            {more && <Chip s={more} icon="settings" />}
          </div>
        ) : (
          status && (
            <p className={styles.status} data-testid="start-status">
              <Icon name="music" size={16} />
              <span>{status}</span>
            </p>
          )
        )}
        <Button
          variant="primary"
          size="big"
          className={styles.start}
          onClick={onStart}
          disabled={disabled}
          data-testid="start"
        >
          <Icon name="play" size={22} />
          {t('setup.start')}
        </Button>
      </div>
    </div>
  );
}
