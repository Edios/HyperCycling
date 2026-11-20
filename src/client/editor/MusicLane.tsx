import { useEffect, useMemo, useRef, useState, type Dispatch, type PointerEvent } from 'react';
import type { EffortTable } from '../../domain/effort';
import {
  MIN_TRACK_PLAY_SEC,
  trackPlaySec,
  trimTrack,
  type TrackRef,
  type Workout,
} from '../../domain/workout';
import { useT } from '../i18n';
import { formatClock } from '../training/format';
import type { EditorAction } from './editor-state';
import {
  axisBox,
  musicLaneLayout,
  secPerPx,
  type LanePill,
  type TrackOverride,
} from './music-lane-layout';
import styles from './MusicLane.module.css';

export interface MusicLaneProps {
  workout: Workout;
  selectedId: string | undefined;
  table: EffortTable;
  readOnly: boolean;
  /** A pill or the "pin" placeholder was clicked: select the block and open its track field. */
  onPick: (blockId: string) => void;
  /** The free time after a track was clicked: select its block and open "next track". */
  onAddNext: (blockId: string) => void;
  dispatch: Dispatch<EditorAction>;
}

interface Drag {
  pill: LanePill;
  edge: 'start' | 'end';
  /** Seconds moved so far (on the workout clock). */
  deltaSec: number;
}

/** The trim a drag gives: new start/end inside the recording, clamped to something playable. */
function dragTrim(d: Drag): { startAtSec: number; endAtSec: number | null } {
  const { pill, edge } = d;
  const tr = pill.track;
  const shownLen = pill.endSec - pill.startSec;
  // End of what is on screen, inside the recording (an estimate for an unknown length).
  const shownEnd = tr.startAtSec + shownLen;
  const dur = tr.durationSec;
  if (edge === 'start') {
    const end = trackPlaySec(tr) !== undefined ? tr.startAtSec + (trackPlaySec(tr) ?? 0) : shownEnd;
    const start = Math.min(Math.max(0, tr.startAtSec + d.deltaSec), end - MIN_TRACK_PLAY_SEC);
    return { startAtSec: Math.round(start), endAtSec: tr.endAtSec ?? null };
  }
  // Past the next track (or the end of the workout) nothing more would play: that is the limit.
  const maxEnd = Math.min(dur ?? Infinity, tr.startAtSec + (pill.limitSec - pill.startSec));
  const end = Math.min(Math.max(shownEnd + d.deltaSec, tr.startAtSec + MIN_TRACK_PLAY_SEC), maxEnd);
  const rounded = Math.round(end);
  return {
    startAtSec: tr.startAtSec,
    endAtSec: dur !== undefined && rounded >= dur ? null : rounded,
  };
}

function overrideOf(d: Drag | undefined): TrackOverride | undefined {
  if (!d || d.edge === 'start') return undefined;
  const trim = dragTrim(d);
  const track = trimTrack(d.pill.track, trim.startAtSec, trim.endAtSec);
  return track
    ? { blockId: d.pill.blockId, rep: d.pill.rep, index: d.pill.index, track }
    : undefined;
}

function pillLabel(
  t: ReturnType<typeof useT>,
  track: TrackRef,
  lenSec: number,
  estimated: boolean,
): string {
  const provider = track.provider === 'spotify' ? 'Spotify' : 'YouTube';
  const len = estimated ? `~${formatClock(lenSec)}` : formatClock(lenSec);
  return `${track.notEmbeddable ? '⚠' : '♫'} ${track.title ? `${track.title} · ` : ''}${provider} · ${t('editor.pillFrom', { time: formatClock(track.startAtSec) })} · ${len}`;
}

/**
 * Row of pinned tracks above the timeline, on the timeline's own time scale. Each track is as long
 * as it plays (start to its end or trimmed end), so free time shows; the selected block's tracks
 * get drag handles to trim their start and end.
 */
