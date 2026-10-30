import type { HTMLAttributes } from 'react';
import styles from './Card.module.css';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Slightly brighter gradient used for the hero card. */
  hero?: boolean;
}

export function Card({ hero = false, className, ...rest }: CardProps) {
  return (
    <div className={`${styles.card} ${hero ? styles.hero : ''} ${className ?? ''}`} {...rest} />
  );
}
