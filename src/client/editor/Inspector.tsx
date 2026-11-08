import { useEffect, useId, useRef, useState, type Dispatch } from 'react';
import { effortRow, effortToFtpPct, type EffortLevel, type EffortTable } from '../../domain/effort';
import type { Block, Intensity, Position, TrackRef, Workout } from '../../domain/workout';
import { parseClock, parseTrackUrl } from '../music/parse-track-url';
import { useT } from '../i18n';
import { lookupSpotifyTrack } from '../music/spotify/track-info';
import { applyYoutubeCheck, checkYoutubeEmbeddable } from '../music/youtube-check';
import { Button } from '../ui/Button';
import { Segmented } from '../ui/Segmented';
import { BpmField } from './BpmField';
import { SpotifySearch } from './SpotifySearch';
import { SuggestedChips } from './SuggestedChips';
import { toTrackRef } from '../music/library/library';
import { formatClock } from '../training/format';
import type { EditorAction } from './editor-state';
import { findBlock, intensityEffort, rpmOutsideUsual, type Leaf } from './model';
import styles from './Inspector.module.css';

const LEVELS: EffortLevel[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export interface InspectorProps {
  workout: Workout;
  selectedId: string | undefined;
  readOnly: boolean;
  table: EffortTable;
  dispatch: Dispatch<EditorAction>;
  /** True when a music pill was clicked: move focus to the track field, then call onTrackFocused. */
  focusTrack: boolean;
  onTrackFocused: () => void;
}

/** Text field that applies its value on blur or Enter, with live validation messages. */
function CommitField({
  label,
  value,
  onCommit,
  validate,
  warn,
  suffix,
  inputMode,
  testId,
}: {
  label: string;
  value: string;
  onCommit: (text: string) => void;
  validate?: (text: string) => string | undefined;
  warn?: (text: string) => string | undefined;
  suffix?: string;
  inputMode?: 'numeric' | 'text';
  testId?: string;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }
  const error = draft === value ? undefined : validate?.(draft);
  const warning = error ? undefined : warn?.(draft);
  const commit = (): void => {
    if (draft === value) return;
    if (validate?.(draft)) return;
    onCommit(draft);
  };
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <div className={styles.inputWrap}>
        <input
          id={id}
          data-testid={testId}
          value={draft}
          inputMode={inputMode}
          aria-invalid={error ? true : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setDraft(value);
          }}
        />
        {suffix && <span className={styles.suffix}>{suffix}</span>}
      </div>
      {error && (
        <small role="alert" className={styles.error}>
          {error}
        </small>
      )}
      {warning && (
        <small data-testid="field-warning" className={styles.warn}>
          {warning}
        </small>
      )}
    </div>
  );
}

function EffortPicker({
  label,
  intensity,
  table,
  onPick,
  onExact,
}: {
  label: string;
  intensity: Intensity;
  table: EffortTable;
  onPick: (level: EffortLevel) => void;
  onExact: (pct: number | undefined) => void;
}) {
  const t = useT();
  const level = intensityEffort(intensity, table);
  const row = effortRow(level, table);
  const pct = intensity.ftpPct ?? effortToFtpPct(level, table);
  return (
    <div className={styles.group}>
      <span className={styles.groupLabel}>{label}</span>
      <div role="group" aria-label={label} className={styles.levels}>
        {LEVELS.map((l) => {
          const r = effortRow(l, table);
          const on = l === level;
          return (
            <button
              key={l}
              type="button"
              aria-pressed={on}
              data-level={l}
              className={`${styles.level} ${on ? styles.levelOn : ''}`}
              style={{ ['--c' as string]: r.color }}
              onClick={() => onPick(l)}
            >
              {l}
            </button>
          );
        })}
      </div>
      <div className={styles.ftpRow}>
        <small className={styles.caption} data-testid="effort-caption">
          {t('editor.inspector.approxFtp', {
            label: t(`effort.${row.labelKey}`),
            pct,
          })}
        </small>
        <CommitField
          label={t('editor.inspector.exactFtp')}
          value={intensity.ftpPct === undefined ? '' : String(intensity.ftpPct)}
          inputMode="numeric"
          suffix="%"
          testId="exact-ftp"
          validate={(s) => {
            if (s.trim() === '') return undefined;
            const n = Number(s);
            return Number.isFinite(n) && n >= 20 && n <= 200
              ? undefined
              : t('editor.inspector.exactFtpError');
          }}
          onCommit={(s) => onExact(s.trim() === '' ? undefined : Number(s))}
        />
      </div>
    </div>
  );
}

