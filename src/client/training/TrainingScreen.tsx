import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { cueForTransition, type CoachCue } from '../../domain/coach';
import { useSettings } from '../data/useSettings';
import { useT } from '../i18n';
import { ControlsBar } from './ControlsBar';
import { EndDialog } from './EndDialog';
import { CoachOverlay } from './hud/CoachOverlay';
import { Countdown } from './hud/Countdown';
import { EdgeFlash } from './hud/EdgeFlash';
import { bindTrainingKeys } from './keyboard';
import { useLastResult } from './last-result';
import { BasicPlayers } from './layouts/BasicPlayers';
import { BasicSolo } from './layouts/BasicSolo';
import { subscribeSessionEvents, useSessionStore, type SessionRuntime } from './session-store';
import { createSound, type Sound } from './sound';
import { useIdleHide } from './useIdleHide';
import { useReducedMotion } from './useReducedMotion';
import { useSessionLoop } from './useSessionLoop';
import { buildTrainingView } from './view';
import styles from './TrainingScreen.module.css';

const CONTROLS_HIDE_MS = 3000;

/** Route /train. Redirects home when no session is loaded. */
export function TrainingScreen() {
  const runtime = useSessionStore((s) => s.runtime);
  const { loaded } = useSettings();
  useSessionLoop();
  if (!runtime) return <Navigate to="/" replace />;
  if (!loaded) return null;
  return <ActiveTraining runtime={runtime} />;
}

