import styles from './brand.module.css';

/** Brand name parts: fixed, not translated. */
export const NAME_LIGHT = 'Hyper';
export const NAME_BOLD = 'Cycling';

/** HYPER (light) + CYCLING (bold). Inherits the font size; the text reads "HyperCycling". */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`${styles.wordmark}${className ? ` ${className}` : ''}`}>
      <span className={styles.hyper}>{NAME_LIGHT}</span>
      <span className={styles.cycling}>{NAME_BOLD}</span>
    </span>
  );
}
