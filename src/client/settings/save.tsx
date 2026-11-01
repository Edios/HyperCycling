import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import type { Settings } from '../../domain/settings';
import { updateSettings } from '../data/useSettings';
import { useT } from '../i18n';
import { Toast } from '../ui/Toast';

/** Saves a settings patch; resolves true on success and false after showing an error toast. */
type Save = (patch: Partial<Settings>) => Promise<boolean>;

const quiet: Save = (patch) =>
  updateSettings(patch).then(
    () => true,
    () => false,
  );

const SaveContext = createContext<Save>(quiet);

/** Every control on the screen saves immediately; a failed write shows one error toast. */
export function SaveProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [failures, setFailures] = useState(0);
  const save = useCallback<Save>(async (patch) => {
    try {
      await updateSettings(patch);
      return true;
    } catch (err) {
      console.warn('Saving settings failed', err);
      setFailures((n) => n + 1);
      return false;
    }
  }, []);
  return (
    <SaveContext.Provider value={save}>
      {children}
      {failures > 0 && (
        <Toast key={failures} message={t('settings.saveFailed')} onClose={() => setFailures(0)} />
      )}
    </SaveContext.Provider>
  );
}

export function useSave(): Save {
  return useContext(SaveContext);
}
