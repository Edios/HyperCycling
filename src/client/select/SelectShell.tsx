import type { ReactNode } from 'react';
import { AppBar } from '../ui/AppBar';
import styles from './SelectShell.module.css';

/** App bar plus a tab body; the page background matches the mockups. */
export function SelectShell({ children }: { children: ReactNode }) {
  return (
    <div data-testid="app-shell" className={styles.shell}>
      <AppBar />
      <main>{children}</main>
    </div>
  );
}
