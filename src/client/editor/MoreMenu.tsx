import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../i18n';
import styles from './MoreMenu.module.css';

export interface MoreMenuItem {
  key: string;
  label: string;
  /** In-app link; without it the item is a button. */
  to?: string;
  onSelect?: () => void;
  disabled?: boolean;
  /** Shown only on narrow screens (undo and redo have their own buttons on a wide bar). */
  narrowOnly?: boolean;
  icon?: ReactNode;
}

/** The "⋯" menu of the editor bar: rarely used actions out of the way. Esc and outside click close it. */
export function MoreMenu({ items }: { items: MoreMenuItem[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: PointerEvent): void => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  useEffect(() => {
    if (open)
      [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])]
        .find((el) => el.getClientRects().length > 0)
        ?.focus();
  }, [open]);

  const close = (refocus: boolean): void => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const all = [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const enabled = all.filter(
      (el) => !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0,
    );
    if (enabled.length === 0) return;
    e.preventDefault();
    const at = enabled.indexOf(document.activeElement as HTMLElement);
    const step = e.key === 'ArrowDown' ? 1 : -1;
    enabled[(at + step + enabled.length) % enabled.length]?.focus();
  };

  return (
    <div className={styles.root} ref={root} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className={styles.trigger}
        aria-label={t('editor.more')}
        title={t('editor.more')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-testid="editor-more"
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <div id={menuId} role="menu" className={styles.menu} data-testid="editor-more-menu">
          {items.map((item) => {
            const cls = `${styles.item} ${item.narrowOnly ? styles.narrowOnly : ''}`;
            if (item.to) {
              return (
                <Link
                  key={item.key}
                  to={item.to}
                  role="menuitem"
                  className={cls}
                  onClick={() => close(false)}
                >
                  {item.icon} {item.label}
                </Link>
              );
            }
            return (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                className={cls}
                disabled={item.disabled}
                onClick={() => {
                  close(false);
                  item.onSelect?.();
                }}
              >
                {item.icon} {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
