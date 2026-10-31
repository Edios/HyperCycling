import { useEffect, useState, type RefObject } from 'react';

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Keeps Tab / Shift+Tab inside `panel` while it is mounted and gives focus back to the element
 * that had it before the dialog opened. Call it before any effect that moves focus into the
 * dialog. The opener is captured while rendering, which is before any child `autoFocus` runs at
 * commit, so the order of the dialog's own effects does not matter.
 */
export function useFocusTrap(panel: RefObject<HTMLElement | null>): void {
  const [previous] = useState(() => document.activeElement as HTMLElement | null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab' || !panel.current) return;
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.hasAttribute('disabled'),
      );
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        e.preventDefault();
        return;
      }
      const active = document.activeElement;
      const outside = !panel.current.contains(active);
      if (e.shiftKey && (active === first || outside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || outside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [panel, previous]);
}
