import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { DiagnosticsOverlay } from '../diagnostics/DiagnosticsOverlay';
import { WorldCanvas } from '../world/WorldCanvas';
import { resolveWorld } from '../world/world-options';
import type { FrameInput, WorldTheme } from '../world/world';
import { getExperience } from '../data/builtin';
import { resolveChapters } from '../../domain/experience';
import { useMusicDirector } from '../music/useMusicDirector';
import { Toast, ToastStack } from '../ui/Toast';
import { getSettingsSnapshot } from '../data/useSettings';
import { isSpotifyUsable } from '../music/spotify/shared';
import { spotifyErrorKey } from '../music/spotify/messages';
import { isSpotifyError } from '../music/spotify/errors';
import { parseYoutubeUrl } from '../youtube/parseYoutubeUrl';
import { YouTubeBackground, type YoutubeFailure } from '../youtube/YouTubeBackground';
import { Cockpit } from './layouts/overlay/Cockpit';
import { Column } from './layouts/overlay/Column';
import { Immersive } from './layouts/overlay/Immersive';
import { TunnelTime } from './layouts/overlay/TunnelTime';
import {
  COLUMN_VIEW_OFFSET,
  layoutChoices,
  layoutKindOf,
  nextLayout,
  storedHud,
  supportsRiders,
  type LayoutKind,
} from './overlay-layouts';
import { ridersHintKey } from '../setup/model';
import { FOCUS_INPUT_HOLD_MS, focusVisible } from './focus-visibility';
import { FocusBadge, FocusRest } from './layouts/FocusRest';
import { FOCUS_IN_MS, FOCUS_OUT_MS, fadeStyle } from './hud/motion';
import { monotonicNowMs, useLastInput } from './useLastInput';
import type { SessionConfig } from '../../domain/settings';
import {
  Navigate,
  UNSAFE_DataRouterContext,
  useBlocker,
  useNavigate,
  type Blocker,
} from 'react-router-dom';
import { cueForTransition, stepPreCue, type CoachCue } from '../../domain/coach';
import type { TrackRef } from '../../domain/workout';
import { useSettings } from '../data/useSettings';
import { useLang, useT } from '../i18n';
import { localizedText } from '../data/localized';
import { ControlsBar } from './ControlsBar';
import { EndDialog } from './EndDialog';
import { NowPlaying } from './NowPlaying';
import { QuickSettings } from './QuickSettings';
import { withLiveChoice, youtubeUrlFor } from './quick-settings';
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
/** Music warnings carry instructions (open Spotify...), so they stay longer than other toasts. */
const MUSIC_WARNING_MS = 8000;
/** The background fell back silently: the toast explaining why must outlast the layout switch. */
const FALLBACK_TOAST_MS = 8000;

/**
 * Asks before browser Back / Forward leaves a started ride. Only mounted under a data router
 * (useBlocker needs one); the plain-router tests render without it.
 */
function LeaveGuard({
  shouldBlock,
  onBlocked,
}: {
  shouldBlock: () => boolean;
  onBlocked: (blocker: Blocker) => void;
}) {
  const blocker = useBlocker(shouldBlock);
  useEffect(() => {
    if (blocker.state === 'blocked') onBlocked(blocker);
  }, [blocker, onBlocked]);
  return null;
}

/** Route /train. Redirects home when no session is loaded. */
export function TrainingScreen() {
  const runtime = useSessionStore((s) => s.runtime);
  const { loaded } = useSettings();
  useSessionLoop();
  if (!runtime) return <Navigate to="/" replace />;
  if (!loaded) return null;
  return <ActiveTraining runtime={runtime} />;
}

/** True on a touch-first device (no fine pointer): no keyboard, so no Space hint. */
function isTouch(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
}

