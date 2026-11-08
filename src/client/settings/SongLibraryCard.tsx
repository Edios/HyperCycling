import { useId, useState } from 'react';
import { parseBpmInput } from '../../domain/bpm-match';
import { useT } from '../i18n';
import { useBpmLookup } from '../music/bpmLookup';
import {
  getSharedLibraryStore,
  mergeTracks,
  pendingCount,
  withManualBpm,
  type LibraryTrack,
} from '../music/library/library';
import {
  getSharedTagController,
  useSongLibrary,
  useTagState,
} from '../music/library/tag-controller';
import { BRAND, errorText } from '../music/provider-labels';
import { isSpotifyError } from '../music/spotify/errors';
import { spotifyErrorKey } from '../music/spotify/messages';
import type { SpotifyPlaylist } from '../music/spotify/provider';
import { getSharedSpotifyProvider } from '../music/spotify/shared';
import { useSpotifyConnected } from '../music/spotify/useSpotify';
import { Button } from '../ui/Button';
import styles from './SongLibraryCard.module.css';

const SHOWN = 200;

function sourceLabel(t: ReturnType<typeof useT>, track: LibraryTrack): string {
  if (track.bpm === undefined || !track.bpmSource) return '';
  return track.bpmSource === 'manual' ? t('settings.music.library.manual') : BRAND[track.bpmSource];
}

function SongRow({ track }: { track: LibraryTrack }) {
  const t = useT();
  const store = getSharedLibraryStore();
  const commit = (text: string): void => {
    const trimmed = text.trim();
    const bpm = trimmed === '' ? undefined : parseBpmInput(trimmed);
    if (trimmed !== '' && bpm === undefined) return;
    if (bpm === track.bpm) return;
    store.update((cur) =>
      cur.map((x) => (x.id === track.id ? withManualBpm(x, bpm, Date.now()) : x)),
    );
  };
  const label = track.artist ? `${track.title} · ${track.artist}` : track.title;
  return (
    <li className={styles.row} data-testid="library-track">
      <span className={styles.name} title={label}>
        {label}
      </span>
      <input
        key={`${track.bpm ?? ''}:${track.bpmSource ?? ''}`}
        className={styles.bpm}
        inputMode="numeric"
        data-testid="library-bpm"
        aria-label={`${t('settings.music.library.bpm')}: ${track.title}`}
        defaultValue={track.bpm ?? ''}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
      <small className={styles.source} data-testid="library-source">
        {sourceLabel(t, track)}
      </small>
      <button
        type="button"
        className={styles.remove}
        aria-label={`${t('settings.music.library.remove')}: ${track.title}`}
        onClick={() => store.update((cur) => cur.filter((x) => x.id !== track.id))}
      >
        ×
      </button>
    </li>
  );
}

/**
 * Settings -> Music: import tracks from the rider's own Spotify playlists and tag them with a
 * tempo in the background (M19b). Everything stays on this device; only title and artist go to
 * the tempo providers the rider switched on, and only after the rider presses the button.
 */
