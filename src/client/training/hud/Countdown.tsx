import type { CSSProperties } from 'react';
import styles from './Countdown.module.css';

export interface CountdownProps {
  n: 3 | 2 | 1 | null;
  color: string;
  reducedMotion?: boolean;
}

export function Countdown({ n, color, reducedMotion = false }: CountdownProps) {
  if (n === null) return null;
  const style: CSSProperties & Record<'--c', string> = { '--c': color };
  return (
    <div
      key={n}
      data-testid="countdown"
      aria-hidden="true"
      className={`${styles.root} ${reducedMotion ? '' : styles.tick}`}
      style={style}
    >
      {n}
    </div>
  );
}
