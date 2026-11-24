import { useEffect, useId, useRef, useState } from 'react';
import { cadenceFit, sortByCadence } from '../../domain/bpm-match';
import { useT } from '../i18n';
import { useBpmLookup, type SongCandidate, type SongProvider } from '../music/bpmLookup';
import { BRAND, errorInfo, errorText, SITE, type ErrorInfo } from '../music/provider-labels';
import { Button } from '../ui/Button';
import { CadenceBadge, cadenceText } from './Cadence';
import styles from './SongSection.module.css';

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; hits: SongCandidate[]; failed: ErrorInfo[] }
  | ({ status: 'error' } & ErrorInfo);

/**
 * Search a song by artist and/or title (M19d): GetSongBPM with the rider's key, Deezer (no key)
 * when the rider turned it on in Settings. Only numbers and links are kept; the tempo can be corrected by hand after
 * picking. `rpm` is the cadence the slot asks for (its tempo range or its block's cadence), the
 * same one the suggestion chips judge by, used to mark and sort the hits.
 */
export function SongFinder({
  rpm,
  onPick,
}: {
  rpm: number | undefined;
  onPick: (hit: SongCandidate) => void;
}) {
  const t = useT();
  const lookup = useBpmLookup();
  const hasKey = lookup.suggestions !== undefined;
  const hasDeezer = lookup.deezer;
  const [artist, setArtist] = useState('');
  const [title, setTitle] = useState('');
  const [provider, setProvider] = useState<SongProvider>('auto');
  const [state, setState] = useState<State>({ status: 'idle' });
  const [onlyFitting, setOnlyFitting] = useState(false);
  const alive = useRef(true);
  const run = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const ids = { artist: useId(), title: useId(), provider: useId() };
  // A key removed in Settings while GetSongBPM was chosen falls back to automatic.
  const effective: SongProvider =
    (provider === 'getsongbpm' && !hasKey) || (provider === 'deezer' && !hasDeezer)
      ? 'auto'
      : provider;
  const canSearch = (title.trim() !== '' || artist.trim() !== '') && state.status !== 'loading';

  const search = async (): Promise<void> => {
    if (!canSearch) return;
    const mine = ++run.current;
    setState({ status: 'loading' });
    try {
      const res = await lookup.search(
        { title: title.trim(), ...(artist.trim() ? { artist: artist.trim() } : {}) },
        effective,
      );
      if (alive.current && mine === run.current)
        setState({ status: 'done', hits: res.hits, failed: res.errors.map(errorInfo) });
    } catch (err) {
      if (alive.current && mine === run.current) setState({ status: 'error', ...errorInfo(err) });
    }
  };

  // Best fit first (stable inside a group); the filter drops what does not fit the cadence.
  const hits = state.status === 'done' ? state.hits : [];
  const ordered = rpm === undefined ? hits : sortByCadence(hits, (h) => cadenceFit(h.bpm, rpm));
  const shown =
    rpm !== undefined && onlyFitting
      ? ordered.filter((h) => cadenceFit(h.bpm, rpm)?.verdict !== 'miss')
      : ordered;
  const hidden = hits.length - shown.length;

  return (
    <div className={styles.group} data-testid="song-finder">
      <span>{t('editor.songs.finder.title')}</span>
      <div className={styles.finderInputs}>
        <input
          id={ids.artist}
          data-testid="finder-artist"
          aria-label={t('editor.songs.finder.artist')}
          placeholder={t('editor.songs.finder.artist')}
          maxLength={80}
          value={artist}
          onChange={(e) => setArtist(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void search()}
        />
        <input
          id={ids.title}
          data-testid="finder-title"
          aria-label={t('editor.songs.finder.songTitle')}
          placeholder={t('editor.songs.finder.songTitle')}
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void search()}
        />
      </div>
      <div className={styles.row}>
        <label className={styles.inline} htmlFor={ids.provider}>
          <span>{t('editor.songs.finder.provider')}</span>
          <select
            id={ids.provider}
            data-testid="finder-provider"
            value={effective}
            onChange={(e) => setProvider(e.target.value as SongProvider)}
          >
            <option value="auto">{t('editor.songs.finder.auto')}</option>
            {hasDeezer && <option value="deezer">{BRAND.deezer}</option>}
            {hasKey && <option value="getsongbpm">{BRAND.getsongbpm}</option>}
          </select>
        </label>
        <Button onClick={() => void search()} disabled={!canSearch} data-testid="finder-search">
          {state.status === 'loading'
            ? t('editor.songs.finder.searching')
            : t('editor.songs.finder.search')}
        </Button>
      </div>
      {state.status === 'error' && (
        <small role="alert" className={styles.err} data-testid="finder-error">
          {errorText(t, state)}
        </small>
      )}
      {state.status === 'done' && state.failed.length > 0 && (
        <small role="status" className={styles.cap}>
          {state.failed.map((f) => errorText(t, f)).join(' ')}
        </small>
      )}
      {state.status === 'done' && state.hits.length === 0 && (
        <small role="status" className={styles.cap} data-testid="finder-empty">
          {t('editor.songs.finder.none')}
        </small>
      )}
      {state.status === 'done' && state.hits.length > 0 && rpm !== undefined && (
        <label className={styles.check} data-testid="finder-filter">
          <input
            type="checkbox"
            checked={onlyFitting}
            onChange={(e) => setOnlyFitting(e.target.checked)}
          />
          <span>{t('editor.cadence.filter')}</span>
        </label>
      )}
      {state.status === 'done' && state.hits.length > 0 && rpm !== undefined && (
        <small role="status" className={styles.cap} data-testid="finder-hidden">
          {hidden > 0 ? t('editor.cadence.filterHidden', { n: hidden }) : ''}
        </small>
      )}
      {state.status === 'done' && shown.length > 0 && (
        <ul className={styles.hits} data-testid="finder-results">
          {shown.map((h) => {
            const fit = cadenceFit(h.bpm, rpm);
            const rpmText = cadenceText(t, h.bpm);
            const name = h.artist ? `${h.artist} – ${h.title}` : h.title;
            return (
              <li key={`${h.source}:${h.url}`} className={styles.hit}>
                <span className={styles.hitText}>
                  <a
                    href={h.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${name} (${t('editor.bpm.newTab')})`}
                  >
                    {name}
                  </a>
                  <small className={styles.cap}>
                    {t('editor.songs.finder.hitInfo', { bpm: h.bpm, source: BRAND[h.source] })}
                    {rpmText && ` · ${rpmText}`}
                  </small>
                  {fit && <CadenceBadge fit={fit} testId="finder-fit" />}
                </span>
                <Button onClick={() => onPick(h)} data-testid="finder-pick">
                  {t('editor.songs.finder.use')}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {state.status === 'done' && state.hits.length > 0 && (
        <small className={styles.cap}>
          {t('editor.bpm.dataFrom')}{' '}
          {[...new Set(state.hits.map((h) => h.source))].map((s, i) => (
            <span key={s}>
              {i > 0 && ', '}
              <a
                href={SITE[s]}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${BRAND[s]} (${t('editor.bpm.newTab')})`}
              >
                {BRAND[s]}
              </a>
            </span>
          ))}
        </small>
      )}
    </div>
  );
}
