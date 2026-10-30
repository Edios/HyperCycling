import { useNavigate } from 'react-router-dom';
import { useT, type MessageKey } from '../i18n';
import { Button } from '../ui/Button';
import { AppBar } from '../ui/AppBar';

/** Stand-in for screens that arrive in later tasks: a title and a way back. */
export function PlaceholderPage({ titleKey }: { titleKey: MessageKey }) {
  const t = useT();
  const navigate = useNavigate();
  return (
    <div data-testid="placeholder-page">
      <AppBar />
      <main style={{ padding: '2.25rem 2.5rem' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.875rem', marginTop: 0 }}>
          {t(titleKey)}
        </h1>
        <p style={{ color: 'var(--mut)' }}>{t('placeholder.body')}</p>
        <Button onClick={() => navigate('/')}>{t('common.back')}</Button>
      </main>
    </div>
  );
}
