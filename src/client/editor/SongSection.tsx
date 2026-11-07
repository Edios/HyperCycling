import { useEffect, useId, useMemo, useRef, useState, type Dispatch } from 'react';
import { BPM_MAX, BPM_MIN } from '../../domain/bpm-match';
import type { Lang } from '../../domain/lang';
import { cooldownBlockOf, type SongSlot, type TrackRef, type Workout } from '../../domain/workout';
import { songHint } from '../data/localized';
import { useT } from '../i18n';
import { parseClock, parseTrackUrl } from '../music/parse-track-url';
import { lookupSpotifyTrack } from '../music/spotify/track-info';
import { applyYoutubeCheck, checkYoutubeEmbeddable } from '../music/youtube-check';
import { formatClock } from '../training/format';
import { Button } from '../ui/Button';
import type { EditorAction } from './editor-state';
import { blockTotalSec } from './model';
import styles from './SongSection.module.css';

type Active = { kind: 'song'; id: string } | { kind: 'cooldown' } | undefined;

export interface SongSectionProps {
  workout: Workout;
  selectedId: string | undefined;
  readOnly: boolean;
  lang: Lang;
  dispatch: Dispatch<EditorAction>;
}

interface Span {
  start: number;
  len: number;
}

function spanOf(w: Workout, firstId: string, lastId: string): Span | undefined {
  const a = w.blocks.findIndex((b) => b.id === firstId);
  const z = w.blocks.findIndex((b) => b.id === lastId);
  if (a < 0 || z < a) return undefined;
  const sec = (bs: Workout['blocks']): number => bs.reduce((s, b) => s + blockTotalSec(b), 0);
  return { start: sec(w.blocks.slice(0, a)), len: sec(w.blocks.slice(a, z + 1)) };
}

function trackUrl(track: TrackRef): string {
  return track.provider === 'spotify'
    ? `spotify:track:${track.id}`
    : `https://youtu.be/${track.id}`;
}

