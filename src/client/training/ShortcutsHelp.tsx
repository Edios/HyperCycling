import { useEffect, useRef } from 'react';
import { useT } from '../i18n';
import shortcutStyles from '../settings/Shortcuts.module.css';
import { useRestoreFocus } from '../ui/useRestoreFocus';
import styles from './EndDialog.module.css';
import own from './ShortcutsHelp.module.css';
import { TRAINING_SHORTCUTS } from './keyboard';

/**
 * "?" during the ride: the shortcuts, from the handler's own list (like the Settings card). It
 * closes with Escape, "?" again or the button; the ride goes on meanwhile.
 */
export function ShortcutsHelp({ onClose }: { onClose(): void }) {
  const t = useT();
  const closeRef = useRef<HTMLButtonElement>(null);
  useRestoreFocus();
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape' || e.key === '?') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'Tab') {
      e.preventDefault(); // the one button keeps the focus
    } else if (e.code === 'Space' || e.key === 'Enter') {
      e.stopPropagation(); // activates the button, not the ride's pause
    }
  };

  return (
    <div className={styles.backdrop}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-help-title"
        className={`${styles.dialog} ${own.help}`}
        onKeyDown={onKeyDown}
        data-testid="shortcuts-help"
      >
        <h2 id="shortcuts-help-title">{t('shortcuts.title')}</h2>
        <ul className={shortcutStyles.list}>
          {TRAINING_SHORTCUTS.map((s) => (
            <li key={s.action} className={shortcutStyles.row}>
              <kbd className={shortcutStyles.key}>{s.keys}</kbd>
              <span>{t(s.labelKey)}</span>
            </li>
          ))}
        </ul>
        <p>{t('shortcuts.remotes')}</p>
        <div className={styles.actions}>
          <button ref={closeRef} type="button" onClick={onClose}>
            {t('shortcuts.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
