import { useId, type ReactNode } from 'react';
import styles from './Field.module.css';

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  /** Render prop receives the id to put on the control. */
  children: (id: string) => ReactNode;
}

export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && !error && <small className={styles.hint}>{hint}</small>}
      {error && (
        <small role="alert" className={styles.error}>
          {error}
        </small>
      )}
    </div>
  );
}
