import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { byDay, type ChangeType, type ChangelogEntry } from '../../shared/changelog';
import { useLang, useT, type Lang, type MessageKey } from '../i18n';
import { AppBar } from '../ui/AppBar';
import { changelog, entryText, markSeen, splitDays } from './whats-new';
import styles from './WhatsNew.module.css';

const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? 'dev';

const TYPE_KEY: Record<ChangeType, MessageKey> = {
  feat: 'whatsNew.type.feat',
  fix: 'whatsNew.type.fix',
  perf: 'whatsNew.type.perf',
  refactor: 'whatsNew.type.refactor',
  other: 'whatsNew.type.other',
};

function Day({ date, entries, lang }: { date: string; entries: ChangelogEntry[]; lang: Lang }) {
  const t = useT();
  const label = new Date(`${date}T12:00:00Z`).toLocaleDateString(
    lang === 'pl' ? 'pl-PL' : 'en-GB',
    {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    },
  );
  return (
    <section className={styles.day} data-testid="whats-new-day">
      <h2 className={styles.date}>
        <time dateTime={date}>{label}</time>
      </h2>
      <ul className={styles.list}>
        {entries.map((e) => {
          const { text, lang: textLang } = entryText(e, lang);
          return (
            <li key={e.pr} className={styles.item} data-type={e.type}>
              <span className={styles.tag}>{t(TYPE_KEY[e.type])}</span>
              <span lang={textLang === lang ? undefined : textLang}>{text}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * "What's new": the changes per day, newest first (Polish texts for recent changes; the older ones
 * in English, folded). Opening it clears the new-items dot.
 */
export function WhatsNew() {
  const t = useT();
  const [lang] = useLang();
  useEffect(() => markSeen(), []);
  const { recent, older } = useMemo(() => splitDays(byDay(changelog.entries)), []);

  return (
    <div data-testid="whats-new">
      <AppBar />
      <main className={styles.main}>
        <header className={styles.hero}>
          <p className={styles.eyebrow}>{t('whatsNew.eyebrow')}</p>
          <h1>{t('whatsNew.title')}</h1>
          <p className={styles.version} data-testid="whats-new-version">
            {t('whatsNew.version', { version: APP_VERSION })}
          </p>
        </header>
        {recent.map((d) => (
          <Day key={d.date} date={d.date} entries={d.entries} lang={lang} />
        ))}
        {older.length > 0 && (
          <details className={styles.older} data-testid="whats-new-older">
            <summary>{t('whatsNew.older')}</summary>
            {older.map((d) => (
              <Day key={d.date} date={d.date} entries={d.entries} lang={lang} />
            ))}
          </details>
        )}
        <p className={styles.back}>
          <Link to="/how-it-works">{t('whatsNew.back')}</Link>
        </p>
      </main>
    </div>
  );
}