function withExact(i: Intensity, table: EffortTable, ftpPct: number | undefined): Intensity {
  const effort = intensityEffort(i, table);
  return ftpPct === undefined ? { effort } : { effort, ftpPct };
}

export function Inspector({
  workout,
  selectedId,
  readOnly,
  table,
  dispatch,
  focusTrack,
  onTrackFocused,
}: InspectorProps) {
  const t = useT();
  // Unpinned track fields survive switching between blocks.
  const [drafts, setDrafts] = useState<Record<string, TrackDraft>>({});
  const setDraft = (blockId: string, d: TrackDraft | undefined): void =>
    setDrafts((prev) => {
      const { [blockId]: _old, ...rest } = prev;
      void _old;
      return d ? { ...rest, [blockId]: d } : rest;
    });
  const block = findBlock(workout, selectedId);
  const playlist = <FallbackPlaylist workout={workout} dispatch={dispatch} readOnly={readOnly} />;
  if (!block) {
    return (
      <aside className={styles.panel} data-testid="inspector">
        <p className={styles.empty}>{t('editor.inspector.empty')}</p>
        {playlist}
      </aside>
    );
  }
  const order = workout.blocks.flatMap((b) => (b.kind === 'repeat' ? [b, ...b.blocks] : [b]));
  const n = order.findIndex((b) => b.id === block.id) + 1;
  const title = `${t('editor.block', { n })} · ${t(`editor.blockKind.${block.kind}`)}`;

  return (
    <aside className={styles.panel} data-testid="inspector">
      <fieldset disabled={readOnly} className={styles.set}>
        <h2 className={styles.title}>{title}</h2>
        {block.kind === 'repeat' ? (
          <RepeatInspector repeat={block} workout={workout} dispatch={dispatch} />
        ) : (
          <LeafInspector
            leaf={block}
            workout={workout}
            table={table}
            dispatch={dispatch}
            focusTrack={focusTrack}
            onTrackFocused={onTrackFocused}
            draft={drafts[block.id]}
            onDraft={(d) => setDraft(block.id, d)}
          />
        )}
      </fieldset>
      {playlist}
    </aside>
  );
}