function ActiveTraining({ runtime }: { runtime: SessionRuntime }) {
  const t = useT();
  const navigate = useNavigate();
  const { settings } = useSettings();
  const state = useSessionStore((s) => s.state);
  const muted = useSessionStore((s) => s.muted);
  const reducedMotion = useReducedMotion() || settings.effectsIntensity === 0;
  const controlsIdle = useIdleHide(CONTROLS_HIDE_MS);

  const hasPlayers = runtime.players.length > 0;
  const [showPlayers, setShowPlayers] = useState(runtime.config.hud === 'players' && hasPlayers);
  const [flash, setFlash] = useState(0);
  const [cue, setCue] = useState<{ cue: CoachCue | null; key: number }>({ cue: null, key: 0 });
  const [confirmEnd, setConfirmEnd] = useState(false);
  const pausedByDialog = useRef(false);
  const ended = useRef(false);
  const startedAt = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (startedAt.current === undefined && state.status !== 'idle') {
      startedAt.current = new Date().toISOString();
    }
  }, [state.status]);

  // The store is emptied only once the screen is gone, so leaving never bounces through "/".
  useEffect(
    () => () => {
      const s = useSessionStore.getState();
      if (ended.current) s.stop();
      // Leaving without ending: do not keep running invisibly; the runtime stays for resuming.
      else if (s.state.status === 'running' || s.state.status === 'countdown') s.pause();
    },
    [],
  );

  const sound = useMemo<Sound>(() => createSound(), []);
  useEffect(() => () => sound.dispose(), [sound]);
  useEffect(() => {
    sound.setEnabled(settings.sounds && !muted);
  }, [sound, settings.sounds, muted]);

  const view = useMemo(
    () => buildTrainingView(runtime.segments, state, settings.effortTable),
    [runtime.segments, state, settings.effortTable],
  );

  const leave = useCallback(
    (completed: boolean) => {
      const s = useSessionStore.getState();
      const rt = s.runtime;
      if (!rt || ended.current) return;
      const total = rt.segments.reduce((sum, seg) => sum + seg.durationSec, 0);
      useLastResult.getState().set({
        workout: rt.workout,
        riddenSec: completed ? total : Math.min(s.state.workoutElapsedSec, total),
        completed,
        config: rt.config,
        players: rt.players,
        startedAt: startedAt.current ?? new Date().toISOString(),
        ...(rt.plan ? { plan: rt.plan } : {}),
      });
      ended.current = true;
      navigate('/summary');
    },
    [navigate],
  );

  // Engine events: beeps, edge flash, coach cue, finish.
  useEffect(() => {
    const { segments } = runtime;
    return subscribeSessionEvents((e) => {
      if (e.type === 'countdownTick') {
        sound.tick();
      } else if (e.type === 'segmentChanged') {
        if (!e.skipped) sound.segment();
        setFlash((n) => n + 1);
        const next = segments[e.to];
        if (settings.coach && next) {
          const c = cueForTransition(segments[e.from], next, {
            numericCadence: settings.equipment.showsCadence,
          });
          if (c) setCue((prev) => ({ cue: c, key: prev.key + 1 }));
        }
      } else {
        sound.finish();
        leave(true);
      }
    });
  }, [runtime, sound, settings.coach, settings.equipment.showsCadence, leave]);

  const toggle = useCallback(() => {
    sound.unlock();
    const s = useSessionStore.getState();
    switch (s.state.status) {
      case 'idle':
        s.start();
        break;
      case 'paused':
        s.resume();
        break;
      case 'running':
      case 'countdown': // pausing a countdown cancels it back to idle
        s.pause();
        break;
      case 'finished':
        break;
    }
  }, [sound]);

  const openEnd = useCallback(() => {
    const s = useSessionStore.getState();
    const status = s.state.status;
    pausedByDialog.current = status === 'running';
    // Pausing a countdown cancels it back to idle; Resume then returns to the Start prompt.
    if (status === 'running' || status === 'countdown') s.pause();
    setConfirmEnd(true);
  }, []);

  const resumeFromDialog = useCallback(() => {
    setConfirmEnd(false);
    if (pausedByDialog.current) useSessionStore.getState().resume();
    pausedByDialog.current = false;
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  }, []);

  const togglePlayers = useCallback(() => {
    if (hasPlayers) setShowPlayers((v) => !v);
  }, [hasPlayers]);

  useEffect(() => {
    if (confirmEnd) return;
    const store = useSessionStore.getState;
    return bindTrainingKeys(window, {
      toggle,
      prev: () => store().prev(),
      next: () => store().next(),
      togglePlayers,
      fullscreen: toggleFullscreen,
      mute: () => store().toggleMute(),
      escape: openEnd,
    });
  }, [confirmEnd, toggle, togglePlayers, toggleFullscreen, openEnd]);

  if (!view) return null;

  const status = state.status;
  const hideControls = controlsIdle && status === 'running';
  const countdownN =
    status === 'countdown' &&
    (state.startCountdown === 3 || state.startCountdown === 2 || state.startCountdown === 1)
      ? state.startCountdown
      : null;

  const controls = (
    <ControlsBar
      status={status}
      muted={muted}
      hidden={hideControls}
      hasPlayers={hasPlayers}
      onPrev={() => useSessionStore.getState().prev()}
      onToggle={toggle}
      onNext={() => useSessionStore.getState().next()}
      onMute={() => useSessionStore.getState().toggleMute()}
      onFullscreen={toggleFullscreen}
      onPlayers={togglePlayers}
    />
  );
  const coach = (
    <CoachOverlay cue={cue.cue} cueKey={cue.key} color={view.color} reducedMotion={reducedMotion} />
  );
  const Layout = showPlayers && hasPlayers ? BasicPlayers : BasicSolo;
  const rootStyle: CSSProperties & Record<'--zone', string> = { '--zone': view.color };

  return (
    <div
      data-testid="training-screen"
      data-theme={settings.basicTheme}
      data-status={status}
      data-cursor-hidden={hideControls}
      className={`${styles.root} ${hideControls ? styles.noCursor : ''}`}
      style={rootStyle}
    >
      <div className={styles.topbar} aria-hidden="true" />
      <div className={styles.layout}>
        <Layout
          view={view}
          segments={runtime.segments}
          players={runtime.players}
          showsWatts={settings.equipment.showsWatts}
          rpmIsTarget={!settings.equipment.showsCadence}
          hideRpmTile={settings.equipment.hideRpmTile}
          reducedMotion={reducedMotion}
          controls={controls}
          coach={coach}
        />
      </div>
      <EdgeFlash trigger={flash} color={view.color} reducedMotion={reducedMotion} />
      <div className={styles.center}>
        <Countdown n={countdownN} color={view.color} reducedMotion={reducedMotion} />
      </div>
      {status === 'idle' && (
        <div className={styles.promptSlot}>
          <div className={styles.prompt}>
            <button
              type="button"
              className={styles.startButton}
              onClick={(e) => {
                e.currentTarget.blur();
                toggle();
              }}
            >
              {t('training.start')}
            </button>
            <span>{t('training.pressToStart')}</span>
          </div>
        </div>
      )}
      {status === 'paused' && !confirmEnd && (
        <div role="status" className={styles.paused}>
          {t('training.paused')}
        </div>
      )}
      {confirmEnd && <EndDialog onResume={resumeFromDialog} onEnd={() => leave(false)} />}
    </div>
  );
}
