import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate } from 'react-router-dom';
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { totalDurationSec, type Workout } from '../../domain/workout';
import { getRepositories } from '../data/repositories';
import { useSettings } from '../data/useSettings';
import { localizedText } from '../data/localized';
import { useLang, useT, type MessageKey } from '../i18n';
import { formatClock } from '../training/format';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Segmented } from '../ui/Segmented';
import { Toast } from '../ui/Toast';
import { ClassCard } from '../class/ClassCard';
import { DoseWarnings } from '../class/DoseWarnings';
import { duplicateAndSave } from './duplicate';
import {
  createEditorState,
  editorReducer,
  type EditorState,
  type NewBlockKind,
} from './editor-state';
import { Inspector } from './Inspector';
import { MetaBar } from './MetaBar';
import { findBlock, hardMinutes, saveIssue, shortcutToAction } from './model';
import { MusicLane } from './MusicLane';
import { Palette, PALETTE_PREFIX } from './Palette';
import { SongSection } from './SongSection';
import { Timeline, TIMELINE_DROP_ID } from './Timeline';
import styles from './Editor.module.css';

export interface EditorProps {
  initial: Workout;
  /** Built-in workouts cannot be edited; the user duplicates them instead. */
  readOnly: boolean;
  /** Not stored yet: Save is available straight away and navigates to the stored id. */
  isNew: boolean;
  /** An imported draft starts with unsaved changes; an untouched blank draft does not. */
  startDirty?: boolean;
}

function initState(initial: Workout, startDirty: boolean): EditorState {
  const base = createEditorState(initial);
  // A different reference makes undo-to-start stay dirty for an imported draft.
  return startDirty ? { ...base, saved: { ...initial }, dirty: true } : base;
}

