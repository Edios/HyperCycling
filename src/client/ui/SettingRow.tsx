import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useT } from '../i18n';
import { Icon } from './Icon';
import styles from './SettingRow.module.css';

interface Props {
  /** The control line: usually a Toggle, or a label with a select or a button (it takes the width). */
  children: ReactNode;
  /** Short explanation, shown under the row when the "?" is pressed. Without it there is no "?". */
  help?: ReactNode;
  /** Names the "?" button for a screen reader ("Help: Screen layout"). */
  topic?: string;
  /** One quiet line under the control (a state such as "Not checked yet"). */
  status?: ReactNode;
  testId?: string;
}

/**
 * One row of a settings list: the control, an optional "?" that reveals a short explanation in
 * place (no tooltip, so it works with a finger and a screen reader), and an optional state line.
 */
export function SettingRow({ children, help, topic, status, testId }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const helpId = useId();
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setOpen(false);
    }
  };
  return (
    <div className={styles.row} onKeyDown={onKey} {...(testId ? { 'data-testid': testId } : {})}>
      <div className={styles.line}>
        <div className={styles.control}>{children}</div>
        {help !== undefined && (
          <button
            type="button"
            className={`${styles.help} ${open ? styles.helpOn : ''}`}
            aria-expanded={open}
            aria-controls={helpId}
            aria-label={topic ? t('ui.helpFor', { topic }) : t('ui.help')}
            onClick={() => setOpen((v) => !v)}
          >
            <Icon name="help" size={18} />
          </button>
        )}
      </div>
      {status !== undefined && <p className={styles.status}>{status}</p>}
      {help !== undefined && open && (
        <div id={helpId} className={styles.text} role="note">
          {help}
        </div>
      )}
    </div>
  );
}
