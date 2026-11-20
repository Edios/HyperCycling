import { useId, useState, type ReactNode } from 'react';
import styles from './Disclosure.module.css';

export interface DisclosureProps {
  title: string;
  /** Short note next to the title while it is closed ("Progres, tags: 2"). */
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
  testId?: string;
  /** Marks the header as a coach-marks target. */
  tourId?: string;
}

/**
 * A section whose body is tucked away until asked for. The body stays mounted (just hidden), so
 * half-typed values and fields keep their state while it is closed.
 */
export function Disclosure({
  title,
  summary,
  defaultOpen = false,
  children,
  testId,
  tourId,
}: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <section className={styles.root} data-testid={testId}>
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        aria-controls={bodyId}
        data-tour={tourId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={styles.chev} aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <span className={styles.title}>{title}</span>
        {!open && summary ? <span className={styles.summary}>{summary}</span> : null}
      </button>
      <div id={bodyId} className={styles.body} hidden={!open}>
        {children}
      </div>
    </section>
  );
}
