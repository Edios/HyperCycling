import { useEffect, useRef } from 'react';
import { useT } from '../i18n';
import styles from './EndDialog.module.css';

export interface EndDialogProps {
  onResume(): void;
  onEnd(): void;
}

/** Custom modal (not window.confirm): Escape resumes, Tab stays inside the dialog. */
export function EndDialog({ onResume, onEnd }: EndDialogProps) {
  const t = useT();
  const resumeRef = useRef<HTMLButtonElement>(null);
  const endRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    resumeRef.current?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onResume();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const active = document.activeElement;
      (active === resumeRef.current ? endRef.current : resumeRef.current)?.focus();
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
          <button ref={resumeRef} type="button" className={styles.primary} onClick={onResume}>
            {t('training.endResume')}
          </button>
          <button ref={endRef} type="button" onClick={onEnd}>
            {t('training.endConfirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
