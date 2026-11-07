import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BPM_MAX,
  BPM_MIN,
  genresForRpm,
  matchBpm,
  parseBpmInput,
  tapTempoBpm,
  targetBpms,
  type MatchKind,
} from '../../domain/bpm-match';
import type { BpmSource, TrackRef } from '../../domain/workout';
import { useT } from '../i18n';
import { useBpmLookup } from '../music/bpmLookup';
import { type BpmHit } from '../music/getsongbpm/client';
import { BRAND, errorInfo, errorText, SITE, type ErrorInfo } from '../music/provider-labels';
import { trackQuery } from '../music/getsongbpm/query';
import { Button } from '../ui/Button';
import styles from './Inspector.module.css';

type LookupState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'notFound' }
  | ({ status: 'error' } & ErrorInfo);

type SuggestState =
  | { status: 'idle' }
  | { status: 'loading' }
  | ({ status: 'error' } & ErrorInfo)
  | { status: 'done'; groups: { kind: MatchKind; bpm: number; hits: BpmHit[] }[] };

const SUGGESTIONS_PER_GROUP = 6;

/**
 * Tempo of the pinned track and how well it fits the block's cadence: 2 BPM = 1 RPM, half and
 * double time also count. The tempo is typed, tapped or
 * looked up (Deezer needs no key, GetSongBPM uses the key from Settings); a looked-up value shows
 * its source and stays editable. Without a pinned track it
 * tells which tempo and genres to look for, and can list songs at that tempo.
 */
