import styles from './Toggle.module.css';

export interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  title?: string;
}

/** Switch with a visible label on the left. */
export function Toggle({ label, checked, onChange, disabled = false, title }: ToggleProps) {
  return (
    <label className={`${styles.row} ${disabled ? styles.off : ''}`} title={title}>
      <span>{label}</span>
      <input
        type="checkbox"
        role="switch"
        className={styles.input}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className={`${styles.tog} ${checked ? styles.on : ''}`} aria-hidden="true" />
    </label>
  );
}
