import { useState } from 'react';
import { updateSettings, useSettings } from '../data/useSettings';
import { useT } from '../i18n';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import styles from './Bike.module.css';
import { BikeWizard } from './BikeWizard';

/**
 * Shown on the ride setup until the "your bike" step was finished or skipped. It never blocks:
 * "Skip and ride" starts with the defaults and remembers the choice.
 */
export function BikeCard({ onSkipRide }: { onSkipRide: () => void }) {
  const t = useT();
  const { settings } = useSettings();
  const [open, setOpen] = useState(false);
  if (settings.bikeSetupDone) return null;
  return (
    <>
      <Card className={styles.card} data-testid="bike-card">
        <h2>{t('bike.cardTitle')}</h2>
        <p>{t('bike.cardBody')}</p>
        <div className={styles.cardActions}>
          <Button variant="primary" data-testid="bike-open" onClick={() => setOpen(true)}>
            {t('bike.setUp')}
          </Button>
          <Button
            data-testid="bike-skip-ride"
            onClick={() => {
              void updateSettings({ bikeSetupDone: true }).catch(() => undefined);
              onSkipRide();
            }}
          >
            {t('bike.skipRide')}
          </Button>
        </div>
      </Card>
      {open && <BikeWizard onClose={() => setOpen(false)} />}
    </>
  );
}