/** Link + start time -> pinned track (with the same async title / embeddable checks as a cue). */
function TrackPin({
  track,
  getTrack,
  onPlace,
  onClear,
  readOnly,
  testId,
}: {
  track: TrackRef | undefined;
  getTrack: () => TrackRef | undefined;
  onPlace: (t: TrackRef) => void;
  onClear: () => void;
  readOnly: boolean;
  testId: string;
}) {
  const t = useT();
  const urlId = useId();
  const [url, setUrl] = useState(track ? trackUrl(track) : '');
  const [start, setStart] = useState(formatClock(track?.startAtSec ?? 0));
  const [touched, setTouched] = useState(false);
  const parsed = parseTrackUrl(url);
  const startSec = parseClock(start);
  const urlError = touched && url.trim() !== '' && !parsed;

  const pin = (): void => {
    setTouched(true);
    if (!parsed || startSec === undefined) return;
    const same = track?.provider === parsed.provider && track.id === parsed.id;
    const next: TrackRef = {
      provider: parsed.provider,
      id: parsed.id,
      title: same ? track.title : '',
      ...(same && track.artist ? { artist: track.artist } : {}),
      ...(same && track.bpm !== undefined ? { bpm: track.bpm } : {}),
      startAtSec: startSec,
    };
    onPlace(next);
    if (next.title) return;
    if (next.provider === 'spotify') {
      void lookupSpotifyTrack(next.id).then((info) => {
        const now = getTrack();
        if (!info || !now || now.id !== next.id || now.title) return;
        onPlace({ ...now, title: info.title, ...(info.artist ? { artist: info.artist } : {}) });
      });
    } else {
      void checkYoutubeEmbeddable(next.id).then((check) => {
        const now = getTrack();
        if (!now || now.id !== next.id) return;
        const checked = applyYoutubeCheck(now, check);
        if (checked !== now) onPlace(checked);
      });
    }
  };

  return (
    <div className={styles.group} data-testid={testId}>
      <label htmlFor={urlId}>{t('editor.inspector.track')}</label>
      {track && (
        <small className={styles.cap}>
          {track.title ? `${track.title} · ` : ''}
          {t('editor.inspector.pinned', {
            provider: track.provider === 'spotify' ? 'Spotify' : 'YouTube',
            time: formatClock(track.startAtSec),
          })}
        </small>
      )}
      {!readOnly && (
        <>
          <input
            id={urlId}
            data-testid={`${testId}-url`}
            placeholder={t('editor.inspector.trackUrl')}
            value={url}
            aria-invalid={urlError ? true : undefined}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && pin()}
          />
          {urlError && (
            <small role="alert" className={styles.err}>
              {t('editor.inspector.trackError')}
            </small>
          )}
          <label className={styles.inline}>
            <span>{t('editor.inspector.trackStart')}</span>
            <input
              data-testid={`${testId}-start`}
              value={start}
              aria-invalid={start.trim() !== '' && startSec === undefined ? true : undefined}
              onChange={(e) => setStart(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && pin()}
            />
          </label>
          <div className={styles.row}>
            <Button onClick={pin}>{t('editor.inspector.trackAdd')}</Button>
            {track && (
              <Button
                onClick={() => {
                  onClear();
                  setUrl('');
                  setStart('0:00');
                }}
              >
                {t('editor.inspector.trackClear')}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function parseBpm(text: string): number | undefined {
  if (!/^\d{2,3}$/.test(text.trim())) return undefined;
  const v = Number(text);
  return v >= BPM_MIN && v <= BPM_MAX ? v : undefined;
}

function SongPanel({
  workout,
  song,
  index,
  readOnly,
  lang,
  dispatch,
}: {
  workout: Workout;
  song: SongSlot;
  index: number;
  readOnly: boolean;
  lang: Lang;
  dispatch: Dispatch<EditorAction>;
}) {
  const t = useT();
  const shownHint = readOnly ? (songHint(workout, song, lang) ?? '') : (song.hint ?? '');
  const [hint, setHint] = useState(shownHint);
  const [lo, setLo] = useState(song.bpm ? String(song.bpm[0]) : '');
  const [hi, setHi] = useState(song.bpm ? String(song.bpm[1]) : '');
  const ref = useRef(workout);
  useEffect(() => {
    ref.current = workout;
  });
  const loV = parseBpm(lo);
  const hiV = parseBpm(hi);
  const bad =
    (lo.trim() !== '' || hi.trim() !== '') && (loV === undefined || hiV === undefined || loV > hiV);
  const commitBpm = (): void => {
    if (lo.trim() === '' && hi.trim() === '') {
      if (song.bpm) dispatch({ type: 'updateSong', id: song.id, patch: { bpm: null } });
      return;
    }
    if (bad || loV === undefined || hiV === undefined) return;
    if (song.bpm?.[0] === loV && song.bpm[1] === hiV) return;
    dispatch({ type: 'updateSong', id: song.id, patch: { bpm: [loV, hiV] } });
  };
  const span = spanOf(workout, song.firstBlockId, song.lastBlockId);
  const hintId = useId();
  return (
    <div className={styles.panel} data-testid="song-panel">
      <div className={styles.panelHead}>
        <strong>{t('editor.songs.song', { n: index + 1 })}</strong>
        {span && <span>{formatClock(span.len)}</span>}
      </div>
      {!readOnly && (
        <div className={styles.row} role="group" aria-label={t('editor.songs.range')}>
          {(
            [
              ['start', 1, 'editor.songs.startEarlier', '◂+'],
              ['start', -1, 'editor.songs.startLater', '▸−'],
              ['end', -1, 'editor.songs.endEarlier', '◂−'],
              ['end', 1, 'editor.songs.endLater', '▸+'],
            ] as const
          ).map(([edge, delta, key, glyph]) => (
            <button
              key={key}
              type="button"
              className={styles.step}
              title={t(key)}
              aria-label={t(key)}
              data-testid={`song-${edge}-${delta > 0 ? 'plus' : 'minus'}`}
              onClick={() => dispatch({ type: 'resizeSong', id: song.id, edge, delta })}
            >
              {glyph}
            </button>
          ))}
        </div>
      )}
      <div className={styles.group}>
        <label htmlFor={hintId}>{t('editor.songs.hint')}</label>
        <input
          id={hintId}
          data-testid="song-hint"
          maxLength={200}
          readOnly={readOnly}
          value={hint}
          onChange={(e) => setHint(e.target.value)}
          onBlur={() => {
            if (!readOnly && hint !== (song.hint ?? ''))
              dispatch({ type: 'updateSong', id: song.id, patch: { hint } });
          }}
        />
      </div>
      <div className={styles.group}>
        <span>{t('editor.songs.bpm')}</span>
        <div className={styles.row}>
          <input
            aria-label={t('editor.songs.bpmMin')}
            data-testid="song-bpm-min"
            inputMode="numeric"
            readOnly={readOnly}
            value={lo}
            aria-invalid={bad ? true : undefined}
            onChange={(e) => setLo(e.target.value)}
            onBlur={commitBpm}
          />
          <span aria-hidden="true">–</span>
          <input
            aria-label={t('editor.songs.bpmMax')}
            data-testid="song-bpm-max"
            inputMode="numeric"
            readOnly={readOnly}
            value={hi}
            aria-invalid={bad ? true : undefined}
            onChange={(e) => setHi(e.target.value)}
            onBlur={commitBpm}
          />
        </div>
        {bad && (
          <small role="alert" className={styles.err}>
            {t('editor.songs.bpmError', { min: BPM_MIN, max: BPM_MAX })}
          </small>
        )}
      </div>
      <TrackPin
        key={song.track ? `${song.track.id}:${song.track.title}` : 'none'}
        track={song.track}
        getTrack={() => ref.current.songs?.find((s) => s.id === song.id)?.track}
        onPlace={(track) => dispatch({ type: 'updateSong', id: song.id, patch: { track } })}
        onClear={() => dispatch({ type: 'updateSong', id: song.id, patch: { track: null } })}
        readOnly={readOnly}
        testId="song-track"
      />
      {!readOnly && (
        <Button onClick={() => dispatch({ type: 'removeSong', id: song.id })}>
          {t('editor.songs.remove')}
        </Button>
      )}
    </div>
  );
}

/** Lanes under the timeline: song slots (M16) and the cooldown track (M19c). */
export function SongSection({ workout, selectedId, readOnly, lang, dispatch }: SongSectionProps) {
  const t = useT();
  const [active, setActive] = useState<Active>(undefined);
  const total = workout.blocks.reduce((s, b) => s + blockTotalSec(b), 0);
  const songs = useMemo(() => workout.songs ?? [], [workout.songs]);
  const cooldown = cooldownBlockOf(workout);
  const wantNew = useRef(false);
  const latest = useRef(workout);
  useEffect(() => {
    latest.current = workout;
  });
  const seen = useRef(new Set(songs.map((s) => s.id)));
  useEffect(() => {
    const fresh = songs.find((s) => !seen.current.has(s.id));
    seen.current = new Set(songs.map((s) => s.id));
    if (fresh && wantNew.current) {
      wantNew.current = false;
      setActive({ kind: 'song', id: fresh.id });
    }
  }, [songs]);

  const selTop = selectedId
    ? workout.blocks.find(
        (b) =>
          b.id === selectedId || (b.kind === 'repeat' && b.blocks.some((c) => c.id === selectedId)),
      )?.id
    : undefined;
  const selIndex = workout.blocks.findIndex((b) => b.id === selTop);
  const covered = (i: number): boolean =>
    songs.some((s) => {
      const a = workout.blocks.findIndex((b) => b.id === s.firstBlockId);
      const z = workout.blocks.findIndex((b) => b.id === s.lastBlockId);
      return i >= a && i <= z;
    });
  const canAdd = !readOnly && selTop !== undefined && selIndex >= 0 && !covered(selIndex);

  if (total === 0) return null;
  if (readOnly && songs.length === 0 && !workout.cooldownTrack) return null;

  const pct = (sec: number): number => (sec / total) * 100;
  const activeSong = active?.kind === 'song' ? songs.findIndex((s) => s.id === active.id) : -1;
  const ghostSpan = canAdd && selTop ? spanOf(workout, selTop, selTop) : undefined;
  const coolSpan = cooldown ? spanOf(workout, cooldown.id, cooldown.id) : undefined;
  const cool = workout.cooldownTrack;
  const coolOn = active?.kind === 'cooldown';

  return (
    <section
      className={styles.section}
      data-testid="song-section"
      aria-label={t('editor.songs.title')}
    >
      <div className={styles.laneLabel}>{t('editor.songs.title')}</div>
      <div className={styles.lane} data-testid="song-lane">
        {songs.map((s, i) => {
          const span = spanOf(workout, s.firstBlockId, s.lastBlockId);
          if (!span) return null;
          const on = active?.kind === 'song' && active.id === s.id;
          const name = s.track?.title || (readOnly ? songHint(workout, s, lang) : s.hint) || '';
          return (
            <button
              key={s.id}
              type="button"
              data-testid="song-pill"
              aria-pressed={on}
              className={`${styles.pill} ${on ? styles.on : ''}`}
              style={{ left: `${pct(span.start)}%`, width: `calc(${pct(span.len)}% - 4px)` }}
              onClick={() => setActive(on ? undefined : { kind: 'song', id: s.id })}
            >
              {s.track ? '♫ ' : ''}
              {i + 1}
              {name ? ` · ${name}` : ''}
            </button>
          );
        })}
        {ghostSpan && (
          <button
            type="button"
            data-testid="song-add"
            className={`${styles.pill} ${styles.ghost}`}
            style={{
              left: `${pct(ghostSpan.start)}%`,
              width: `calc(${Math.max(pct(ghostSpan.len), 14)}% - 4px)`,
              maxWidth: `calc(${100 - pct(ghostSpan.start)}% - 4px)`,
            }}
            onClick={() => {
              if (!selTop) return;
              wantNew.current = true;
              dispatch({ type: 'addSong', blockId: selTop });
            }}
          >
            {t('editor.songs.add')}
          </button>
        )}
      </div>
      {cooldown && coolSpan && (cool || !readOnly) && (
        <>
          <div className={styles.laneLabel}>{t('editor.songs.cooldown')}</div>
          <div className={styles.lane} data-testid="cooldown-lane">
            <button
              type="button"
              data-testid={cool ? 'cooldown-pill' : 'cooldown-add'}
              aria-pressed={coolOn}
              className={`${styles.pill} ${cool ? '' : styles.ghost} ${coolOn ? styles.on : ''}`}
              style={{ right: 0, width: `max(calc(${pct(coolSpan.len)}% - 4px), 12rem)` }}
              onClick={() => setActive(coolOn ? undefined : { kind: 'cooldown' })}
            >
              {cool
                ? `♫ ${cool.title || t('editor.songs.cooldownTrack')}`
                : t('editor.songs.cooldownAdd')}
            </button>
          </div>
        </>
      )}
      {activeSong >= 0 && songs[activeSong] && (
        <SongPanel
          key={songs[activeSong].id}
          workout={workout}
          song={songs[activeSong]}
          index={activeSong}
          readOnly={readOnly}
          lang={lang}
          dispatch={dispatch}
        />
      )}
      {coolOn && (
        <div className={styles.panel} data-testid="cooldown-panel">
          <p className={styles.note}>{t('editor.songs.cooldownNote')}</p>
          <TrackPin
            key={cool ? `${cool.id}:${cool.title}` : 'none'}
            track={cool}
            getTrack={() => latest.current.cooldownTrack}
            onPlace={(track) => dispatch({ type: 'setCooldownTrack', track })}
            onClear={() => dispatch({ type: 'setCooldownTrack', track: null })}
            readOnly={readOnly}
            testId="cooldown-track"
          />
        </div>
      )}
    </section>
  );
}
