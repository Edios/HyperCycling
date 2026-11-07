import { useState } from 'react';
import { useSettings, updateSettings } from '../data/useSettings';
import { useSessionStore } from '../training/session-store';
import { useT } from '../i18n';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

/**
 * One-time question for profiles saved before stepped effort existed: those keep smooth ramps
 * until the rider says they use a manual knob. Fresh profiles already default to the knob.
 */
export function KnobPrompt() {
  const t = useT();
  const { settings, loaded } = useSettings();
  const [dismissed, setDismissed] = useState(false);
  const sessionOpen = useSessionStore((s) => s.runtime !== undefined);
  if (!loaded || dismissed || sessionOpen || settings.resistanceMode !== undefined) return null;
  const answer = (resistanceMode: 'knob' | 'smart'): void => {
    void updateSettings({ resistanceMode }).catch(() => setDismissed(true));
  };
  return (
    <Modal title={t('knobPrompt.title')} onClose={() => setDismissed(true)}>
      <p>{t('knobPrompt.body')}</p>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <Button variant="primary" onClick={() => answer('knob')}>
          {t('knobPrompt.yes')}
        </Button>
        <Button onClick={() => answer('smart')}>{t('knobPrompt.no')}</Button>
      </div>
    </Modal>
  );
}
