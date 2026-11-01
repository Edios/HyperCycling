import { useNavigate } from 'react-router-dom';
import { useLang, useT } from '../i18n';
import { formatClock } from '../training/format';
import { useLastResult } from '../training/last-result';

/** Temporary summary (M5 replaces it): workout name and time ridden. */
export function SummaryPlaceholder() {
  const t = useT();
  const [lang] = useLang();
  const navigate = useNavigate();
  const result = useLastResult((s) => s.result);
  const name = result ? (result.workout.localized?.[lang]?.name ?? result.workout.name) : '';
  return (
    <main data-testid="summary-screen">
      <h1>{t('summary.title')}</h1>
      {result && (
        <>
          <h2 data-testid="summary-name">{name}</h2>
          <p data-testid="summary-status">
            {result.completed ? t('summary.completed') : t('summary.ended')}
          </p>
          <p>
            {t('summary.ridden')}:{' '}
            <strong data-testid="summary-ridden">
              {formatClock(result.riddenSec, { round: 'floor' })}
            </strong>
          </p>
        </>
      )}
      <button type="button" onClick={() => navigate('/')}>
        {t('summary.back')}
      </button>
    </main>
  );
}
