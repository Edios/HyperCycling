import { useEffect } from 'react';
import {
  didSettingsLoadFail,
  getSettingsSnapshot,
  updateSettings,
  useSettings,
} from '../data/useSettings';
import { DiagnosticsOverlay } from './DiagnosticsOverlay';
import { installErrorLog } from './error-log';
import { diagParam, isDiagShortcut } from './toggle';

/** Flips diagnostics mode and stores the choice (Ctrl+Shift+D, five taps on the logo). */
export function toggleDiagnostics(): void {
  if (didSettingsLoadFail()) return;
  void updateSettings({ diagnostics: getSettingsSnapshot().diagnostics !== true }).catch(
    () => undefined,
  );
}

/**
 * Diagnostics mode on every screen (mounted once in Root): the shortcut, `?diag` in the address,
 * the error log and the overlay. When the mode is off only the key listener remains; nothing runs
 * per frame.
 */
export function GlobalDiagnostics() {
  const { settings, loaded } = useSettings();
  const on = settings.diagnostics === true;

  // `?diag` / `?diag=0` in the address, applied once the stored settings are known.
  useEffect(() => {
    if (!loaded || didSettingsLoadFail()) return;
    const want = diagParam(location.search, location.hash);
    if (want !== undefined && want !== (getSettingsSnapshot().diagnostics === true)) {
      void updateSettings({ diagnostics: want }).catch(() => undefined);
    }
  }, [loaded]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!isDiagShortcut(e) || e.repeat) return;
      e.preventDefault();
      toggleDiagnostics();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => (on ? installErrorLog() : undefined), [on]);

  return on ? <DiagnosticsOverlay /> : null;
}
