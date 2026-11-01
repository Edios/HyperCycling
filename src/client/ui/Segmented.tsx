import { useId } from 'react';
import styles from './Segmented.module.css';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
  title?: string;
}

export interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
}

/** Single-choice control rendered as radios so keyboard and screen readers behave natively. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedProps<T>) {
  const group = useId();
  return (
    <div role="radiogroup" aria-label={label} className={styles.seg}>
      {options.map((o) => (
        <label
          key={o.value}
          title={o.title}
          className={`${styles.opt} ${o.value === value ? styles.on : ''} ${o.disabled ? styles.off : ''}`}
        >
          <input
            type="radio"
            className={styles.input}
            name={group}
            checked={o.value === value}
            disabled={o.disabled}
            onChange={() => onChange(o.value)}
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}
