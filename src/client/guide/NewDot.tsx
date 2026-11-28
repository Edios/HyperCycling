import { useWhatsNewDot } from './whats-new';
import styles from './WhatsNew.module.css';

/**
 * The discreet "something new" dot next to a link to "What's new" (gone once it is opened).
 * Decorative: it does not change the link's name; the page itself says what is new.
 */
export function NewDot() {
  const show = useWhatsNewDot();
  if (!show) return null;
  return <span className={styles.dot} data-testid="whats-new-dot" aria-hidden="true" />;
}
