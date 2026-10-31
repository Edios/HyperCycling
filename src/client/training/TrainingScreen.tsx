import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { HyperrideCanvas } from '../hyperride/HyperrideCanvas';
import { resolveWorld } from '../hyperride/world-options';
import type { FrameInput } from '../hyperride/world';
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
  initialOverlayHud,
  nextOverlayHud,
  type OverlayHudId,
} from './overlay-layouts';
import type { SessionConfig } from '../../domain/settings';
import { Navigate, useNavigate } from 'react-router-dom';
import { cueForTransition, type CoachCue } from '../../domain/coach';
import type { TrackRef } from '../../domain/workout';
import { useSettings } from '../data/useSettings';
import { useT } from '../i18n';
import { ControlsBar } from './ControlsBar';
import { EndDialog } from './EndDialog';
import { NowPlaying } from './NowPlaying';
import { QuickSettings } from './QuickSettings';
import { activeHud, hudChoices, withLiveChoice, youtubeUrlFor } from './quick-settings';
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
  const { settings, updateSettings } = useSettings();
  const state = useSessionStore((s) => s.state);
  const muted = useSessionStore((s) => s.muted);
  const reducedMotion = useReducedMotion() || settings.effectsIntensity === 0;
  const controlsIdle = useIdleHide(CONTROLS_HIDE_MS);

  const hasPlayers = runtime.players.length > 0;
  const wantsHyperride = runtime.config.background === 'hyperride';
  // WebGL missing or the world failed to start: Basic (dark) for the rest of the session.
  const [hyperrideFailed, setHyperrideFailed] = useState(false);
  const [unavailableDismissed, setUnavailableDismissed] = useState(false);
  const hyperride = wantsHyperride && !hyperrideFailed;
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
  const wantsOverlay = wantsHyperride || wantsYoutube;
  const overlay = hyperride || youtube !== null;
  const onYoutubeFail = useCallback((reason: YoutubeFailure) => setYoutubeFailure(reason), []);
  const [overlayHud, setOverlayHud] = useState<OverlayHudId>(() =>
    initialOverlayHud(runtime.config.hud),
  );
  const [showPlayers, setShowPlayers] = useState(
    wantsOverlay ? hasPlayers : runtime.config.hud === 'players' && hasPlayers,
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
  const musicAudible = settings.sounds && !muted;
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
    if (!hasPlayers) return;
    // Cockpit and Tunnel time have no room for players: showing them switches to Immersive.
    if (overlay && !showPlayers)
      setOverlayHud((h) => (h === 'cockpit' || h === 'tunnelTime' ? 'immersive' : h));
    setShowPlayers((v) => !v);
  }, [hasPlayers, overlay, showPlayers]);

  const cycleLayout = useCallback(() => {
    if (overlay) setOverlayHud((h) => nextOverlayHud(h, showPlayers && hasPlayers));
  }, [overlay, showPlayers, hasPlayers]);

  const getFrameInput = useCallback(
    (): FrameInput => ({
      segments: runtime.segments,
      state: useSessionStore.getState().state,
      table: settingsRef.current.effortTable,
    }),
    [runtime.segments],
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

  const playersOn = showPlayers && hasPlayers;
  const background = runtime.config.background;
  const youtubeUrl = youtubeUrlFor(sessionYoutubeUrl, settings.recentYoutubeUrls);

  /** Applies a live background / layout choice: the session config and the saved defaults follow. */
  const [saveFailures, setSaveFailures] = useState(0);
  const warnSave = useCallback((err: unknown): void => {
    console.warn('Saving the quick settings failed', err);
    setSaveFailures((n) => n + 1);
  }, []);

  const applyChoice = useCallback(
    (bg: SessionConfig['background'], hud: SessionConfig['hud'], url: string | undefined) => {
      const config = withLiveChoice(runtime.config, bg, hud, url);
      useSessionStore.getState().setConfig(config);
      // Leaving YouTube must not forget the link that setup offers as its default.
      const kept = config.youtubeUrl ?? settingsRef.current.lastSession?.youtubeUrl;
      void updateSettings({
        lastSession: {
          ...config,
          ...(kept ? { youtubeUrl: kept } : {}),
          music: settingsRef.current.lastSession?.music ?? config.music,
        },
      }).catch(warnSave);
    },
    [runtime.config, updateSettings, warnSave],
  );

  const changeBackground = (bg: SessionConfig['background']): void => {
    if (bg === background) return;
    const url = bg === 'youtube' ? youtubeUrl : undefined;
    if (bg === 'youtube' && !url) return;
    // A fresh choice gets a fresh try: earlier failures belonged to the previous background.
    setHyperrideFailed(false);
    setUnavailableDismissed(false);
    setYoutubeFailure(undefined);
    setYoutubeToastDismissed(false);
    let hud = activeHud(bg, playersOn, overlayHud);
    if (bg !== 'basic' && !hudChoices(bg, hasPlayers, playersOn).includes(overlayHud)) {
      hud = 'immersive';
      setOverlayHud('immersive');
    }
    if (url) setSessionYoutubeUrl(url);
    applyChoice(bg, hud, url);
  };

  const changeHud = (hud: SessionConfig['hud']): void => {
    if (hud === 'solo' || hud === 'players') setShowPlayers(hud === 'players');
    else setOverlayHud(hud);
    applyChoice(background, hud, background === 'youtube' ? youtubeUrl : undefined);
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
  const Layout = playersOn ? BasicPlayers : BasicSolo;
  const Overlay = {
    immersive: Immersive,
    column: Column,
    cockpit: Cockpit,
    tunnelTime: TunnelTime,
  }[overlayHud];
  const layoutProps = {
    view,
    segments: runtime.segments,
    players: runtime.players,
    showsWatts: settings.equipment.showsWatts,
    rpmIsTarget: !settings.equipment.showsCadence,
    hideRpmTile: settings.equipment.hideRpmTile,
    reducedMotion,
    controls,
    coach,
  };
  const rootStyle: CSSProperties & Record<'--zone', string> = { '--zone': view.color };

  return (
    <div
      ref={rootRef}
      data-testid="training-screen"
      data-theme={wantsOverlay ? 'dark' : settings.basicTheme}
      data-status={status}
      data-background={hyperride ? 'hyperride' : youtube !== null ? 'youtube' : 'basic'}
      data-cursor-hidden={hideControls}
      className={`${styles.root} ${hideControls ? styles.noCursor : ''}`}
      style={rootStyle}
    >
      {hyperride ? (
        <>
          <HyperrideCanvas
            getFrameInput={getFrameInput}
            quality={settings.hyperrideQuality}
            world={resolveWorld(settings.hyperrideWorld)}
            viewOffsetX={overlayHud === 'column' && !playersOn ? COLUMN_VIEW_OFFSET : 0}
            {...(motionOn ? { onSway } : {})}
            onUnavailable={() => setHyperrideFailed(true)}
          />
          <div className={`${styles.layout} ${styles.overlayLayer}`}>
            <Overlay {...layoutProps} withPlayers={playersOn} />
          </div>
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
          <div className={`${styles.layout} ${styles.overlayLayer}`}>
            <Overlay {...layoutProps} withPlayers={playersOn} />
          </div>
        </>
      ) : (
        <>
          <div className={styles.topbar} aria-hidden="true" />
          <div className={styles.layout}>
            <Layout {...layoutProps} />
          </div>
        </>
      )}
      <ToastStack>
        {wantsHyperride && hyperrideFailed && !unavailableDismissed && (
          <Toast
            message={t('hyperride.unavailable')}
            onClose={() => setUnavailableDismissed(true)}
          />
        )}
        {wantsYoutube && youtube === null && !youtubeToastDismissed && (
          <Toast
            message={t(
              youtubeFailure === 'embed-blocked' ? 'youtube.embedBlocked' : 'youtube.unavailable',
            )}
            onClose={() => setYoutubeToastDismissed(true)}
          />
        )}
        {saveFailures > 0 && (
          <Toast
            key={saveFailures}
            message={t('settings.saveFailed')}
            onClose={() => setSaveFailures(0)}
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
        <NowPlaying track={nowPlaying} muted={!musicAudible} raised={overlay} />
      )}
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
      {quickOpen && !confirmEnd && (
        <QuickSettings
          background={background}
          youtubeAvailable={youtubeUrl !== undefined}
          hud={activeHud(background, playersOn, overlayHud)}
          hudChoices={hudChoices(background, hasPlayers, playersOn)}
          world={settings.hyperrideWorld}
          onWorld={(w) => void updateSettings({ hyperrideWorld: w }).catch(warnSave)}
          sounds={settings.sounds}
          coach={settings.coach}
          onBackground={changeBackground}
          onHud={changeHud}
          onSounds={(on) => void updateSettings({ sounds: on }).catch(warnSave)}
          onCoach={(on) => void updateSettings({ coach: on }).catch(warnSave)}
          onClose={() => setQuickOpen(false)}
        />
      )}
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
