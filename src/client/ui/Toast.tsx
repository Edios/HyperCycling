import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import styles from './Toast.module.css';

export interface ToastProps {
  message: string;
  onClose: () => void;
  /** Auto-dismiss delay; 0 keeps it until the owner removes it. */
  durationMs?: number;
}

const InStack = createContext(false);

/** Bottom-centre column for several toasts at once, so they never cover each other. */
export function ToastStack({ children }: { children: ReactNode }) {
  return (
    <div className={styles.stack} data-testid="toast-stack">
      <InStack.Provider value={true}>{children}</InStack.Provider>
    </div>
  );
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
  const inStack = useContext(InStack);
  const body = (
    <div role="status" className={styles.toast}>
      {message}
    </div>
  );
  return inStack ? body : <ToastStack>{body}</ToastStack>;
}