function RepeatInspector({
  repeat,
  workout,
  dispatch,
}: {
  repeat: Extract<Block, { kind: 'repeat' }>;
  workout: Workout;
  dispatch: Dispatch<EditorAction>;
}) {
  const t = useT();
  const hint = workout.musicHints?.[repeat.id];
  return (
    <>
      <CommitField
        label={t('editor.inspector.times')}
        value={String(repeat.times)}
        inputMode="numeric"
        testId="repeat-times"
        validate={(s) => {
          const v = Number(s);
          return Number.isInteger(v) && v >= 2 && v <= 50
            ? undefined
            : t('editor.inspector.timesError');
        }}
        onCommit={(s) =>
          dispatch({ type: 'updateBlock', id: repeat.id, patch: { times: Number(s) } })
        }
      />
      <div className={styles.group}>
        <span className={styles.groupLabel}>{t('editor.inspector.children')}</span>
        <div className={styles.children}>
          {repeat.blocks.map((c, i) => (
            <div key={c.id} className={styles.child}>
              <button
                type="button"
                className={styles.childBtn}
                onClick={() => dispatch({ type: 'select', id: c.id })}
              >
                {i + 1}. {t(`editor.blockKind.${c.kind}`)} · {formatClock(c.durationSec)}
              </button>
              <button
                type="button"
                className={styles.childRm}
                aria-label={`${t('editor.inspector.removeChild')} ${i + 1}`}
                disabled={repeat.blocks.length <= 1}
                onClick={() =>
                  dispatch({ type: 'removeChild', repeatId: repeat.id, childId: c.id })
                }
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div className={styles.row}>
          <Button
            onClick={() =>
              dispatch({ type: 'addRepeatChild', repeatId: repeat.id, kind: 'steady' })
            }
          >
            {t('editor.inspector.addChild')}
          </Button>
          <Button
            onClick={() => dispatch({ type: 'addRepeatChild', repeatId: repeat.id, kind: 'ramp' })}
          >
            {t('editor.inspector.addChildRamp')}
          </Button>
        </div>
      </div>
      {hint && <MusicHint text={hint} />}
    </>
  );
}

function MusicHint({ text }: { text: string }) {
  const t = useT();
  return (
    <div className={styles.group} data-testid="music-hint">
      <span className={styles.groupLabel}>{t('editor.inspector.musicHint')}</span>
      <p className={styles.hint}>{text}</p>
    </div>
  );
}

function LeafInspector({
  leaf,
  workout,
  table,
  dispatch,
  focusTrack,
  onTrackFocused,
  draft,
  onDraft,
}: {
  leaf: Leaf;
  workout: Workout;
  table: EffortTable;
  dispatch: Dispatch<EditorAction>;
  focusTrack: boolean;
  onTrackFocused: () => void;
  draft: TrackDraft | undefined;
  onDraft: (d: TrackDraft | undefined) => void;
}) {
  const t = useT();
  const id = leaf.id;
  const workoutRef = useRef(workout);
  useEffect(() => {
    workoutRef.current = workout;
  });
  const patch = (p: Record<string, unknown>): void =>
    dispatch({ type: 'updateBlock', id, patch: p });
  const cue = workout.musicCues.find((c) => c.blockId === id && c.rep === 1);
  const hint = workout.musicHints?.[id];

  return (
    <>
      <div className={styles.group}>
        <span className={styles.groupLabel}>{t('editor.inspector.position')}</span>
        <Segmented<Position | ''>
          label={t('editor.inspector.position')}
          value={leaf.position ?? ''}
          options={[
            { value: 'seated', label: t('editor.inspector.seated') },
            { value: 'standing', label: t('editor.inspector.standing') },
          ]}
          onChange={(v) => patch({ position: v === '' ? undefined : v })}
        />
      </div>

      {leaf.kind === 'steady' ? (
        <EffortPicker
          label={t('editor.inspector.effort')}
          intensity={leaf.intensity}
          table={table}
          onPick={(effort) => dispatch({ type: 'setIntensity', id, effort })}
          onExact={(pct) => patch({ intensity: withExact(leaf.intensity, table, pct) })}
        />
      ) : (
        <>
          <EffortPicker
            label={t('editor.inspector.effortFrom')}
            intensity={leaf.from}
            table={table}
            onPick={(effort) => dispatch({ type: 'setIntensity', id, effort, which: 'from' })}
            onExact={(pct) => patch({ from: withExact(leaf.from, table, pct) })}
          />
          <EffortPicker
            label={t('editor.inspector.effortTo')}
            intensity={leaf.to}
            table={table}
            onPick={(effort) => dispatch({ type: 'setIntensity', id, effort, which: 'to' })}
            onExact={(pct) => patch({ to: withExact(leaf.to, table, pct) })}
          />
        </>
      )}

      <div className={styles.two}>
        <CommitField
          label={t('editor.inspector.time')}
          value={formatClock(leaf.durationSec)}
          testId="block-time"
          validate={(s) => {
            const sec = parseClock(s);
            return sec !== undefined && sec >= 5 ? undefined : t('editor.inspector.timeError');
          }}
          onCommit={(s) => patch({ durationSec: parseClock(s) })}
        />
        <CommitField
          label={t('editor.inspector.rpm')}
          value={leaf.rpm === undefined ? '' : String(leaf.rpm)}
          inputMode="numeric"
          suffix={t('editor.inspector.rpmUnit')}
          testId="block-rpm"
          validate={(s) => {
            if (s.trim() === '') return undefined;
            const v = Number(s);
            return Number.isFinite(v) && v >= 30 && v <= 150
              ? undefined
              : t('editor.inspector.rpmError');
          }}
          warn={(s) =>
            s.trim() !== '' && rpmOutsideUsual(Number(s))
              ? t('editor.inspector.rpmWarning')
              : undefined
          }
          onCommit={(s) => patch({ rpm: s.trim() === '' ? undefined : Number(s) })}
        />
      </div>

      {leaf.kind === 'ramp' && (
        <CommitField
          label={t('editor.inspector.steps')}
          value={leaf.steps === undefined || leaf.steps === 0 ? '' : String(leaf.steps)}
          inputMode="numeric"
          testId="block-steps"
          validate={(s) => {
            if (s.trim() === '') return undefined;
            const v = Number(s);
            return Number.isInteger(v) && v >= 0 && v <= 8
              ? undefined
              : t('editor.inspector.stepsError');
          }}
          onCommit={(s) =>
            patch({ steps: s.trim() === '' || Number(s) === 0 ? undefined : Number(s) })
          }
        />
      )}

      <CommitField
        label={t('editor.inspector.cue')}
        value={leaf.cue ?? ''}
        testId="block-cue"
        onCommit={(s) => patch({ cue: s.trim() === '' ? undefined : s })}
      />

      <TrackField
        key={`${id}:${cue ? `${cue.track.provider}:${cue.track.id}:${cue.track.startAtSec}` : ''}`}
        blockId={id}
        cue={cue?.track}
        rpm={leaf.rpm}
        getCue={() =>
          workoutRef.current.musicCues.find((c) => c.blockId === id && c.rep === 1)?.track
        }
        dispatch={dispatch}
        focusRequested={focusTrack}
        onFocused={onTrackFocused}
        draft={draft}
        onDraft={onDraft}
      />

      {hint && <MusicHint text={hint} />}
    </>
  );
}

export interface TrackDraft {
  url: string;
  start: string;
}

function trackUrl(track: { provider: 'spotify' | 'youtube'; id: string }): string {
  return track.provider === 'spotify'
    ? `spotify:track:${track.id}`
    : `https://youtu.be/${track.id}`;
}

function TrackField({
  blockId,
  cue,
  rpm,
  getCue,
  dispatch,
  focusRequested,
  onFocused,
  draft,
  onDraft,
}: {
  blockId: string;
  cue: Workout['musicCues'][number]['track'] | undefined;
  /** Cadence of the block this track is pinned to (for the BPM hint). */
  rpm: number | undefined;
  /** The cue as it is now (after any later edits); used when an async check finishes. */
  getCue: () => TrackRef | undefined;
  dispatch: Dispatch<EditorAction>;
  focusRequested: boolean;
  onFocused: () => void;
  draft: TrackDraft | undefined;
  onDraft: (d: TrackDraft | undefined) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!focusRequested) return;
    input.current?.focus();
    onFocused();
  }, [focusRequested, onFocused]);
  const t = useT();
  const urlId = useId();
  const url = draft?.url ?? (cue ? trackUrl(cue) : '');
  const start = draft?.start ?? formatClock(cue?.startAtSec ?? 0);
  const [touched, setTouched] = useState(false);
  const parsed = parseTrackUrl(url);
  const startSec = parseClock(start);
  const urlError = touched && url.trim() !== '' && !parsed;
  const startError = start.trim() !== '' && startSec === undefined;
  const providerName = (p: 'spotify' | 'youtube'): string =>
    p === 'spotify' ? 'Spotify' : 'YouTube';

  const onUrl = (value: string): void => {
    const next = parseTrackUrl(value);
    // A link that carries a start time (YouTube ?t=) fills the start field while it is untouched.
    const fill =
      next?.startAtSec !== undefined && (parseClock(start) ?? 0) === 0
        ? formatClock(next.startAtSec)
        : start;
    onDraft({ url: value, start: fill });
  };

  const place = (track: TrackRef): void => {
    dispatch({ type: 'setCue', blockId, rep: 1, track });
    onDraft(undefined);
    if (track.provider === 'spotify') {
      // A pasted link carries no name: look it up, and fill it in only while the cue is still
      // this track and still untitled (the user may have changed it meanwhile).
      if (track.title) return;
      void lookupSpotifyTrack(track.id).then((info) => {
        if (!info) return;
        const now = getCue();
        if (!now || now.provider !== 'spotify' || now.id !== track.id || now.title) return;
        dispatch({
          type: 'setCue',
          blockId,
          rep: 1,
          track: { ...now, title: info.title, ...(info.artist ? { artist: info.artist } : {}) },
        });
      });
      return;
    }
    if (track.provider !== 'youtube') return;
    // Ask YouTube whether the video can be embedded, and fill in its title. The pin stays either
    // way (the IFrame player reports the truth at playback); a blocked video only gets a mark.
    void checkYoutubeEmbeddable(track.id).then((check) => {
      // Pinning remounts this field, so the current cue is read from the workout, not from here.
      const now = getCue();
      if (!now || now.provider !== 'youtube' || now.id !== track.id) return;
      const checked = applyYoutubeCheck(now, check);
      if (checked !== now) dispatch({ type: 'setCue', blockId, rep: 1, track: checked });
    });
  };

  const pin = (): void => {
    setTouched(true);
    if (!parsed || startSec === undefined) return;
    const same = cue?.provider === parsed.provider && cue.id === parsed.id;
    place({
      provider: parsed.provider,
      id: parsed.id,
      // The title belongs to the track: a different id starts without one.
      title: same ? cue.title : '',
      ...(same && cue.artist ? { artist: cue.artist } : {}),
      ...(same && cue.notEmbeddable ? { notEmbeddable: true } : {}),
      ...(same && cue.bpm !== undefined ? { bpm: cue.bpm } : {}),
      ...(same && cue.bpmSource ? { bpmSource: cue.bpmSource } : {}),
      startAtSec: startSec,
    });
  };

  return (
    <div className={styles.group} data-testid="track-field">
      <label className={styles.groupLabel} htmlFor={urlId}>
        {t('editor.inspector.track')}
      </label>
      {cue && (
        <small className={styles.caption} data-testid="track-pinned">
          {cue.title ? `${cue.title} · ` : ''}
          {t('editor.inspector.pinned', {
            provider: providerName(cue.provider),
            time: formatClock(cue.startAtSec),
          })}
        </small>
      )}
      {cue?.notEmbeddable && (
        <small role="alert" className={styles.error} data-testid="track-not-embeddable">
          {t('music.notEmbeddable')}
        </small>
      )}
      <input
        id={urlId}
        ref={input}
        data-testid="track-url"
        className={styles.wide}
        placeholder={t('editor.inspector.trackUrl')}
        value={url}
        aria-invalid={urlError ? true : undefined}
        onChange={(e) => onUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') pin();
        }}
      />
      {urlError && (
        <small role="alert" className={styles.error}>
          {t('editor.inspector.trackError')}
        </small>
      )}
      <div className={styles.row}>
        <label className={styles.inline}>
          <span>{t('editor.inspector.trackStart')}</span>
          <input
            data-testid="track-start"
            value={start}
            aria-invalid={startError ? true : undefined}
            onChange={(e) => onDraft({ url, start: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') pin();
            }}
          />
        </label>
      </div>
      {startError && (
        <small role="alert" className={styles.error}>
          {t('editor.inspector.trackStartError')}
        </small>
      )}
      <div className={styles.row}>
        <Button onClick={pin}>{t('editor.inspector.trackAdd')}</Button>
        {cue && (
          <Button
            onClick={() => {
              dispatch({ type: 'clearCue', blockId, rep: 1 });
              onDraft(undefined);
            }}
          >
            {t('editor.inspector.trackClear')}
          </Button>
        )}
      </div>
      <BpmField
        rpm={rpm}
        track={cue}
        onChange={(bpm, source) => {
          const now = getCue();
          if (!now) return;
          // A typed, tapped or cleared value drops the lookup source; a looked-up one sets it.
          const { bpm: _bpm, bpmSource: _source, ...rest } = now;
          void _bpm;
          void _source;
          dispatch({
            type: 'setCue',
            blockId,
            rep: 1,
            track:
              bpm === undefined ? rest : { ...rest, bpm, ...(source ? { bpmSource: source } : {}) },
          });
        }}
      />
      <SuggestedChips rpm={rpm} onPick={(lt) => place(toTrackRef(lt, startSec ?? 0))} />
      <SpotifySearch
        onPick={(track) => {
          place({ ...track, startAtSec: startSec ?? 0 });
        }}
      />
    </div>
  );
}

function FallbackPlaylist({
  workout,
  dispatch,
  readOnly,
}: {
  workout: Workout;
  dispatch: Dispatch<EditorAction>;
  readOnly: boolean;
}) {
  const t = useT();
  const urlId = useId();
  const [url, setUrl] = useState('');
  const [touched, setTouched] = useState(false);
  const list = workout.fallbackPlaylist;
  const listRef = useRef(list);
  useEffect(() => {
    listRef.current = list;
  });
  const parsed = parseTrackUrl(url);
  const set = (fallbackPlaylist: Workout['fallbackPlaylist']): void =>
    dispatch({ type: 'updateMeta', patch: { fallbackPlaylist } });
  const add = (): void => {
    setTouched(true);
    if (!parsed) return;
    const added: TrackRef = {
      provider: parsed.provider,
      id: parsed.id,
      title: '',
      startAtSec: parsed.startAtSec ?? 0,
    };
    set([...list, added]);
    setUrl('');
    setTouched(false);
    if (parsed.provider === 'spotify') {
      void lookupSpotifyTrack(parsed.id).then((info) => {
        if (!info) return;
        // The list may have changed meanwhile: patch the first matching entry that is still bare.
        const latest = listRef.current;
        const at = latest.findIndex(
          (x) => x.provider === 'spotify' && x.id === added.id && !x.title,
        );
        const found = latest[at];
        if (!found) return;
        const named: TrackRef = {
          ...found,
          title: info.title,
          ...(info.artist ? { artist: info.artist } : {}),
        };
        set(latest.map((x, i) => (i === at ? named : x)));
      });
      return;
    }
    if (parsed.provider !== 'youtube') return;
    void checkYoutubeEmbeddable(parsed.id).then((check) => {
      // The list may have changed meanwhile: patch the first matching entry that is still bare.
      const latest = listRef.current;
      const at = latest.findIndex((x) => x.provider === 'youtube' && x.id === added.id && !x.title);
      const found = latest[at];
      if (!found) return;
      const checked = applyYoutubeCheck(found, check);
      if (checked !== found) set(latest.map((x, i) => (i === at ? checked : x)));
    });
  };
  const move = (i: number, to: number): void => {
    const next = [...list];
    const [item] = next.splice(i, 1);
    if (!item) return;
    next.splice(to, 0, item);
    set(next);
  };
  return (
    <section className={styles.playlist} data-testid="fallback-playlist">
      <fieldset disabled={readOnly} className={styles.set}>
        <h3 className={styles.subtitle}>{t('editor.fallback.title')}</h3>
        <small className={styles.caption}>{t('editor.fallback.hint')}</small>
        {list.length === 0 ? (
          <small className={styles.caption}>{t('editor.fallback.empty')}</small>
        ) : (
          <ol className={styles.tracks}>
            {list.map((tr, i) => (
              <li key={`${tr.provider}:${tr.id}:${i}`} data-testid="fallback-track">
                <span className={styles.trackName}>
                  {tr.title || `${tr.provider === 'spotify' ? 'Spotify' : 'YouTube'} · ${tr.id}`}
                  {tr.notEmbeddable && (
                    <em className={styles.badge}> ⚠ {t('music.notEmbeddableBadge')}</em>
                  )}
                </span>
                <button
                  type="button"
                  aria-label={`${t('editor.fallback.up')} ${i + 1}`}
                  disabled={i === 0}
                  onClick={() => move(i, i - 1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`${t('editor.fallback.down')} ${i + 1}`}
                  disabled={i === list.length - 1}
                  onClick={() => move(i, i + 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label={`${t('editor.fallback.remove')} ${i + 1}`}
                  onClick={() => set(list.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </li>
            ))}
          </ol>
        )}
        <label className={styles.groupLabel} htmlFor={urlId}>
          {t('editor.fallback.track')}
        </label>
        <input
          id={urlId}
          data-testid="fallback-url"
          className={styles.wide}
          placeholder={t('editor.fallback.url')}
          value={url}
          aria-invalid={touched && !parsed ? true : undefined}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
          }}
        />
        {touched && !parsed && (
          <small role="alert" className={styles.error}>
            {t('editor.fallback.error')}
          </small>
        )}
        <div className={styles.row}>
          <Button onClick={add}>{t('editor.fallback.add')}</Button>
        </div>
      </fieldset>
    </section>
  );
}
