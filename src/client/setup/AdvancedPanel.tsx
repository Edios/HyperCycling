import { useId, type ReactNode, type Ref } from 'react';
import { useT } from '../i18n';
import { Icon } from '../ui/Icon';
import styles from './AdvancedPanel.module.css';

const STORAGE_KEY = 'hypercycling.setup.advanced';

/** Whether the accordion was left open last time; closed when nothing (or nothing readable) is stored. */
export function readAdvancedOpen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveAdvancedOpen(open: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, open ? '1' : '0');
  } catch {
    // not remembered this time
  }
}

interface AdvancedPanelProps {
  open: boolean;
  onToggle: (open: boolean) => void;
  /** Left column (desktop); the same order continues into the right column on a phone. */
  left: ReactNode;
  right: ReactNode;
  /** The element the "More" shortcut scrolls to. */
  panelRef?: Ref<HTMLDivElement>;
  /** The quiet line beside the title while closed: what is inside. */
  hint: string;
}

/**
 * "Advanced settings": a collapsed accordion under "Who rides". Closed it is one quiet line; open it
 * shows named groups (see {@link Group}) in two columns on a wide screen and one list on a phone.
 */
export function AdvancedPanel({ open, onToggle, left, right, panelRef, hint }: AdvancedPanelProps) {
  const t = useT();
  const bodyId = useId();
  return (
    <div ref={panelRef} className={styles.panel} data-testid="advanced">
      <button
        type="button"
        className={styles.head}
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => onToggle(!open)}
        data-testid="advanced-toggle"
      >
        <span className={styles.title}>{t('setup.advanced')}</span>
        {!open && <span className={styles.hint}>{hint}</span>}
        <span className={`${styles.chev} ${open ? styles.chevOpen : ''}`}>
          <Icon name="chevron" size={20} />
        </span>
      </button>
      {open && (
        <div id={bodyId} className={styles.body}>
          <div className={styles.cols}>
            <div className={styles.col}>{left}</div>
            <div className={styles.col}>{right}</div>
          </div>
          <p className={styles.foot}>{t('setup.remembered')}</p>
        </div>
      )}
    </div>
  );
}

/** One named group of the accordion: a small-caps heading, then its rows. */
export function Group({
  title,
  children,
  id,
}: {
  title: string;
  children: ReactNode;
  id?: string;
}) {
  const headId = useId();
  return (
    <section className={styles.group} aria-labelledby={headId} {...(id ? { id } : {})}>
      <h3 id={headId} className={styles.groupTitle}>
        {title}
      </h3>
      <div className={styles.rows}>{children}</div>
    </section>
  );
}
