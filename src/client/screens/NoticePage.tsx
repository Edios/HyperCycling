import { Link } from 'react-router-dom';
import { useT, type MessageKey } from '../i18n';
import { AppBar } from '../ui/AppBar';

/** A short explanation instead of a silent redirect: unknown address, or a screen with no data. */
export function NoticePage({ titleKey, bodyKey }: { titleKey: MessageKey; bodyKey: MessageKey }) {
  const t = useT();
  return (
    <div data-testid="notice-page">
      <AppBar />
      <main style={{ padding: '2.25rem 2.5rem' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.875rem', marginTop: 0 }}>
          {t(titleKey)}
        </h1>
        <p style={{ color: 'var(--mut)', fontSize: '1.125rem' }}>{t(bodyKey)}</p>
        <Link to="/" style={{ color: 'var(--act-text)', fontSize: '1.125rem' }}>
          {t('notice.home')}
        </Link>
      </main>
    </div>
  );
}
