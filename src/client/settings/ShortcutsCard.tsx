import { useT } from '../i18n';
import { TRAINING_SHORTCUTS } from '../training/keyboard';
import styles from './Shortcuts.module.css';
import settingsStyles from './Settings.module.css';

/** Every key the training screen reacts to, rendered from the handler's own list. */
export function ShortcutsCard() {
  const t = useT();
  return (
    <section className={styles.card} aria-labelledby="shortcuts-title" data-testid="shortcuts-card">
      <h3 id="shortcuts-title" className={settingsStyles.subTitle}>
        {t('shortcuts.title')}
      </h3>
      <p className={settingsStyles.note}>{t('shortcuts.hint')}</p>
      <ul className={styles.list}>
        {TRAINING_SHORTCUTS.map((s) => (
          <li key={s.code} className={styles.row}>
            <kbd className={styles.key}>{s.keys}</kbd>
            <span>{t(s.labelKey)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
