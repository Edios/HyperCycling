import type { ButtonHTMLAttributes } from 'react';
import styles from './Chip.module.css';

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  on?: boolean;
}

/** Filter chip: a toggle button; `on` marks the selected one. */
export function Chip({ on = false, className, type = 'button', ...rest }: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={on}
      className={`${styles.chip} ${on ? styles.on : ''} ${className ?? ''}`}
      {...rest}
    />
  );
}
