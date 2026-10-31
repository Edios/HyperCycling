import { useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { TrackRef } from '../../domain/workout';
import { useT } from '../i18n';
import { spotifyErrorKey } from '../music/spotify/messages';
import { getSharedSpotifyProvider } from '../music/spotify/shared';
import { useSpotifyConnected } from '../music/spotify/useSpotify';
import { Button } from '../ui/Button';
import styles from './Inspector.module.css';

/** Spotify track search (at most 10 results) for the track field; hints at Settings when offline. */
export function SpotifySearch({ onPick }: { onPick: (track: TrackRef) => void }) {
  const t = useT();
  const connected = useSpotifyConnected();
  const inputId = useId();
  const [query, setQuery] = useState('');
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'results'; items: TrackRef[] }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });
  const latest = useRef(0);
  const run = (): void => {
    const q = query.trim();
    if (!q) return;
    const mine = ++latest.current;
    setState({ kind: 'loading' });
    getSharedSpotifyProvider()
      .search(q)
      .then(
        (items) => {
          if (mine === latest.current) setState({ kind: 'results', items: items.slice(0, 10) });
        },
        (err: unknown) => {
          if (mine === latest.current) {
            setState({ kind: 'error', message: t(spotifyErrorKey(err)) });
          }
        },
      );
  };
  if (!connected) {
    return (
      <small className={styles.caption} data-testid="spotify-search-hint">
        {t('music.spotifyConnectHint')} <Link to="/settings">{t('music.spotifyOpenSettings')}</Link>
      </small>
    );
  }
  return (
    <div className={styles.group} data-testid="spotify-search">
      <label className={styles.groupLabel} htmlFor={inputId}>
        {t('music.spotifySearch')}
      </label>
      <div className={styles.row}>
        <input
          id={inputId}
          data-testid="spotify-query"
          className={styles.wide}
          placeholder={t('music.spotifySearchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              run();
            }
          }}
        />
        <Button onClick={run}>{t('music.spotifySearchGo')}</Button>
      </div>
      <div aria-live="polite">
        {state.kind === 'loading' && (
          <small className={styles.caption}>{t('music.spotifySearching')}</small>
        )}
        {state.kind === 'error' && (
          <small role="alert" className={styles.error}>
            {state.message}
          </small>
        )}
        {state.kind === 'results' && state.items.length === 0 && (
          <small className={styles.caption}>{t('music.spotifyNoResults')}</small>
        )}
      </div>
      {state.kind === 'results' && state.items.length > 0 && (
        <ul className={styles.results} aria-label={t('music.spotifyResults')}>
          {state.items.map((tr, i) => (
            <li key={`${tr.id}:${i}`} data-testid="spotify-result">
              <span className={styles.trackName}>
                {tr.title}
                {tr.artist ? ` · ${tr.artist}` : ''}
              </span>
              <Button
                onClick={() => onPick(tr)}
                aria-label={`${t('music.spotifyUse')}: ${tr.title}`}
              >
                {t('music.spotifyUse')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