export function BpmField({
  rpm,
  track,
  onChange,
}: {
  rpm: number | undefined;
  track: TrackRef | undefined;
  /** `source` is set for a looked-up value; any typed or tapped value arrives without it. */
  onChange: (bpm: number | undefined, source?: BpmSource) => void;
}) {
  const t = useT();
  const bpmId = useId();
  const bpmLookup = useBpmLookup();
  const client = bpmLookup.suggestions;
  const [text, setText] = useState(track?.bpm === undefined ? '' : String(track.bpm));
  const [touched, setTouched] = useState(false);
  const [lookupRaw, setLookup] = useState<LookupState>({ status: 'idle' });
  const [suggestRaw, setSuggest] = useState<SuggestState>({ status: 'idle' });
  const [lookupFor, setLookupFor] = useState<string>();
  const [suggestFor, setSuggestFor] = useState<number>();
  // Results belong to the track and cadence they were asked for; others show nothing.
  const trackId = track ? `${track.provider}:${track.id}` : undefined;
  const lookup: LookupState = lookupFor === trackId ? lookupRaw : { status: 'idle' };
  const suggest: SuggestState = suggestFor === rpm ? suggestRaw : { status: 'idle' };
  const taps = useRef<number[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const committed = useRef(track?.bpm);
  const textRef = useRef(text);
  const onChangeRef = useRef(onChange);
  const trackRef = useRef(track);
  const alive = useRef(true);
  useEffect(() => {
    textRef.current = text;
    onChangeRef.current = onChange;
    trackRef.current = track;
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const empty = text.trim() === '';
  const value = empty ? undefined : parseBpmInput(text);
  const invalid = !empty && value === undefined;

  // One undo step per change: the value is stored on blur/Enter, and taps after a short pause.
  const flush = (): void => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const raw = textRef.current;
    const next = raw.trim() === '' ? undefined : parseBpmInput(raw);
    if (raw.trim() !== '' && next === undefined) return;
    if (next === committed.current) return;
    committed.current = next;
    onChangeRef.current(next);
  };
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });
  // A pending tap result is not lost when the field goes away.
  useEffect(() => () => flushRef.current(), []);
  // Undo/redo changes the stored value: show it.
  useEffect(() => {
    if (track?.bpm === committed.current) return;
    committed.current = track?.bpm;
    setText(track?.bpm === undefined ? '' : String(track.bpm));
  }, [track?.bpm]);

  const tap = (): void => {
    const now = performance.now();
    const last = taps.current[taps.current.length - 1];
    // A pause longer than 2 s starts a new measurement.
    taps.current = last !== undefined && now - last > 2000 ? [now] : [...taps.current, now];
    const bpm = tapTempoBpm(taps.current);
    if (bpm === undefined) return;
    setText(String(bpm));
    textRef.current = String(bpm);
    setTouched(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flushRef.current(), 800);
  };

  const query = track ? trackQuery(track) : undefined;
  const fetchBpm = async (): Promise<void> => {
    if (!query || !track) return;
    const forId = `${track.provider}:${track.id}`;
    const typedBefore = textRef.current;
    setLookupFor(forId);
    setLookup({ status: 'loading' });
    try {
      const hit = await bpmLookup.lookup(query);
      if (!alive.current) return;
      const now = trackRef.current;
      if (!now || `${now.provider}:${now.id}` !== forId) return;
      // The rider typed or tapped a value while we waited: theirs wins.
      if (textRef.current !== typedBefore) {
        setLookup({ status: 'idle' });
        return;
      }
      if (!hit) {
        setLookup({ status: 'notFound' });
        return;
      }
      clearTimeout(timer.current);
      committed.current = hit.bpm;
      setText(String(hit.bpm));
      textRef.current = String(hit.bpm);
      setTouched(false);
      setLookup({ status: 'idle' });
      onChangeRef.current(hit.bpm, hit.source);
    } catch (err) {
      if (!alive.current) return;
      setLookup({ status: 'error', ...errorInfo(err) });
    }
  };

  const match = value !== undefined && rpm !== undefined ? matchBpm(value, rpm) : undefined;
  const targets = rpm === undefined ? [] : targetBpms(rpm);
  const exact = targets.find((x) => x.kind === 'exact')?.bpm;
  const half = targets.find((x) => x.kind === 'half')?.bpm;
  const genres = rpm === undefined ? [] : genresForRpm(rpm);
  const hint =
    exact !== undefined && half !== undefined
      ? t('editor.bpm.target', { rpm: String(rpm), bpm: String(exact), half: String(half) })
      : exact !== undefined
        ? t('editor.bpm.targetNoHalf', { rpm: String(rpm), bpm: String(exact) })
        : half !== undefined
          ? t('editor.bpm.targetHalfOnly', { rpm: String(rpm), bpm: String(half) })
          : undefined;

  const findSongs = async (): Promise<void> => {
    if (!client) return;
    setSuggestFor(rpm);
    setSuggest({ status: 'loading' });
    try {
      const groups: { kind: MatchKind; bpm: number; hits: BpmHit[] }[] = [];
      for (const target of targets) {
        const hits = await client.findByBpm(target.bpm, 10);
        groups.push({ ...target, hits: hits.slice(0, SUGGESTIONS_PER_GROUP) });
      }
      if (alive.current) setSuggest({ status: 'done', groups });
    } catch (err) {
      if (alive.current) {
        setSuggest({ status: 'error', ...errorInfo(err) });
      }
    }
  };

  const attribution = (source: BpmSource) => (
    <small className={styles.caption} data-testid={`bpm-attribution-${source}`}>
      {t('editor.bpm.dataFrom')}{' '}
      <a
        href={SITE[source]}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${BRAND[source]} (${t('editor.bpm.newTab')})`}
      >
        {BRAND[source]}
      </a>
    </small>
  );

  return (
    <div className={styles.group} data-testid="bpm-field">
      {hint && (
        <small className={styles.caption} data-testid="bpm-target">
          {hint}
          {genres.length > 0 &&
            ` ${t('editor.bpm.genres', { list: genres.map((g) => t(`bpm.genre.${g.id}`)).join(', ') })}`}
        </small>
      )}
      {track && (
        <div className={styles.row}>
          <label className={styles.inline} htmlFor={bpmId}>
            <span>{t('editor.bpm.label')}</span>
            <input
              id={bpmId}
              data-testid="track-bpm"
              inputMode="numeric"
              value={text}
              aria-invalid={touched && invalid ? true : undefined}
              onChange={(e) => {
                setText(e.target.value);
                textRef.current = e.target.value;
                setTouched(false);
              }}
              onBlur={() => {
                setTouched(true);
                flush();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setTouched(true);
                  flush();
                }
              }}
            />
          </label>
          <Button onClick={tap}>{t('editor.bpm.tap')}</Button>
          {query && (
            <Button
              onClick={() => void fetchBpm()}
              disabled={lookup.status === 'loading'}
              data-testid="bpm-fetch"
            >
              {lookup.status === 'loading' ? t('editor.bpm.fetching') : t('editor.bpm.fetch')}
            </Button>
          )}
        </div>
      )}
      {track && touched && invalid && (
        <small role="alert" className={styles.error}>
          {t('editor.bpm.error', { min: String(BPM_MIN), max: String(BPM_MAX) })}
        </small>
      )}
      {track && lookup.status === 'error' && (
        <small role="alert" className={styles.error} data-testid="bpm-fetch-error">
          {errorText(t, lookup)}
        </small>
      )}
      {track && track.bpmSource !== undefined && track.bpm !== undefined && (
        <small className={styles.caption} data-testid="bpm-source">
          {t('editor.bpm.source', { source: BRAND[track.bpmSource] })}
        </small>
      )}
      {track && match && (
        <small className={styles.caption} data-testid="bpm-match" data-fit={match.fit}>
          {t(`editor.bpm.match.${match.kind}`)}
          {match.fit === 'close' ? ` · ${t('editor.bpm.close')}` : ''}
        </small>
      )}
      {track && value !== undefined && rpm !== undefined && !match && (
        <small className={styles.caption} data-testid="bpm-nomatch">
          {t('editor.bpm.noMatch')}
        </small>
      )}

      {client && targets.length > 0 && (
        <div className={styles.row}>
          <Button
            onClick={() => void findSongs()}
            disabled={suggest.status === 'loading'}
            data-testid="bpm-suggest"
          >
            {suggest.status === 'loading' ? t('editor.bpm.suggesting') : t('editor.bpm.suggest')}
          </Button>
        </div>
      )}
      {suggest.status === 'error' && (
        <small role="alert" className={styles.error} data-testid="bpm-suggest-error">
          {errorText(t, suggest)}
        </small>
      )}
      <div aria-live="polite" data-testid="bpm-status">
        {(lookup.status === 'loading' || suggest.status === 'loading') && (
          <small className={styles.caption}>
            {lookup.status === 'loading' ? t('editor.bpm.fetching') : t('editor.bpm.suggesting')}
          </small>
        )}
        {track && lookup.status === 'notFound' && (
          <small className={styles.caption} data-testid="bpm-fetch-notfound">
            {t('editor.bpm.notFound')}
          </small>
        )}
        {suggest.status === 'done' && (
          <div data-testid="bpm-suggestions">
            {suggest.groups.every((g) => g.hits.length === 0) && (
              <small className={styles.caption}>{t('editor.bpm.suggestNone')}</small>
            )}
            {suggest.groups
              .filter((g) => g.hits.length > 0)
              .map((g) => (
                <div key={g.kind}>
                  <small className={styles.groupLabel}>
                    {t('editor.bpm.suggestGroup', {
                      bpm: String(g.bpm),
                      kind: t(`editor.bpm.kind.${g.kind}`),
                    })}
                  </small>
                  <ul className={styles.suggestList}>
                    {g.hits.map((h) => (
                      <li key={h.url}>
                        <a
                          href={h.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`${h.title} (${t('editor.bpm.newTab')})`}
                        >
                          {h.title}
                        </a>
                        {`${h.artist ? ` – ${h.artist}` : ''} · ${h.bpm} BPM`}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </div>
        )}
      </div>

      {!client && rpm !== undefined && (
        <small className={styles.caption} data-testid="bpm-needs-key">
          {t('editor.bpm.needKey')} <Link to="/settings">{t('editor.bpm.needKeyLink')}</Link>
        </small>
      )}
      {track?.bpmSource !== undefined && attribution(track.bpmSource)}
      {client &&
        suggest.status === 'done' &&
        track?.bpmSource !== 'getsongbpm' &&
        attribution('getsongbpm')}
    </div>
  );
}
