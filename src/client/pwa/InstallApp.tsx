import { useT } from '../i18n';
import { Button } from '../ui/Button';
import styles from './pwa.module.css';
import { isIos, isStandalone, promptInstall, usePwaStore } from './pwa-store';

/**
 * "Install the app": the browser's own dialog where it offers one (Chrome, Edge, Android), the
 * "Add to Home Screen" steps on an iPhone or iPad, nothing elsewhere or once installed.
 */
export function InstallApp() {
  const t = useT();
  const prompt = usePwaStore((s) => s.installPrompt);
  const installed = usePwaStore((s) => s.installed);
  if (installed || isStandalone()) return null;
  if (prompt) {
    return (
      <div className={styles.install} data-testid="install-app">
        <Button onClick={() => void promptInstall()} data-testid="install-button">
          {t('pwa.install')}
        </Button>
        <p className={styles.note}>{t('pwa.installHint')}</p>
      </div>
    );
  }
  if (isIos()) {
    return (
      <div className={styles.install} data-testid="install-app">
        <p className={styles.note} data-testid="install-ios">
          {t('pwa.installIos')}
        </p>
      </div>
    );
  }
  return null;
}
