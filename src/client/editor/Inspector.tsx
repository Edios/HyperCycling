import { useEffect, useId, useRef, useState, type Dispatch } from 'react';
import { effortRow, effortToFtpPct, type EffortLevel, type EffortTable } from '../../domain/effort';
import type { Block, Intensity, Position, Workout } from '../../domain/workout';
import { parseClock, parseTrackUrl } from '../music/parse-track-url';
import { useT } from '../i18n';
import { Button } from '../ui/Button';
import { Segmented } from '../ui/Segmented';
import { formatClock } from '../training/format';
import type { EditorAction } from './editor-state';
import { findBlock, intensityEffort, parentRepeat, rpmOutsideUsual, type Leaf } from './model';
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
            e.stopPropagation();
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
  const block = findBlock(workout, selectedId);
  if (!block) {
    return (
      <aside className={styles.panel} data-testid="inspector">
        <p className={styles.empty}>{t('editor.inspector.empty')}</p>
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
          />
        )}
      </fieldset>
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
}: {
  leaf: Leaf;
  workout: Workout;
  table: EffortTable;
  dispatch: Dispatch<EditorAction>;
  focusTrack: boolean;
  onTrackFocused: () => void;
}) {
  const t = useT();
  const id = leaf.id;
  const patch = (p: Record<string, unknown>): void =>
    dispatch({ type: 'updateBlock', id, patch: p });
  const parent = parentRepeat(workout, id);
  const cue = workout.musicCues.find((c) => c.blockId === id && c.rep === 1);
  const hint = workout.musicHints?.[id];

  return (
    <>
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
        dispatch={dispatch}
        focusRequested={focusTrack}
        onFocused={onTrackFocused}
      />

      {hint && <MusicHint text={hint} />}
      {parent && <p className={styles.note}>{t('editor.repeatLabel', { n: parent.times })}</p>}
    </>
  );
}

function TrackField({
  blockId,
  cue,
  dispatch,
  focusRequested,
  onFocused,
}: {
  blockId: string;
  cue: Workout['musicCues'][number]['track'] | undefined;
  dispatch: Dispatch<EditorAction>;
  focusRequested: boolean;
  onFocused: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!focusRequested) return;
    input.current?.focus();
    onFocused();
  }, [focusRequested, onFocused]);
  const t = useT();
  const urlId = useId();
  const [url, setUrl] = useState(
    cue
      ? cue.provider === 'spotify'
        ? `spotify:track:${cue.id}`
        : `https://youtu.be/${cue.id}`
      : '',
  );
  const [start, setStart] = useState(formatClock(cue?.startAtSec ?? 0));
  const [touched, setTouched] = useState(false);
  const parsed = parseTrackUrl(url);
  const startSec = parseClock(start);
  const urlError = touched && url.trim() !== '' && !parsed;
  const startError = start.trim() !== '' && startSec === undefined;
  const providerName = (p: 'spotify' | 'youtube'): string =>
    p === 'spotify' ? 'Spotify' : 'YouTube';

  const pin = (): void => {
    setTouched(true);
    if (!parsed || startSec === undefined) return;
    dispatch({
      type: 'setCue',
      blockId,
      rep: 1,
      track: {
        provider: parsed.provider,
        id: parsed.id,
        title: cue?.title ?? t('editor.inspector.track'),
        startAtSec: startSec,
      },
    });
  };

  return (
    <div className={styles.group} data-testid="track-field">
      <label className={styles.groupLabel} htmlFor={urlId}>
        {t('editor.inspector.track')}
      </label>
      {cue && (
        <small className={styles.caption} data-testid="track-pinned">
          {t('editor.inspector.pinned', {
            provider: providerName(cue.provider),
            time: formatClock(cue.startAtSec),
          })}
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
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') pin();
          e.stopPropagation();
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
            onChange={(e) => setStart(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') pin();
              e.stopPropagation();
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
          <Button onClick={() => dispatch({ type: 'clearCue', blockId, rep: 1 })}>
            {t('editor.inspector.trackClear')}
          </Button>
        )}
      </div>
    </div>
  );
}
