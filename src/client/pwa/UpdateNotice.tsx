import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useT } from '../i18n';
import styles from './pwa.module.css';
import { applyUpdate, usePwaStore } from './pwa-store';

/**
 * A quiet line when a new version is ready: "Refresh" lets it take over (the page reloads), the
 * cross hides it until the next visit. Never during a ride, never a popup.
 */
export function UpdateNotice() {
  const t = useT();
  const waiting = usePwaStore((s) => s.waiting);
  const { pathname } = useLocation();
  const [dismissed, setDismissed] = useState(false);
  if (!waiting || dismissed || pathname === '/train') return null;
  return (
    <div className={styles.update} role="status" data-testid="update-notice">
      <span>{t('pwa.updateReady')}</span>
      <button type="button" className={styles.updateAction} onClick={applyUpdate}>
        {t('pwa.updateApply')}
      </button>
      <button
        type="button"
        className={styles.updateClose}
        aria-label={t('pwa.updateLater')}
        onClick={() => setDismissed(true)}
      >
        ×
      </button>
    </div>
  );
}
