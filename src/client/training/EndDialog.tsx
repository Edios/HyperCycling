import { useEffect, useRef } from 'react';
import { useRestoreFocus } from '../ui/useRestoreFocus';
import { useT } from '../i18n';
import styles from './EndDialog.module.css';

export interface EndDialogProps {
  /** Cancel: back to the workout. */
  onResume(): void;
  /** End the ride and open the summary. */
  onEnd(): void;
  /** Drop the ride and go back to the main menu without a summary. */
  onLeave(): void;
}

/** Custom modal (not window.confirm): Escape cancels, Tab stays inside the dialog. */
export function EndDialog({ onResume, onEnd, onLeave }: EndDialogProps) {
  const t = useT();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const endRef = useRef<HTMLButtonElement>(null);
  const leaveRef = useRef<HTMLButtonElement>(null);

  useRestoreFocus(); // back to where the rider was (the Menu button, or nowhere)
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onResume();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const order = [endRef.current, leaveRef.current, cancelRef.current];
      const i = order.indexOf(document.activeElement as HTMLButtonElement | null);
      const step = e.shiftKey ? order.length - 1 : 1;
      order[(Math.max(i, 0) + step) % order.length]?.focus();
    } else if (e.code === 'Space') {
      e.stopPropagation(); // keep Space as "activate button" inside the dialog
    }
  };

  return (
    <div className={styles.backdrop}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="end-title"
        aria-describedby="end-body"
        className={styles.dialog}
        onKeyDown={onKeyDown}
      >
        <h2 id="end-title">{t('training.endTitle')}</h2>
        <p id="end-body">{t('training.endBody')}</p>
        <div className={styles.actions}>
          <button ref={endRef} type="button" className={styles.primary} onClick={onEnd}>
            {t('training.endConfirm')}
          </button>
          <button ref={leaveRef} type="button" className={styles.danger} onClick={onLeave}>
            {t('training.endLeave')}
          </button>
          <button ref={cancelRef} type="button" onClick={onResume}>
            {t('training.endResume')}
          </button>
        </div>
      </div>
    </div>
  );
}