export function SongLibraryCard() {
  const t = useT();
  const connected = useSpotifyConnected();
  const lookup = useBpmLookup();
  const tracks = useSongLibrary();
  const tag = useTagState();
  const selectId = useId();
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[] | undefined>();
  const [chosen, setChosen] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const hasProvider = lookup.deezer || lookup.suggestions !== undefined;
  const pending = pendingCount(tracks);
  const running = tag.phase === 'running';

  const fail = (err: unknown): void => {
    const scope = isSpotifyError(err) && err.code === 'forbidden';
    setMessage(t(scope ? 'settings.music.library.err.scope' : spotifyErrorKey(err)));
  };

  const loadPlaylists = async (): Promise<void> => {
    setBusy(true);
    setMessage(undefined);
    try {
      const list = await getSharedSpotifyProvider().listPlaylists();
      setPlaylists(list);
      setChosen(list[0]?.id ?? '');
      if (list.length === 0) setMessage(t('settings.music.library.noPlaylists'));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const importPlaylist = async (): Promise<void> => {
    if (!chosen) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const incoming = await getSharedSpotifyProvider().playlistTracks(chosen);
      const store = getSharedLibraryStore();
      const merged = mergeTracks(store.get(), incoming);
      store.set(merged.tracks);
      setMessage(
        t(
          merged.truncated
            ? 'settings.music.library.importedCapped'
            : 'settings.music.library.imported',
          { added: merged.added, total: incoming.length },
        ),
      );
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const progress = tag.progress;
  return (
    <div className={styles.card} data-testid="song-library">
      <h3 className={styles.title}>{t('settings.music.library.title')}</h3>
      <p className={styles.note}>{t('settings.music.library.hint')}</p>

      {!connected ? (
        <p className={styles.note} data-testid="library-connect-hint">
          {t('settings.music.library.connectFirst')}
        </p>
      ) : (
        <div className={styles.controls}>
          {playlists === undefined ? (
            <Button onClick={() => void loadPlaylists()} disabled={busy}>
              {t('settings.music.library.load')}
            </Button>
          ) : (
            playlists.length > 0 && (
              <>
                <label htmlFor={selectId} className={styles.label}>
                  {t('settings.music.library.playlist')}
                </label>
                <select
                  id={selectId}
                  data-testid="library-playlist"
                  value={chosen}
                  onChange={(e) => setChosen(e.target.value)}
                >
                  {playlists.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.total})
                    </option>
                  ))}
                </select>
                <Button onClick={() => void importPlaylist()} disabled={busy || !chosen}>
                  {t('settings.music.library.import')}
                </Button>
              </>
            )
          )}
        </div>
      )}
      <div role="status" aria-live="polite" className={styles.note} data-testid="library-message">
        {message}
      </div>

      {tracks.length > 0 && (
        <>
          {!hasProvider && (
            <p className={styles.note} data-testid="library-no-provider">
              {t('settings.music.library.noProvider')}
            </p>
          )}
          <div className={styles.controls}>
            {running ? (
              <Button onClick={() => getSharedTagController().pause()} data-testid="library-pause">
                {t('settings.music.library.pause')}
              </Button>
            ) : (
              <Button
                onClick={() => getSharedTagController().start(lookup)}
                disabled={!hasProvider || pending === 0}
                data-testid="library-tag"
              >
                {t(
                  tag.phase === 'paused' || tag.phase === 'stopped'
                    ? 'settings.music.library.resume'
                    : 'settings.music.library.tag',
                  { n: pending },
                )}
              </Button>
            )}
            <Button
              disabled={running}
              onClick={() => {
                getSharedLibraryStore().set([]);
                setMessage(undefined);
              }}
            >
              {t('settings.music.library.clear')}
            </Button>
          </div>
          {progress && tag.phase !== 'idle' && (
            <div className={styles.progress} data-testid="library-progress">
              <progress
                max={Math.max(progress.total, 1)}
                value={progress.done}
                aria-label={t('settings.music.library.progress')}
              />
              <small>
                {t('settings.music.library.progressText', {
                  done: progress.done,
                  total: progress.total,
                  tagged: progress.tagged,
                  missed: progress.missed,
                })}
              </small>
            </div>
          )}
          {tag.phase === 'stopped' && tag.reason && (
            <p role="alert" className={styles.error} data-testid="library-stopped">
              {t('settings.music.library.stopped', { reason: errorText(t, tag.reason) })}
            </p>
          )}
          {tag.phase === 'finished' && (
            <p role="status" className={styles.note}>
              {t('settings.music.library.finished')}
            </p>
          )}
          <p className={styles.note}>{t('settings.music.library.count', { n: tracks.length })}</p>
          <ul className={styles.list} aria-label={t('settings.music.library.title')}>
            {tracks.slice(0, SHOWN).map((x) => (
              <SongRow key={x.id} track={x} />
            ))}
          </ul>
          {tracks.length > SHOWN && (
            <small className={styles.note}>
              {t('settings.music.library.more', { n: tracks.length - SHOWN })}
            </small>
          )}
        </>
      )}
    </div>
  );
}