export function MusicLane({
  workout,
  selectedId,
  table,
  readOnly,
  onPick,
  onAddNext,
  dispatch,
}: MusicLaneProps) {
  const t = useT();
  const lane = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | undefined>();
  const stopDrag = useRef<(() => void) | undefined>(undefined);
  const justDragged = useRef(false);
  useEffect(() => () => stopDrag.current?.(), []);

  const override = overrideOf(drag);
  const layout = useMemo(
    () => musicLaneLayout(workout, table, selectedId, readOnly, override),
    [workout, table, selectedId, readOnly, override],
  );
  const { axis } = layout;

  function startDrag(e: PointerEvent, pill: LanePill, edge: 'start' | 'end'): void {
    if (readOnly || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const perPx = secPerPx(axis, lane.current?.getBoundingClientRect().width ?? 0);
    const x0 = e.clientX;
    const at = (ev: globalThis.PointerEvent): Drag => ({
      pill,
      edge,
      deltaSec: Math.round((ev.clientX - x0) * perPx),
    });
    const detach = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey, true);
      stopDrag.current = undefined;
    };
    function onMove(ev: globalThis.PointerEvent): void {
      setDrag(at(ev));
    }
    function onUp(ev: globalThis.PointerEvent): void {
      detach();
      const d = at(ev);
      setDrag(undefined);
      if (d.deltaSec === 0) return;
      justDragged.current = true;
      setTimeout(() => {
        justDragged.current = false;
      }, 0);
      const trim = dragTrim(d);
      const tr = pill.track;
      if (trim.startAtSec === tr.startAtSec && trim.endAtSec === (tr.endAtSec ?? null)) return;
      if (!trimTrack(tr, trim.startAtSec, trim.endAtSec)) return;
      dispatch({
        type: 'trimCueTrack',
        blockId: pill.blockId,
        rep: pill.rep,
        index: pill.index,
        ...trim,
      });
    }
    function onCancel(): void {
      detach();
      setDrag(undefined);
    }
    function onKey(ev: KeyboardEvent): void {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        onCancel();
      }
    }
    stopDrag.current?.();
    stopDrag.current = detach;
    setDrag({ pill, edge, deltaSec: 0 });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
  }

  const sel = layout.selectedCue;
  return (
    <div
      ref={lane}
      className={styles.lane}
      data-testid="music-lane"
      data-dragging={drag ? true : undefined}
    >
      {layout.tails.map((tail) => (
        <div
          key={tail.key}
          className={styles.tail}
          data-testid="music-tail"
          title={t('editor.pillOpenTail')}
          style={axisBox(axis, tail.startSec, tail.endSec)}
        />
      ))}
      {layout.pills.map((p) => {
        const trimmingStart = drag?.edge === 'start' && drag.pill.key === p.key ? drag : undefined;
        // Trimming the start: the left edge follows the finger; the run moves up on release.
        const from = trimmingStart
          ? p.startSec + (dragTrim(trimmingStart).startAtSec - p.track.startAtSec)
          : p.startSec;
        const shownTrack: TrackRef = trimmingStart
          ? { ...p.track, startAtSec: dragTrim(trimmingStart).startAtSec }
          : p.track;
        const handles = !readOnly && sel?.blockId === p.blockId && sel.rep === p.rep;
        const titleBits = [
          p.estimated ? t('editor.pillEstimated') : '',
          p.clipped ? t('editor.pillClipped') : '',
        ].filter(Boolean);
        return (
          <div
            key={p.key}
            className={`${styles.slot} ${handles ? styles.active : ''}`}
            style={axisBox(axis, from, Math.max(p.endSec, from + 1))}
            data-testid="music-slot"
          >
            <button
              type="button"
              data-testid="music-pill"
              data-start={p.startSec}
              data-end={p.endSec}
              data-estimated={p.estimated || undefined}
              data-clipped={p.clipped || undefined}
              className={`${styles.pill} ${p.estimated ? styles.estimated : ''} ${p.clipped ? styles.clipped : ''}`}
              title={[pillLabel(t, shownTrack, p.endSec - from, p.estimated), ...titleBits].join(
                '\n',
              )}
              onClick={() => {
                if (justDragged.current) return;
                onPick(p.blockId);
              }}
            >
              {pillLabel(t, shownTrack, p.endSec - from, p.estimated)}
            </button>
            {handles && (
              <>
                <span
                  aria-hidden="true"
                  data-handle="trim-start"
                  title={t('editor.trimStart')}
                  className={`${styles.handle} ${styles.hStart}`}
                  onPointerDown={(e) => startDrag(e, p, 'start')}
                />
                <span
                  aria-hidden="true"
                  data-handle="trim-end"
                  title={t('editor.trimEnd')}
                  className={`${styles.handle} ${styles.hEnd}`}
                  onPointerDown={(e) => startDrag(e, p, 'end')}
                />
              </>
            )}
          </div>
        );
      })}
      {layout.ghosts.map((g) => {
        const share = (g.endSec - g.startSec) / axis.totalSec;
        const full = g.kind === 'pin' ? t('editor.pinTrack') : t('editor.addNext');
        const narrow = share < 0.14;
        return (
          <button
            key={g.key}
            type="button"
            data-testid={g.kind === 'pin' ? 'music-pin' : 'music-add-next'}
            className={`${styles.pill} ${styles.ghost}`}
            style={axisBox(axis, g.startSec, g.endSec)}
            aria-label={narrow ? full : undefined}
            title={full}
            onClick={() => (g.kind === 'pin' ? onPick(g.blockId) : onAddNext(g.blockId))}
          >
            {narrow ? t('editor.addNextShort') : full}
          </button>
        );
      })}
    </div>
  );
}
