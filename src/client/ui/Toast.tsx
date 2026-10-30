import { useEffect, useRef } from 'react';
import styles from './Toast.module.css';

export interface ToastProps {
  message: string;
  onClose: () => void;
  /** Auto-dismiss delay; 0 keeps it until the owner removes it. */
  durationMs?: number;
}

export function Toast({ message, onClose, durationMs = 4000 }: ToastProps) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    if (durationMs <= 0) return undefined;
    const id = setTimeout(() => onCloseRef.current(), durationMs);
    return () => clearTimeout(id);
  }, [durationMs, message]);
  return (
    <div role="status" className={styles.toast}>
      {message}
    </div>
  );
}
