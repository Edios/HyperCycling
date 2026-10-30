import {
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useDroppable } from '@dnd-kit/core';
import { horizontalListSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable';
import { effortRow, type EffortLevel, type EffortTable } from '../../domain/effort';
import type { RepeatBlock, Workout } from '../../domain/workout';
import { useT } from '../i18n';
import { slopePolygons } from '../ui/ProfileChart';
import chart from '../ui/ProfileChart.module.css';
import type { EditorAction } from './editor-state';
import { blockTotalSec, clampEffort, intensityEffort, snapSec, type Leaf } from './model';
import styles from './Timeline.module.css';

export const TIMELINE_DROP_ID = 'timeline';
const MAX_EFFORT = 10;

interface Preview {
  id: string;
  durationSec?: number;
  effort?: EffortLevel;
  which?: 'from' | 'to';
}

function applyPreview(leaf: Leaf, p: Preview | undefined): Leaf {
  if (p?.id !== leaf.id) return leaf;
  let out: Leaf = leaf;
  if (p.durationSec !== undefined) out = { ...out, durationSec: p.durationSec };
  if (p.effort !== undefined) {
    if (out.kind === 'steady') out = { ...out, intensity: { effort: p.effort } };
    else out = { ...out, [p.which ?? 'to']: { effort: p.effort } };
  }
  return out;
}

export interface TimelineProps {
  workout: Workout;
  selectedId: string | undefined;
  readOnly: boolean;
  table: EffortTable;
  dispatch: Dispatch<EditorAction>;
}

/** The editable profile: contour bars sized by duration, drag handles on the selected block. */
export function Timeline({ workout, selectedId, readOnly, table, dispatch }: TimelineProps) {
  const t = useT();
  const lane = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<Preview | undefined>();
  const { setNodeRef } = useDroppable({ id: TIMELINE_DROP_ID });

  const totalSec = workout.blocks.reduce((s, b) => s + blockTotalSec(b), 0);

  function startDrag(e: ReactPointerEvent, kind: 'resize' | 'effort', leaf: Leaf): void {
    if (readOnly || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const rect = lane.current?.getBoundingClientRect();
    const laneW = rect?.width || 1;
    const laneH = rect?.height || 1;
    const secPerPx = totalSec / laneW;
    const levelPx = laneH / MAX_EFFORT;
    const startX = e.clientX;
    const startY = e.clientY;
    const which: 'from' | 'to' = e.shiftKey && leaf.kind === 'ramp' ? 'from' : 'to';
    const startEffort =
      leaf.kind === 'steady'
        ? intensityEffort(leaf.intensity, table)
        : intensityEffort(leaf[which], table);

    const compute = (ev: PointerEvent): Preview => {
      if (kind === 'resize') {
        return {
          id: leaf.id,
          durationSec: snapSec(leaf.durationSec + (ev.clientX - startX) * secPerPx, ev.shiftKey),
        };
      }
      return {
        id: leaf.id,
        which,
        effort: clampEffort(startEffort - (ev.clientY - startY) / levelPx),
      };
    };
    const onMove = (ev: PointerEvent): void => setPreview(compute(ev));
    const onUp = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      const p = compute(ev);
      setPreview(undefined);
      if (p.durationSec !== undefined && p.durationSec !== leaf.durationSec) {
        dispatch({ type: 'resizeBlock', id: leaf.id, durationSec: p.durationSec, fine: true });
      } else if (p.effort !== undefined && p.effort !== startEffort) {
        dispatch({
          type: 'setIntensity',
          id: leaf.id,
          effort: p.effort,
          ...(leaf.kind === 'ramp' ? { which } : {}),
        });
      }
    };
    const onCancel = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      setPreview(undefined);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }

  function renderBar(source: Leaf, key: string, showHandles: boolean) {
    const leaf = applyPreview(source, preview);
    const from =
      leaf.kind === 'steady'
        ? intensityEffort(leaf.intensity, table)
        : intensityEffort(leaf.from, table);
    const to = leaf.kind === 'steady' ? from : intensityEffort(leaf.to, table);
    const top: EffortLevel = to > from ? to : from;
    const poly = slopePolygons(from, to, '3px');
    const selected = leaf.id === selectedId;
    const style: CSSProperties & Record<'--c', string> = {
      '--c': effortRow(top, table).color,
      flexGrow: leaf.durationSec,
      height: `${(top / MAX_EFFORT) * 100}%`,
    };
    return (
      <div
        key={key}
        data-bar
        data-testid="editor-block"
        data-block-id={leaf.id}
        data-selected={selected}
        data-effort={top}
        data-duration={leaf.durationSec}
        className={`${chart.bar} ${styles.bar} ${selected ? styles.selected : ''}`}
        style={style}
        onClick={(e) => {
          e.stopPropagation();
          dispatch({ type: 'select', id: leaf.id });
        }}
      >
        <b className={chart.fill} style={{ clipPath: poly.fill }} />
        <b className={chart.edge} style={{ clipPath: poly.edge }} />
        {selected && showHandles && !readOnly && (
          <>
            <span
              role="slider"
              aria-label={t('editor.resizeHandle')}
              aria-valuenow={leaf.durationSec}
              aria-valuemin={5}
              data-handle="duration"
              className={styles.hRight}
              onPointerDown={(e) => startDrag(e, 'resize', source)}
            />
            <span
              role="slider"
              aria-label={t('editor.effortHandle')}
              aria-valuenow={top}
              aria-valuemin={1}
              aria-valuemax={MAX_EFFORT}
              data-handle="effort"
              className={styles.hTop}
              onPointerDown={(e) => startDrag(e, 'effort', source)}
            />
          </>
        )}
      </div>
    );
  }

  function renderRepeat(r: RepeatBlock) {
    const selected = r.id === selectedId;
    const children = r.blocks.map((c) => applyPreview(c, preview));
    const reps = Array.from({ length: r.times }, (_, i) => i);
    return (
      <div
        className={`${styles.group} ${selected ? styles.groupSelected : ''}`}
        data-testid="editor-repeat"
        data-block-id={r.id}
        data-selected={selected}
        onClick={(e) => {
          e.stopPropagation();
          dispatch({ type: 'select', id: r.id });
        }}
      >
        <div className={styles.bracket}>
          <span>{t('editor.repeatLabel', { n: r.times })}</span>
        </div>
        <div className={styles.groupRow}>
          {reps.flatMap((rep) =>
            r.blocks.map((c, i) => renderBar(children[i] ?? c, `${c.id}:${rep}`, rep === 0)),
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      className={styles.canvas}
      data-testid="editor-timeline"
      role="group"
      aria-label={t('editor.timeline')}
      onClick={() => dispatch({ type: 'select', id: undefined })}
    >
      {workout.blocks.length === 0 && <p className={styles.empty}>{t('editor.emptyTimeline')}</p>}
      <div ref={lane} className={styles.lane}>
        <SortableContext
          items={workout.blocks.map((b) => b.id)}
          strategy={horizontalListSortingStrategy}
          disabled={readOnly}
        >
          {workout.blocks.map((b) => {
            const grow =
              b.kind === 'repeat'
                ? b.times * b.blocks.reduce((s, c) => s + applyPreview(c, preview).durationSec, 0)
                : applyPreview(b, preview).durationSec;
            return (
              <SortableItem key={b.id} id={b.id} grow={grow} disabled={readOnly}>
                {b.kind === 'repeat' ? renderRepeat(b) : renderBar(b, b.id, true)}
              </SortableItem>
            );
          })}
        </SortableContext>
      </div>
    </div>
  );
}

function SortableItem({
  id,
  grow,
  disabled,
  children,
}: {
  id: string;
  grow: number;
  disabled: boolean;
  children: ReactNode;
}) {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });
  const style: CSSProperties = {
    flexGrow: grow,
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
    opacity: isDragging ? 0.55 : 1,
    zIndex: isDragging ? 2 : undefined,
  };
  return (
    <div ref={setNodeRef} className={styles.item} style={style} {...listeners}>
      {children}
    </div>
  );
}
