import type { CSSProperties } from 'react';
import styles from './EdgeFlash.module.css';

export interface EdgeFlashProps {
  /** Increment to flash; 0 means idle. */
  trigger: number;
  color: string;
  reducedMotion?: boolean;
}

export function EdgeFlash({ trigger, color, reducedMotion = false }: EdgeFlashProps) {
  const active = trigger > 0 && !reducedMotion;
  const style: CSSProperties & Record<'--c', string> = { '--c': color };
  return (
    <div
      key={trigger}
      data-testid="edge-flash"
      data-active={active}
      aria-hidden="true"
      className={`${styles.root} ${active ? styles.go : ''}`}
      style={style}
    />
  );
}
