import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { AppBar } from '../ui/AppBar';
import styles from './SelectShell.module.css';

/** App bar plus a tab body; the page background matches the mockups. */
export function SelectShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const mode = pathname.startsWith('/freestyle') ? 'free' : 'plan';
  return (
    <div data-testid="app-shell" data-mode={mode} className={styles.shell}>
      <AppBar />
      <main>{children}</main>
    </div>
  );
}