export function Editor({ initial, readOnly, isNew, startDirty = false }: EditorProps) {
  const t = useT();
  const [lang] = useLang();
  const navigate = useNavigate();
  const { settings } = useSettings();
  const table = settings.effortTable;
  const [state, dispatch] = useReducer(editorReducer, undefined, () =>
    initState(initial, startDirty),
  );
  const { workout } = state;
  const [toast, setToast] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [focusTrack, setFocusTrack] = useState(false);
  const [showCard, setShowCard] = useState(false);
  // Built-ins are shown in the UI language, like the tiles; own workouts show their stored text.
  const shown = readOnly ? localizedText(workout, lang) : workout;
  const [nameDraft, setNameDraft] = useState(shown.name);
  const [nameSeen, setNameSeen] = useState(shown.name);
  if (nameSeen !== shown.name) {
    setNameSeen(shown.name);
    setNameDraft(shown.name);
  }

  const stateRef = useRef(state);
  const dirtyRef = useRef(state.dirty && !readOnly);
  // Layout effect: the ref must be current as soon as a commit lands (Ctrl+S right after a blur).
  useLayoutEffect(() => {
    stateRef.current = state;
    dirtyRef.current = state.dirty && !readOnly;
  });
  const issue = saveIssue(workout);
  const changed = state.dirty || isNew;
  const canSave = !readOnly && changed && !issue && !saving;
  const [hasActive, setHasActive] = useState(false);

  // Leaving with unsaved changes: in-app navigation via the router blocker, reload/close via beforeunload.
  const blocker = useBlocker(() => dirtyRef.current);
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent): void => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  const saveRef = useRef<() => Promise<boolean>>(() => Promise.resolve(false));
  const save = useCallback(async (): Promise<boolean> => {
    const current = stateRef.current;
    if (readOnly || !(current.dirty || isNew) || saveIssue(current.workout)) return false;
    setSaving(true);
    try {
      const repos = await getRepositories();
      await repos.workouts.put(current.workout);
      dirtyRef.current = false;
      dispatch({ type: 'markSaved' });
      setToast(t('editor.saved'));
      if (isNew) {
        void navigate(`/editor/${encodeURIComponent(current.workout.id)}`, { replace: true });
      }
      return true;
    } catch (err) {
      console.warn('Saving the workout failed', err);
      setToast(t('editor.saveFailed'));
      return false;
    } finally {
      setSaving(false);
    }
  }, [readOnly, isNew, navigate, t]);

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  // Keyboard: arrows select, Delete removes, Ctrl+D/Z/Y, +/- and ↑/↓ edit. Ignored while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Ctrl+S works everywhere, also while typing: blur first so a half-edited field is applied.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur();
        setTimeout(() => void saveRef.current(), 0);
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (document.querySelector('[role="dialog"]')) return;
      const action = shortcutToAction(stateRef.current, e, table);
      if (!action) return;
      if (readOnly && action.type !== 'select') return;
      e.preventDefault();
      dispatch(action);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [readOnly, table]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const onDragEnd = (e: DragEndEvent): void => {
    if (readOnly || !e.over) return;
    const activeId = String(e.active.id);
    const overId = String(e.over.id);
    const ids = workout.blocks.map((b) => b.id);
    if (activeId.startsWith(PALETTE_PREFIX)) {
      const kind = activeId.slice(PALETTE_PREFIX.length) as NewBlockKind;
      let atIndex = ids.length;
      const overIndex = overId === TIMELINE_DROP_ID ? -1 : ids.indexOf(overId);
      if (overIndex >= 0) {
        const moved = e.active.rect.current.translated;
        const centre = e.over.rect.left + e.over.rect.width / 2;
        const after = moved ? moved.left + moved.width / 2 > centre : false;
        atIndex = after ? overIndex + 1 : overIndex;
      }
      dispatch({ type: 'addBlock', kind, atIndex });
      return;
    }
    const from = ids.indexOf(activeId);
    const to = ids.indexOf(overId);
    if (from >= 0 && to >= 0 && from !== to) dispatch({ type: 'moveBlock', from, to });
  };

  const duplicate = async (): Promise<void> => {
    try {
      // Unsaved edits are saved first, so the copy (and the original) never lose them.
      if (!readOnly && stateRef.current.dirty && !(await save())) {
        setToast(t('editor.saveFailed'));
        return;
      }
      const copy = await duplicateAndSave(workout, lang, t('editor.copySuffix'));
      void navigate(`/editor/${encodeURIComponent(copy.id)}`);
    } catch (err) {
      console.warn('Duplicating failed', err);
      setToast(t('editor.saveFailed'));
    }
  };

  const askDelete = async (): Promise<void> => {
    try {
      const repos = await getRepositories();
      const active = await repos.activeSession.get();
      setHasActive(active?.workoutId === workout.id);
    } catch {
      setHasActive(false);
    }
    setConfirmDelete(true);
  };

  const remove = async (): Promise<void> => {
    try {
      const repos = await getRepositories();
      await repos.workouts.remove(workout.id);
      dirtyRef.current = false;
      void navigate('/freestyle');
    } catch (err) {
      console.warn('Deleting the workout failed', err);
      setConfirmDelete(false);
      setToast(t('editor.saveFailed'));
    }
  };

  const selectedBlock = findBlock(workout, state.selectedId);
  const deleteSelected = (): void => {
    if (!selectedBlock) return;
    const action = shortcutToAction(state, new KeyboardEvent('keydown', { key: 'Delete' }), table);
    if (action) dispatch(action);
  };
  const errorKey = state.errors[0];
  const onTrackFocused = useCallback(() => setFocusTrack(false), []);

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className={styles.screen} data-testid="editor-screen" data-readonly={readOnly}>
        <header className={styles.bar}>
          <Link to="/" className={styles.back} title={t('nav.mainMenu')}>
            <span aria-hidden="true">⌂</span> {t('nav.mainMenu')}
          </Link>
          <Link to="/freestyle" className={styles.back}>
            {t('editor.back')}
          </Link>
          <input
            className={`${styles.name} ${nameDraft.trim() === '' ? styles.bad : ''}`}
            aria-label={t('editor.nameLabel')}
            value={nameDraft}
            maxLength={80}
            readOnly={readOnly}
            onChange={(e) => {
              setNameDraft(e.target.value);
              if (e.target.value.trim() !== '') {
                dispatch({ type: 'updateMeta', patch: { name: e.target.value } });
              }
            }}
            onBlur={() => setNameDraft(shown.name)}
          />
          <div className={styles.category}>
            <Segmented
              label={t('editor.category')}
              value={workout.category}
              options={[
                { value: 'progres', label: t('editor.categoryProgres'), disabled: readOnly },
                { value: 'freestyle', label: t('editor.categoryFreestyle'), disabled: readOnly },
              ]}
              onChange={(category) => dispatch({ type: 'updateMeta', patch: { category } })}
            />
          </div>
          <div className={styles.total} aria-label={t('editor.total')} data-testid="editor-total">
            {formatClock(totalDurationSec(workout))}
          </div>
          <div className={styles.load} data-testid="editor-load">
            {t('editor.hardMinutes', { n: hardMinutes(workout, table) })}
          </div>
          <div className={styles.sp} />
          <button
            type="button"
            className={styles.icoBtn}
            aria-label={t('editor.undo')}
            title={`${t('editor.undo')} (Ctrl+Z)`}
            disabled={readOnly || state.past.length === 0}
            onClick={() => dispatch({ type: 'undo' })}
          >
            ↶
          </button>
          <button
            type="button"
            className={styles.icoBtn}
            aria-label={t('editor.redo')}
            title={`${t('editor.redo')} (Ctrl+Y)`}
            disabled={readOnly || state.future.length === 0}
            onClick={() => dispatch({ type: 'redo' })}
          >
            ↷
          </button>
          <Link to="/settings" className={styles.back} title={t('nav.settings')}>
            <span aria-hidden="true">⚙</span> {t('nav.settings')}
          </Link>
          {!isNew && !readOnly && (
            <>
              <Button onClick={() => void duplicate()}>{t('editor.duplicate')}</Button>
              <Button onClick={() => void askDelete()}>{t('editor.delete')}</Button>
            </>
          )}
          {readOnly ? (
            <Button variant="primary" onClick={() => void duplicate()}>
              {t('editor.duplicateToEdit')}
            </Button>
          ) : (
            <Button variant="primary" disabled={!canSave} onClick={() => void save()}>
              {t('editor.save')}
            </Button>
          )}
        </header>

        <MetaBar
          workout={workout}
          description={shown.description}
          readOnly={readOnly}
          dispatch={dispatch}
        />
        {readOnly && (
          <p className={styles.banner} role="status">
            {t('editor.readOnly')}
          </p>
        )}
        {!readOnly && changed && issue && (
          <p className={styles.banner} role="status" data-testid="save-blocked">
            {'empty' in issue
              ? t('editor.saveBlockedEmpty')
              : t('editor.saveBlockedInvalid', { issue: issue.issue })}
          </p>
        )}
        <DoseWarnings
          workout={workout}
          table={table}
          onPick={(blockId) => dispatch({ type: 'select', id: blockId })}
        />
        {errorKey && (
          <p className={styles.alert} role="alert" data-testid="editor-error">
            {t(errorKey as MessageKey)}
          </p>
        )}

        <div className={styles.grid}>
          <Palette readOnly={readOnly} onAdd={(kind) => dispatch({ type: 'addBlock', kind })} />
          <main className={styles.center}>
            <div className={styles.laneLabel}>{t('editor.music')}</div>
            <MusicLane
              workout={workout}
              selectedId={state.selectedId}
              table={table}
              readOnly={readOnly}
              onPick={(blockId) => {
                dispatch({ type: 'select', id: blockId });
                setFocusTrack(true);
              }}
            />
            <Timeline
              workout={workout}
              selectedId={state.selectedId}
              readOnly={readOnly}
              table={table}
              dispatch={dispatch}
            />
            <div className={styles.timelineFoot}>
              <p className={styles.hint}>{t('editor.timelineHint')}</p>
              {(workout.songs?.length ?? 0) > 0 && (
                <Button onClick={() => setShowCard(true)}>{t('editor.cardButton')}</Button>
              )}
              {!readOnly && selectedBlock && (
                <Button onClick={deleteSelected}>{t('editor.deleteBlock')}</Button>
              )}
            </div>
            <SongSection
              workout={workout}
              selectedId={state.selectedId}
              readOnly={readOnly}
              lang={lang}
              dispatch={dispatch}
            />
          </main>
          <Inspector
            workout={workout}
            selectedId={state.selectedId}
            readOnly={readOnly}
            table={table}
            dispatch={dispatch}
            focusTrack={focusTrack}
            onTrackFocused={onTrackFocused}
          />
        </div>

        {blocker.state === 'blocked' && (
          <Modal title={t('editor.leaveTitle')} onClose={() => blocker.reset()}>
            <p>{t('editor.leaveBody')}</p>
            <div className={styles.actions}>
              <Button onClick={() => blocker.reset()}>{t('editor.leaveStay')}</Button>
              <Button variant="primary" onClick={() => blocker.proceed()}>
                {t('editor.leaveGo')}
              </Button>
            </div>
          </Modal>
        )}
        {confirmDelete && (
          <Modal title={t('editor.deleteTitle')} onClose={() => setConfirmDelete(false)}>
            <p>{t('editor.deleteBody', { name: workout.name })}</p>
            {hasActive && (
              <p role="alert" data-testid="delete-active-warning">
                {t('editor.deleteActive')}
              </p>
            )}
            <div className={styles.actions}>
              <Button onClick={() => setConfirmDelete(false)}>{t('editor.cancel')}</Button>
              <Button variant="primary" onClick={() => void remove()}>
                {t('editor.delete')}
              </Button>
            </div>
          </Modal>
        )}
        {showCard && (
          <Modal title={t('card.title')} onClose={() => setShowCard(false)}>
            <ClassCard workout={workout} lang={lang} table={table} name={shown.name} />
            <div className={styles.actions}>
              <Button onClick={() => window.print()}>{t('card.print')}</Button>
              <Button variant="primary" onClick={() => setShowCard(false)}>
                {t('editor.cardClose')}
              </Button>
            </div>
          </Modal>
        )}
        {toast && <Toast message={toast} onClose={() => setToast(undefined)} />}
      </div>
    </DndContext>
  );
}
