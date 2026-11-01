import { useEffect, useState } from 'react';

/**
 * Gives focus back to the element that had it before the calling component mounted, when it
 * unmounts. The opener is captured while rendering, before any child moves focus.
 */
export function useRestoreFocus(): void {
  const [previous] = useState(() => document.activeElement as HTMLElement | null);
  useEffect(
    () => () => {
      if (previous && previous !== document.body && previous.isConnected) previous.focus?.();
    },
    [previous],
  );
}