function ActiveTraining({ runtime }: { runtime: SessionRuntime }) {
  const t = useT();
  const [lang] = useLang();
  const navigate = useNavigate();
  const { settings } = useSettings();
  const state = useSessionStore((s) => s.state);
  const muted = useSessionStore((s) => s.muted);
  const reducedMotion = useReducedMotion() || settings.effectsIntensity === 0;
  const controlsIdle = useIdleHide(CONTROLS_HIDE_MS);
  const lastInputMs = useLastInput(FOCUS_INPUT_HOLD_MS);

  const hasPlayers = runtime.players.length > 0;
  const wantsWorld = runtime.config.background === 'hyperride';
  // WebGL missing or the world failed to start: Basic (dark) for the rest of the session.
  const [worldFailed, setWorldFailed] = useState(false);
  const [unavailableDismissed, setUnavailableDismissed] = useState(false);
  const world = wantsWorld && !worldFailed;
  // Automatic quality switched to low for this session (the canvas reports it once).
  const [autoLowered, setAutoLowered] = useState(false);
  const [autoToastDismissed, setAutoToastDismissed] = useState(false);
  const effectiveQuality =
    settings.hyperrideQuality === 'auto'
      ? autoLowered
        ? 'low'
        : 'high'
      : settings.hyperrideQuality;
  // A video that cannot be played (or a link that cannot be read) also means Basic (dark).
  const youtubeTarget = useMemo(
    () =>
      runtime.config.background === 'youtube' && runtime.config.youtubeUrl
        ? parseYoutubeUrl(runtime.config.youtubeUrl)
        : null,
    [runtime.config.background, runtime.config.youtubeUrl],
  );
  const wantsYoutube = runtime.config.background === 'youtube';
  const [youtubeFailure, setYoutubeFailure] = useState<YoutubeFailure | undefined>();
  const [youtubeToastDismissed, setYoutubeToastDismissed] = useState(false);
  const youtube = youtubeFailure === undefined ? youtubeTarget : null;
  const wantsOverlay = wantsWorld || wantsYoutube;
  const overlay = world || youtube !== null;
  const onYoutubeFail = useCallback((reason: YoutubeFailure) => setYoutubeFailure(reason), []);
  // An Experience carries its own background; its menus offer only the layout and Lite.
  const isExperience = runtime.options?.experienceId !== undefined;
  const [kind, setKind] = useState<LayoutKind>(() =>
    isExperience && runtime.config.background === 'basic' && runtime.config.hud === 'solo'
      ? 'immersive'
      : layoutKindOf(runtime.config.hud, runtime.config.background),
  );
  // Saved Solo means "no riders panel"; every other stored layout shows riders when there are any.
  const [showPlayers, setShowPlayers] = useState(
    hasPlayers && (runtime.config.showRiders ?? runtime.config.hud !== 'solo'),
  );
  // A track that cannot be played only shows a notice; the workout carries on.
  const [musicWarning, setMusicWarning] = useState<{ id: number; message: string } | null>(null);
  const musicWarningCount = useRef(0);
  const onMusicWarning = useCallback(
    (track: TrackRef, error?: unknown) => {
      // A Spotify track with no provider at all means the user never connected (or cleared) it.
      const notConnected =
        track.provider === 'spotify' &&
        !isSpotifyError(error) &&
        !isSpotifyUsable(getSettingsSnapshot().spotify);
      const key = notConnected ? 'music.error.notConnected' : spotifyErrorKey(error);
      setMusicWarning({
        id: ++musicWarningCount.current,
        message: t(key, { title: track.title || t('music.unknownTrack') }),
      });
    },
    [t],
  );
  const [nowPlaying, setNowPlaying] = useState<TrackRef | null>(null);
  // Beeps, cues and world are per ride (Setup / quick settings); Settings only supplies defaults.
  const soundsOn = runtime.options?.sounds ?? settings.sounds;
  const coachOn = runtime.options?.coach ?? settings.coach;
  const worldId = runtime.options?.world ?? settings.hyperrideWorld;
  const musicAudible = soundsOn && !muted;
  useMusicDirector(runtime, onMusicWarning, {
    volume: musicAudible ? 1 : 0,
    onPlaying: setNowPlaying,
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  });
  const [flash, setFlash] = useState(0);
  const [cue, setCue] = useState<{ cue: CoachCue | null; key: number }>({ cue: null, key: 0 });
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [sessionYoutubeUrl, setSessionYoutubeUrl] = useState(runtime.config.youtubeUrl);
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
    sound.setEnabled(soundsOn && !muted);
  }, [sound, soundsOn, muted]);

  const view = useMemo(
    () => buildTrainingView(runtime.segments, state, settings.effortTable),
    [runtime.segments, state, settings.effortTable],
  );

  // Pre-cue for the next step of a stepped ramp ("In 5 s: add resistance"), once per step.
  const lastStepCue = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!coachOn || state.status !== 'running') return;
    const seg = runtime.segments[state.segmentIndex];
    if (!seg) return;
    const pre = stepPreCue(seg, state.segmentElapsedSec);
    if (!pre || pre.key === lastStepCue.current) return;
    lastStepCue.current = pre.key;
    setCue((prev) => ({ cue: pre.cue, key: prev.key + 1 }));
  }, [coachOn, runtime.segments, state.status, state.segmentIndex, state.segmentElapsedSec]);

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
        ...(rt.options?.experienceId ? { experienceId: rt.options.experienceId } : {}),
      });
      ended.current = true;
      navigate('/summary');
    },
    [navigate],
  );

  /** Leave for the main menu: no summary, and the unmount cleanup drops the session. */
  const leaveWithoutSaving = useCallback(() => {
    ended.current = true;
    navigate('/');
  }, [navigate]);

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
        if (coachOn && next) {
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
  }, [runtime, sound, coachOn, settings.equipment.showsCadence, leave]);

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

  // Browser Back / Forward during a started ride opens the same exit question.
  const dataRouter = useContext(UNSAFE_DataRouterContext) !== null;
  const blockedNav = useRef<Blocker | null>(null);
  const shouldBlockNav = useCallback(
    () => !ended.current && useSessionStore.getState().state.status !== 'idle',
    [],
  );
  const onNavBlocked = useCallback(
    (blocker: Blocker) => {
      const already = blockedNav.current !== null;
      blockedNav.current = blocker;
      if (!already) openEnd();
    },
    [openEnd],
  );

  const resumeFromDialog = useCallback(() => {
    blockedNav.current?.reset?.();
    blockedNav.current = null;
    setConfirmEnd(false);
    if (pausedByDialog.current) useSessionStore.getState().resume();
    pausedByDialog.current = false;
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  }, []);

  const playersOn = showPlayers && hasPlayers && supportsRiders(kind);

  const togglePlayers = useCallback(() => {
    if (!hasPlayers) return;
    if (playersOn) {
      setShowPlayers(false);
      return;
    }
    // Cockpit and Minimal have no room for riders: showing them switches to the corner layout.
    if (!supportsRiders(kind)) setKind('immersive');
    setShowPlayers(true);
  }, [hasPlayers, playersOn, kind]);

  const background = runtime.config.background;
  const cycleLayout = useCallback(() => {
    setKind((k) => nextLayout(k, background, isExperience));
  }, [background, isExperience]);

  // An Experience's theme for the Scenes world; built once per ride, not per frame.
  const experienceId = runtime.options?.experienceId;
  const worldTheme = useMemo((): WorldTheme | undefined => {
    const exp = experienceId ? getExperience(experienceId) : undefined;
    if (!exp || exp.worldTheme.theme === 'abstract') return undefined;
    return { id: exp.worldTheme.theme, chapters: resolveChapters(exp, runtime.workout) };
  }, [experienceId, runtime.workout]);
  const getFrameInput = useCallback(
    (): FrameInput => ({
      segments: runtime.segments,
      state: useSessionStore.getState().state,
      table: settingsRef.current.effortTable,
      theme: worldTheme,
    }),
    [runtime.segments, worldTheme],
  );
  const motionOn = !reducedMotion;
  const onSway = useCallback((x: number, y: number) => {
    const el = rootRef.current;
    if (!el) return;
    el.style.setProperty('--sx', `${x.toFixed(1)}px`);
    el.style.setProperty('--sy', `${y.toFixed(1)}px`);
  }, []);
  useEffect(() => {
    if (motionOn) return;
    rootRef.current?.style.removeProperty('--sx');
    rootRef.current?.style.removeProperty('--sy');
  }, [motionOn]);

  const youtubeUrl = youtubeUrlFor(sessionYoutubeUrl, settings.recentYoutubeUrls);

  /** Applies a live background / layout choice to this ride only; saved defaults stay untouched. */
  const applyChoice = useCallback(
    (bg: SessionConfig['background'], hud: SessionConfig['hud'], url: string | undefined) => {
      useSessionStore.getState().setConfig(withLiveChoice(runtime.config, bg, hud, url));
    },
    [runtime.config],
  );

  const changeBackground = (bg: SessionConfig['background']): void => {
    if (bg === background) return;
    const url = bg === 'youtube' ? youtubeUrl : undefined;
    if (bg === 'youtube' && !url) return;
    // A fresh choice gets a fresh try: earlier failures belonged to the previous background.
    setWorldFailed(false);
    setUnavailableDismissed(false);
    setYoutubeFailure(undefined);
    setYoutubeToastDismissed(false);
    // Every layout works on every background; only the Basic tiles (Classic) stay on Basic.
    let next = kind;
    if ((bg !== 'basic' || isExperience) && kind === 'classic') {
      next = 'immersive';
      setKind(next);
    }
    if (url) setSessionYoutubeUrl(url);
    applyChoice(bg, storedHud(next, playersOn), url);
  };

  const changeLayout = (next: LayoutKind): void => {
    setKind(next);
    applyChoice(
      background,
      storedHud(next, playersOn && supportsRiders(next)),
      background === 'youtube' ? youtubeUrl : undefined,
    );
  };

  useEffect(() => {
    if (confirmEnd) return;
    const store = useSessionStore.getState;
    return bindTrainingKeys(window, {
      toggle,
      prev: () => store().prev(),
      next: () => store().next(),
      togglePlayers,
      cycleLayout,
      fullscreen: toggleFullscreen,
      mute: () => store().toggleMute(),
      // Esc closes the quick settings first; with nothing open it asks how to leave.
      escape: quickOpen ? () => setQuickOpen(false) : openEnd,
    });
  }, [confirmEnd, quickOpen, toggle, togglePlayers, cycleLayout, toggleFullscreen, openEnd]);

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
      onMenu={openEnd}
      quickOpen={quickOpen}
      onQuick={() => setQuickOpen((v) => !v)}
    />
  );
  const coach = (
    <CoachOverlay cue={cue.cue} cueKey={cue.key} color={view.color} reducedMotion={reducedMotion} />
  );
  // A background that fell back to Basic always shows the plain tiles, as before.
  const renderKind: LayoutKind = wantsOverlay && !overlay ? 'classic' : kind;
  const tiled = renderKind === 'classic';
  const Layout = playersOn ? BasicPlayers : BasicSolo;
  const Overlay = {
    immersive: Immersive,
    column: Column,
    cockpit: Cockpit,
    tunnelTime: TunnelTime,
    focus: Immersive, // Focus shows the corner HUD; it only comes and goes
    classic: Immersive,
  }[renderKind];
  const focusOn = renderKind === 'focus';
  const lastSeg = runtime.segments[runtime.segments.length - 1];
  const workoutTotalSec = lastSeg ? lastSeg.startSec + lastSeg.durationSec : 0;
  const hudShown =
    !focusOn ||
    focusVisible({
      status,
      nowMs: monotonicNowMs(),
      lastInputMs,
      blockElapsedSec: view.durationSec - view.remainingSec,
      blockRemainingSec: view.remainingSec,
      workoutRemainingSec: workoutTotalSec - view.elapsedSec,
      dialogOpen: confirmEnd || quickOpen,
    });
  const layoutProps = {
    view,
    segments: runtime.segments,
    players: runtime.players,
    showsWatts: settings.equipment.showsWatts,
    rpmIsTarget: !settings.equipment.showsCadence,
    hideRpmTile: settings.equipment.hideRpmTile,
    reducedMotion,
    glass: overlay,
    workoutName: localizedText(runtime.workout, lang).name,
    controls,
    coach,
  };
  const rootStyle: CSSProperties & Record<'--zone', string> = { '--zone': view.color };
  const hudLayer = tiled ? (
    <div className={styles.layout}>
      <Layout {...layoutProps} />
    </div>
  ) : (
    <div
      className={[
        styles.layout,
        styles.overlayLayer,
        focusOn ? styles.focusLayer : '',
        focusOn && !hudShown ? styles.focusHidden : '',
      ].join(' ')}
      style={focusOn ? fadeStyle(hudShown, FOCUS_IN_MS, FOCUS_OUT_MS, reducedMotion) : undefined}
      data-testid={focusOn ? 'focus-layer' : undefined}
      data-hud-visible={focusOn ? hudShown : undefined}
    >
      <Overlay {...layoutProps} withPlayers={playersOn} />
    </div>
  );

  return (
    <div
      ref={rootRef}
      data-testid="training-screen"
      data-theme={wantsOverlay || !tiled ? 'dark' : settings.basicTheme}
      data-status={status}
      data-background={world ? 'hyperride' : youtube !== null ? 'youtube' : 'basic'}
      data-material={overlay ? 'glass' : 'solid'}
      data-cursor-hidden={hideControls}
      className={`${styles.root} ${hideControls ? styles.noCursor : ''}`}
      style={rootStyle}
    >
      {world ? (
        <>
          <WorldCanvas
            getFrameInput={getFrameInput}
            quality={settings.hyperrideQuality}
            onAutoLowered={() => setAutoLowered(true)}
            world={resolveWorld(worldId)}
            viewOffsetX={renderKind === 'column' && !playersOn ? COLUMN_VIEW_OFFSET : 0}
            {...(motionOn ? { onSway } : {})}
            onUnavailable={() => setWorldFailed(true)}
          />
          {focusOn && <FocusBadge view={view} active={!hudShown} reducedMotion={reducedMotion} />}
          {hudLayer}
        </>
      ) : youtube !== null ? (
        <>
          <YouTubeBackground
            videoId={youtube.videoId}
            startSec={youtube.startSec}
            paused={status === 'paused'}
            reducedMotion={reducedMotion}
            onFail={onYoutubeFail}
          />
          {focusOn && <FocusBadge view={view} active={!hudShown} reducedMotion={reducedMotion} />}
          {hudLayer}
        </>
      ) : tiled ? (
        <>
          <div className={styles.topbar} aria-hidden="true" />
          {hudLayer}
        </>
      ) : (
        <>
          <div className={styles.zoneBackdrop} aria-hidden="true" />
          {focusOn && <FocusRest view={view} active={!hudShown} reducedMotion={reducedMotion} />}
          {hudLayer}
        </>
      )}
      <ToastStack>
        {wantsWorld && worldFailed && !unavailableDismissed && (
          <Toast message={t('world.unavailable')} onClose={() => setUnavailableDismissed(true)} />
        )}
        {wantsYoutube && youtube === null && !youtubeToastDismissed && (
          <Toast
            message={t(
              youtubeFailure === 'embed-blocked' ? 'youtube.embedBlocked' : 'youtube.unavailable',
            )}
            durationMs={FALLBACK_TOAST_MS}
            onClose={() => setYoutubeToastDismissed(true)}
          />
        )}
        {autoLowered && !autoToastDismissed && (
          <Toast
            message={t('diagnostics.autoLowered')}
            onClose={() => setAutoToastDismissed(true)}
          />
        )}
        {musicWarning && (
          <Toast
            key={musicWarning.id}
            message={musicWarning.message}
            durationMs={MUSIC_WARNING_MS}
            onClose={() => setMusicWarning(null)}
          />
        )}
      </ToastStack>
      {runtime.config.music && nowPlaying && (
        <NowPlaying track={nowPlaying} muted={!musicAudible} />
      )}
      {settings.diagnostics === true && (
        <DiagnosticsOverlay
          scene={
            world
              ? `${t('setup.backgroundWorld')} / ${resolveWorld(worldId)}`
              : t(youtube !== null ? 'setup.backgroundYoutube' : 'setup.backgroundBasic')
          }
          quality={world ? effectiveQuality : undefined}
        />
      )}
      <EdgeFlash trigger={flash} color={view.color} reducedMotion={reducedMotion} />
      <div className={styles.center}>
        <Countdown n={countdownN} color={view.color} reducedMotion={reducedMotion} />
      </div>
      {status === 'idle' && (
        <div className={`${styles.promptSlot} ${styles.promptOverlay}`}>
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
            <span>{t(isTouch() ? 'training.tapToStart' : 'training.pressToStart')}</span>
          </div>
        </div>
      )}
      {status === 'paused' && !confirmEnd && (
        <div role="status" className={styles.paused}>
          {t('training.paused')}
          {/* The quick settings carry the same hint: show it in one place only. */}
          {!quickOpen && <small className={styles.pausedHint}>{t('training.shortcutHint')}</small>}
        </div>
      )}
      {quickOpen && !confirmEnd && (
        <QuickSettings
          background={background}
          youtubeAvailable={youtubeUrl !== undefined}
          layout={kind}
          layoutChoices={layoutChoices(background, isExperience)}
          experience={isExperience}
          riders={playersOn}
          ridersHint={ridersHintKey(kind, hasPlayers)}
          onRiders={(on) => {
            if (on !== playersOn) togglePlayers();
          }}
          world={worldId}
          onWorld={(w) => useSessionStore.getState().setOptions({ world: w })}
          sounds={soundsOn}
          coach={coachOn}
          onBackground={changeBackground}
          onLayout={changeLayout}
          onSounds={(on) => useSessionStore.getState().setOptions({ sounds: on })}
          onCoach={(on) => useSessionStore.getState().setOptions({ coach: on })}
          onClose={() => setQuickOpen(false)}
        />
      )}
      {dataRouter && <LeaveGuard shouldBlock={shouldBlockNav} onBlocked={onNavBlocked} />}
      {confirmEnd && (
        <EndDialog
          onResume={resumeFromDialog}
          onEnd={() => leave(false)}
          onLeave={leaveWithoutSaving}
        />
      )}
    </div>
  );
}
