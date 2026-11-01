import { useT } from './i18n';

export function App() {
  const t = useT();
  return (
    <main data-testid="app-shell">
      <h1>{t('app.title')}</h1>
    </main>
  );
}
