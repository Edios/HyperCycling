import { effectiveMusicCues, totalDurationSec } from '../../domain/workout';
import { MIN_WIZARD_SEC } from '../../domain/soundtrack-wizard';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { newId } from '../../domain/ids';
import { bikeKindOf, bikeShowsWatts, type BikeKind } from '../../domain/bike';
import { resolveResistanceMode, type WorldSettingId } from '../../domain/settings';
import { DEFAULT_PLAN_SETTINGS, type PlanSettings } from '../../domain/plan';
import { playerSchema, type Player } from '../../domain/player';
import { flattenWorkout } from '../../domain/segments';
import { getRepositories } from '../data/repositories';
import { localizedText } from '../data/localized';
import { useLibrary } from '../data/useLibrary';
import { useSettings } from '../data/useSettings';
import { useLang, useT, type MessageKey } from '../i18n';
import { getExperience } from '../data/builtin';
import { experienceText, type Experience } from '../../domain/experience';
import { ExperienceMusic } from '../experience/ExperienceMusic';
import { MusicSourceSelect } from '../experience/MusicSourceSelect';
import { loadChoices, type Choices } from '../experience/musicChoices';
import { chainChoices, withUserMusic } from '../experience/musicMatch';
import { ExperienceMusicCheck, redSlots } from '../experience/ExperienceMusicCheck';
import { useMusicSource } from '../music/music-source';
import { ipOriginHost } from '../music/origin';
import { deadRecordings, type ResultMap } from '../music/preflight';
import { useSpotifyConnected } from '../music/spotify/useSpotify';
import { WORLD_CHOICES } from '../world/world-options';
import { useSessionStore } from '../training/session-store';
import {
  drawNewOrder,
  forgetPlan,
  replaySavedOrder,
  useSoundtrackSession,
} from '../soundtrack/session';
import { useSoundtrackCatalog } from '../soundtrack/useCatalog';
import { useSoundtrackOverlay } from '../soundtrack/useSoundtrackOverlay';
import { formatClock } from '../training/format';
import { AppBar } from '../ui/AppBar';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Chip } from '../ui/Chip';
import { Field } from '../ui/Field';
import { ProfileChart } from '../ui/ProfileChart';
import { Modal } from '../ui/Modal';
import { Segmented } from '../ui/Segmented';
import { SettingRow } from '../ui/SettingRow';
import { Toggle } from '../ui/Toggle';
import { parseYoutubeUrl } from '../youtube/parseYoutubeUrl';
import {
  addRecentYoutubeUrl,
  applyPlanSettings,
  buildConfig,
  buildRuntime,
  DEFAULT_PLAYER_FTP,
  effectiveLayout,
  ENABLED_BACKGROUNDS,
  layoutLabelKey,
  layoutOptions,
  initialSelection,
  initialSetup,
  MAX_SESSION_PLAYERS,
  parsePlanRef,
  peakEffort,
  pickPlayers,
  ridersAvailable,
  ridersHintKey,
  totalSec,
  type Background,
} from './model';
import type { LayoutKind } from '../training/overlay-layouts';
import { useDeviceStore, useDevicesState } from '../devices/useDevices';
import { DevicesPanel } from '../devices/DevicesPanel';
import { BikeWizard } from '../bike/BikeWizard';
import { AdvancedPanel, Group, readAdvancedOpen, saveAdvancedOpen } from './AdvancedPanel';
import { StartBar } from './StartBar';
import styles from './SetupScreen.module.css';
import { Icon } from '../ui/Icon';

const BIKE_LABEL: Record<BikeKind, MessageKey> = {
  knob: 'bike.shortKnob',
  knobPower: 'bike.shortKnobPower',
  smart: 'bike.shortSmart',
};

const BACKGROUNDS: readonly { value: Background; labelKey: MessageKey }[] = [
  { value: 'basic', labelKey: 'setup.backgroundBasic' },
  { value: 'hyperride', labelKey: 'setup.backgroundWorld' },
  { value: 'youtube', labelKey: 'setup.backgroundYoutube' },
];

/** Route /setup/:workoutId (query plan, week, slot when launched from a plan). */
export function SetupScreen() {
  const { workoutId = '' } = useParams();
  const [params] = useSearchParams();
  const { workouts, loaded: libraryLoaded } = useLibrary();
  const { loaded: settingsLoaded } = useSettings();
  const plan = useMemo(() => parsePlanRef(params), [params]);
  const planId = plan?.planId;
  const expId = params.get('exp');
  const experience = useMemo(() => (expId ? getExperience(expId) : undefined), [expId]);

  const [players, setPlayers] = useState<Player[] | undefined>();
  const [planSettings, setPlanSettings] = useState<PlanSettings | undefined>();

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const repos = await getRepositories();
        const list = await repos.players.list();
        if (live) setPlayers(list);
        if (!planId) {
          if (live) setPlanSettings(DEFAULT_PLAN_SETTINGS);
          return;
        }
        const progress = await repos.planProgress.get(planId);
        if (live) setPlanSettings(progress?.settings ?? DEFAULT_PLAN_SETTINGS);
      } catch (err) {
        console.warn('Loading players or plan settings failed', err);
        if (live) {
          setPlayers((p) => p ?? []);
          setPlanSettings(DEFAULT_PLAN_SETTINGS);
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [planId]);

  const workout = workouts.find((w) => w.id === workoutId);
  if (libraryLoaded && !workout) return <Navigate to="/" replace />;
  if (!workout || !settingsLoaded || !players || !planSettings) {
    return <div className={styles.page} aria-busy="true" />;
  }
  return (
    <SetupForm
      key={workout.id}
      workout={workout}
      plan={plan}
      experience={experience}
      planSettings={plan ? planSettings : DEFAULT_PLAN_SETTINGS}
      initialPlayers={players}
    />
  );
}

interface SetupFormProps {
  workout: ReturnType<typeof useLibrary>['workouts'][number];
  plan: ReturnType<typeof parsePlanRef>;
  experience: Experience | undefined;
  planSettings: PlanSettings;
  initialPlayers: Player[];
}

function SetupForm({ workout, plan, experience, planSettings, initialPlayers }: SetupFormProps) {
  const t = useT();
  const [lang] = useLang();
  const navigate = useNavigate();
  const { settings, updateSettings } = useSettings();
  const last = settings.lastSession;

  // What the screen opens with, from the saved last ride and the saved defaults (see initialSetup).
  const [init] = useState(() => initialSetup(last, settings, experience !== undefined));
  const [players, setPlayers] = useState(initialPlayers);
  const [background, setBackground] = useState<Background>(init.background);
  // The Settings default layout, also with a preselected rider.
  const [chosenHud, setChosenHud] = useState<LayoutKind | undefined>(init.hud);
  const [showRiders, setShowRiders] = useState(init.showRiders);
  const [selected, setSelected] = useState<string[]>(() =>
    initialSelection(initialPlayers, last?.playerIds),
  );
  const [beeps, setBeeps] = useState(settings.sounds);
  const [coach, setCoach] = useState(settings.coach);
  // An Experience is built around its music, so it starts on; the rider can switch it off here.
  // Music matched in this visit switches the ride's music on.
  const [music, setMusic] = useState(
    () => init.music || useSoundtrackSession.getState().plans[workout.id] !== undefined,
  );
  const [world, setWorld] = useState<WorldSettingId>(init.world);
  const [adding, setAdding] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(readAdvancedOpen);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [bikeOpen, setBikeOpen] = useState(false);
  const advancedRef = useRef<HTMLDivElement>(null);
  // A connected trainer IS the bike: smart, with watts. Nothing to ask about the bike then.
  const devices = useDevicesState(useDeviceStore());
  const trainerConnected = devices.trainer.status === 'connected';
  const bikeKind: BikeKind = trainerConnected
    ? 'smart'
    : bikeKindOf(resolveResistanceMode(settings), settings.equipment);
  const showsWatts = bikeShowsWatts(settings.equipment, trainerConnected);
  const spotifyConnected = useSpotifyConnected();
  // Songs the rider matched to their Spotify for this Experience (kept in this browser only).
  const [matched, setMatched] = useState<Choices>(() =>
    experience ? loadChoices(experience.id) : {},
  );
  const [youtubeUrl, setYoutubeUrl] = useState(last?.youtubeUrl ?? '');
  const chosenSource = useMusicSource();
  // YouTube does not play from an IP address (127.0.0.1): with Spotify connected it goes first.
  const musicSource =
    ipOriginHost() !== undefined && spotifyConnected && chosenSource === 'youtube'
      ? 'spotify'
      : chosenSource;
  // What the last "Check the music" found in this visit; empty until it ran.
  const [checked, setChecked] = useState<ResultMap>(new Map());

  const chainOpts = useMemo(
    () => ({ source: musicSource, spotifyUsable: spotifyConnected, dead: deadRecordings() }),
    // A finished check changes which recordings are known dead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [musicSource, spotifyConnected, checked],
  );

  // The plan's session length and difficulty apply to what is shown and to what is ridden.
  const scaledBase = useMemo(
    () => (plan ? applyPlanSettings(workout, planSettings) : workout),
    [workout, plan, planSettings],
  );
  // The music matched in this visit ("Match music") goes on top; an Experience has its own.
  const soundtrack = useSoundtrackOverlay(scaledBase, chainOpts);
  const saveFailed = useSoundtrackSession((s) => s.saveFailed);
  // The song order of this ride: the saved one again, or a new one drawn (kept after the ride).
  const hasSaved = useSoundtrackSession((s) => s.saved[workout.id] !== undefined);
  const drawn = useSoundtrackSession((s) => s.drawn[workout.id] === true);
  const orderCatalog = useSoundtrackCatalog(hasSaved);
  const drawOrder = (): void => {
    if (orderCatalog.status === 'ready') drawNewOrder(scaledBase, orderCatalog.catalog);
  };
  const scaled = useMemo(
    () =>
      experience ? withUserMusic(scaledBase, experience, matched, chainOpts) : soundtrack.workout,
    [scaledBase, experience, matched, chainOpts, soundtrack.workout],
  );
  // The queue of every slot in the scenario's own order (main upload first): what the music check
  // judges, so a dead main upload shows as "backup only" and is not hidden by the re-ordering the
  // ride itself does with the known-dead recordings.
  const chains = useMemo(
    () =>
      experience
        ? chainChoices(workout, experience, matched, {
            source: musicSource,
            spotifyUsable: spotifyConnected,
          })
        : {},
    [workout, experience, matched, musicSource, spotifyConnected],
  );
  const unplayable = experience ? redSlots(experience, workout, chains, checked) : [];
  const segments = useMemo(
    () => flattenWorkout(scaled, settings.effortTable, resolveResistanceMode(settings)),
    [scaled, settings],
  );
  const cueCount = effectiveMusicCues(scaled).length;
  const hasCues = cueCount > 0;
  const text = localizedText(workout, lang);
  const hasPlayers = selected.length > 0;
  const layout = effectiveLayout(background, chosenHud, experience !== undefined);
  const ridersOk = ridersAvailable(layout, hasPlayers);
  const ridersHint = ridersHintKey(layout, hasPlayers);

  const setAdvanced = (open: boolean): void => {
    setAdvancedOpen(open);
    saveAdvancedOpen(open);
  };

  /**
   * Opens the accordion and brings it into view (the "More" shortcut and the Start notice); with a
   * target id it goes to that part instead and moves focus to its first control.
   */
  const showAdvanced = (targetId?: string): void => {
    setAdvanced(true);
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    window.requestAnimationFrame(() => {
      const target = targetId ? document.getElementById(targetId) : null;
      (target ?? advancedRef.current)?.scrollIntoView({
        block: 'start',
        behavior: calm ? 'auto' : 'smooth',
      });
      target?.querySelector<HTMLElement>('input, button, select')?.focus({ preventScroll: true });
    });
  };

  const togglePlayer = (id: string): void => {
    setSelected((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      return cur.length >= MAX_SESSION_PLAYERS ? cur : [...cur, id];
    });
    setShowRiders(true); // picking someone means showing them
  };

  /** Throws when the rider could not be stored, so the form can say so and nobody gets selected. */
  const addPlayer = async (p: Player): Promise<void> => {
    const repos = await getRepositories();
    await repos.players.put(p);
    setPlayers((cur) => [...cur, p]);
    setSelected((cur) => (cur.length >= MAX_SESSION_PLAYERS ? cur : [...cur, p.id]));
    setShowRiders(true);
    setAdding(false);
  };

  const youtubeTrimmed = youtubeUrl.trim();
  const youtubeInvalid =
    background === 'youtube' && (youtubeTrimmed === '' || parseYoutubeUrl(youtubeTrimmed) === null);

  const start = (): void => {
    if (youtubeInvalid) return;
    // Starting without answering the bike question is the answer: it is not asked again.
    if (!settings.bikeSetupDone)
      void updateSettings({ bikeSetupDone: true }).catch(() => undefined);
    const config = buildConfig(
      {
        background,
        hud: experience ? layout : chosenHud,
        showRiders,
        playerIds: selected,
        music,
        ...(background === 'youtube' ? { youtubeUrl: youtubeTrimmed } : {}),
      },
      hasCues,
    );
    const runtime = buildRuntime(scaled, segments, config, pickPlayers(players, selected), plan);
    // The choices on this screen are for this ride only (they live in the runtime); the saved
    // defaults change in Settings. Only the list of recent links is remembered.
    if (config.youtubeUrl) {
      updateSettings({
        recentYoutubeUrls: addRecentYoutubeUrl(settings.recentYoutubeUrls, config.youtubeUrl),
      }).catch((err) => console.warn('Saving the recent links failed', err));
    }
    useSessionStore.getState().load({
      ...runtime,
      options: {
        sounds: beeps,
        coach,
        ...(background === 'hyperride' ? { world } : {}),
        ...(experience && background === 'hyperride' && world === 'scenes'
          ? { experienceId: experience.id }
          : {}),
      },
    });
    navigate('/train');
  };

  const peak = peakEffort(segments);
  const musicOn = music && hasCues;
  const mode = experience ? 'world' : plan ? 'plan' : 'free';
  const sourceKey = (['youtube', 'spotify', 'auto'] as const).find((k) => k === musicSource);
  const layoutLabel = t(layoutLabelKey(layout));
  const musicStatus = !hasCues
    ? t('setup.musicStatusNone')
    : musicOn
      ? t('setup.musicStatusOn', { source: t(`setup.source.${sourceKey ?? 'youtube'}`) })
      : t('setup.musicStatusOff');
  const bikeName = t(BIKE_LABEL[bikeKind]);

  /** Opens the wizard on the ride as it is shown here (a plan's length and difficulty included). */
  const openSoundtrack = (): void => {
    useSoundtrackSession.getState().setWorkout(workout.id, scaledBase);
    navigate(`/soundtrack/${encodeURIComponent(workout.id)}?from=setup`);
  };

  const musicGroup = (
    <Group title={t('setup.group.music')} id="setup-music">
      <SettingRow>
        <Toggle
          label={t('setup.musicInRide')}
          checked={musicOn}
          onChange={setMusic}
          disabled={!hasCues}
        />
      </SettingRow>
      {!experience && totalDurationSec(scaledBase) >= MIN_WIZARD_SEC && (
        <div
          className={styles.matchRow}
          data-testid="setup-soundtrack"
          data-state={soundtrack.state}
        >
          <p className={styles.note}>
            {soundtrack.state === 'ready'
              ? t('soundtrack.setup.on', { songs: soundtrack.songs })
              : soundtrack.state === 'stale'
                ? t(
                    soundtrack.staleReason === 'ownSongGone'
                      ? 'soundtrack.setup.staleOwnSong'
                      : 'soundtrack.setup.stale',
                  )
                : soundtrack.state === 'loading'
                  ? t('soundtrack.setup.loading')
                  : soundtrack.state === 'error'
                    ? t('soundtrack.setup.error')
                    : t('soundtrack.setup.none')}
          </p>
          {musicOn && hasSaved && (soundtrack.state === 'ready' || drawn) && (
            <div className={styles.matchOrder} data-testid="setup-song-order">
              <div className={styles.orderSeg}>
                <Segmented
                  label={t('soundtrack.setup.order')}
                  value={drawn ? 'new' : 'last'}
                  options={[
                    { value: 'last', label: t('soundtrack.setup.orderLast') },
                    {
                      value: 'new',
                      label: t('soundtrack.setup.orderNew'),
                      disabled: orderCatalog.status !== 'ready',
                    },
                  ]}
                  onChange={(v) => (v === 'new' ? drawOrder() : replaySavedOrder(workout.id))}
                />
              </div>
              <p className={styles.note}>
                {t(drawn ? 'soundtrack.setup.orderNewHelp' : 'soundtrack.setup.orderLastHelp')}
              </p>
              {drawn && (
                <Button onClick={drawOrder} data-testid="setup-song-order-again">
                  {t('soundtrack.setup.orderAgain')}
                </Button>
              )}
            </div>
          )}
          {saveFailed && (
            <p className={styles.note} role="status" data-testid="setup-soundtrack-unsaved">
              {t('soundtrack.setup.unsaved')}
            </p>
          )}
          <div className={styles.matchActions}>
            <Button onClick={openSoundtrack} data-testid="setup-match-music">
              {soundtrack.state === 'none'
                ? t('soundtrack.entry')
                : soundtrack.state === 'stale'
                  ? t('soundtrack.setup.rematch')
                  : t('soundtrack.setup.change')}
            </Button>
            {soundtrack.state !== 'none' && (
              <Button onClick={() => void forgetPlan(workout.id)} data-testid="setup-match-remove">
                {t('soundtrack.setup.remove')}
              </Button>
            )}
          </div>
        </div>
      )}
      {!hasCues && (
        <p className={styles.note} data-testid="music-hint">
          {t('setup.musicDisabled')}
        </p>
      )}
      {experience && (
        <>
          <SettingRow
            topic={t('experience.check.source.label')}
            help={
              <>
                <p>{t('setup.sourceHelp')}</p>
                {!spotifyConnected && (
                  <p>
                    <Link to="/settings" data-testid="exp-music-connect">
                      {t('experience.music.connect')}
                    </Link>
                  </p>
                )}
              </>
            }
          >
            <MusicSourceSelect />
          </SettingRow>
          <ExperienceMusicCheck
            experience={experience}
            workout={workout}
            chains={chains}
            results={checked}
            onResults={setChecked}
            spotifyConnected={spotifyConnected}
          />
          <ExperienceMusic
            experience={experience}
            workout={workout}
            connected={spotifyConnected}
            choices={matched}
            onChoices={setMatched}
          />
        </>
      )}
    </Group>
  );

  const layoutOpts = layoutOptions(background, experience !== undefined);
  // An Experience keeps to what matters: a layout and Lite. The riders appear on their own once
  // someone is picked, and the world and its scenes are fixed by the scenario.
  const experienceScreenGroup = (
    <Group title={t('setup.group.screen')}>
      <SettingRow topic={t('setup.layout')} help={t('setup.layoutHelp')}>
        <label htmlFor="setup-layout-select">{t('setup.layout')}</label>
        <select
          id="setup-layout-select"
          value={layout}
          data-testid="setup-layout-select"
          onChange={(e) => setChosenHud(e.target.value as LayoutKind)}
        >
          {layoutOpts.map((o) => (
            <option key={o.value} value={o.value}>
              {t(o.labelKey)}
            </option>
          ))}
        </select>
      </SettingRow>
      <SettingRow topic={t('experience.lite')} help={t('experience.liteHint')}>
        <Toggle
          label={t('experience.lite')}
          checked={background === 'basic'}
          onChange={(on) => setBackground(on ? 'basic' : 'hyperride')}
        />
      </SettingRow>
    </Group>
  );

  const screenGroup = (
    <Group title={t('setup.group.screen')}>
      <div>
        <h4 className={styles.label}>{t('setup.layout')}</h4>
        <div className={styles.layoutSeg}>
          <Segmented
            label={t('setup.layout')}
            value={layout}
            options={layoutOptions(background, experience !== undefined).map((o) => ({
              value: o.value,
              label: t(o.labelKey),
            }))}
            onChange={setChosenHud}
          />
        </div>
        <div className={styles.ridersRow}>
          <Toggle
            label={t('setup.riders')}
            checked={ridersOk && showRiders}
            onChange={setShowRiders}
            disabled={!ridersOk}
          />
        </div>
        {ridersHint && (
          <p className={styles.note} data-testid="layout-hint">
            {t(ridersHint)}
          </p>
        )}
      </div>

      <div>
        <h4 className={styles.label}>{t('setup.background')}</h4>
        <div className={styles.tiles}>
          {BACKGROUNDS.map((b) => {
            const enabled = ENABLED_BACKGROUNDS.includes(b.value);
            return (
              <button
                key={b.value}
                type="button"
                disabled={!enabled}
                aria-pressed={background === b.value}
                onClick={() => setBackground(b.value)}
                className={`${styles.tile} ${background === b.value ? styles.tileOn : ''}`}
              >
                <span className={`${styles.thumb} ${styles[`thumb_${b.value}`] ?? ''}`}>
                  {b.value === 'basic' && <b>{peak}</b>}
                  {b.value === 'youtube' && <Icon name="play" size={20} />}
                </span>
                <span className={styles.tileName}>
                  {t(b.labelKey)}
                  {!enabled && <small> · {t('setup.soon')}</small>}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {!experience && background === 'hyperride' && (
        <div>
          <h4 className={styles.label}>{t('setup.world')}</h4>
          <Segmented
            label={t('setup.world')}
            value={world}
            options={WORLD_CHOICES.map((w) => ({ value: w.value, label: t(w.labelKey) }))}
            onChange={setWorld}
          />
        </div>
      )}

      {!experience && background === 'youtube' && (
        <div id="setup-youtube" data-testid="youtube-section">
          <Field
            label={t('setup.youtubeUrl')}
            {...(youtubeTrimmed !== '' && youtubeInvalid
              ? { error: t('setup.youtubeInvalid') }
              : { hint: t('setup.youtubeHint') })}
          >
            {(id) => (
              <input
                id={id}
                type="url"
                inputMode="url"
                placeholder="https://www.youtube.com/watch?v=…"
                value={youtubeUrl}
                aria-invalid={youtubeTrimmed !== '' && youtubeInvalid}
                onChange={(e) => setYoutubeUrl(e.target.value)}
              />
            )}
          </Field>
          {settings.recentYoutubeUrls.length > 0 && (
            <div>
              <h5 className={styles.recentTitle}>{t('setup.youtubeRecent')}</h5>
              <ul className={styles.recent} aria-label={t('setup.youtubeRecent')}>
                {settings.recentYoutubeUrls.map((u) => (
                  <li key={u}>
                    <button type="button" onClick={() => setYoutubeUrl(u)}>
                      {u}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Group>
  );

  const coachGroup = (
    <Group title={t('setup.group.coach')}>
      <SettingRow>
        <Toggle label={t('setup.beeps')} checked={beeps} onChange={setBeeps} />
      </SettingRow>
      <SettingRow topic={t('setup.coachCues')} help={t('setup.coachCuesHelp')}>
        <Toggle label={t('setup.coachCues')} checked={coach} onChange={setCoach} />
      </SettingRow>
    </Group>
  );

  const gearGroup = (
    <Group title={t('setup.group.gear')}>
      <div className={styles.gearRow}>
        <span>{t('setup.bikeRow')}</span>
        <button
          type="button"
          className={styles.linkBtn}
          onClick={() => setBikeOpen(true)}
          data-testid="setup-bike-edit"
          aria-label={`${t('setup.bikeEdit')}: ${bikeName}`}
        >
          {bikeName} <Icon name="edit" size={15} />
        </button>
      </div>
    </Group>
  );

  return (
    <div data-testid="setup-screen" data-mode={mode} className={styles.page}>
      <AppBar />

      <div className={styles.grid}>
        <Card className={styles.summary}>
          {plan && (
            <span
              data-testid="setup-badge"
              className={`${styles.badge} ${plan.slot === 'progres' ? styles.progres : styles.freestyle}`}
            >
              {t('setup.badgeWeek', {
                kind: t(plan.slot === 'progres' ? 'tag.progres' : 'tag.freestyle'),
                n: plan.week,
              })}
            </span>
          )}
          {experience && (
            <p className={styles.kicker} data-testid="setup-experience">
              {t('experience.kicker')}
            </p>
          )}
          <h1>{experience ? experienceText(experience, lang).title : text.name}</h1>
          {workout.source.kind === 'user' && (
            <Link
              to={`/editor/${encodeURIComponent(workout.id)}`}
              className={styles.editLink}
              data-testid="setup-edit"
            >
              {t('editor.edit')}
            </Link>
          )}
          <div className={styles.chart}>
            <ProfileChart segments={segments} height="clamp(4.5rem, 16vw, 6.875rem)" thick />
          </div>
          <div className={styles.stats}>
            <div>
              <b data-testid="setup-time">{formatClock(totalSec(segments))}</b>
              <span>{t('setup.time')}</span>
            </div>
            {experience ? (
              <div>
                <b data-testid="setup-songs">{scaled.songs?.length ?? 0}</b>
                <span>{t('setup.songs')}</span>
              </div>
            ) : (
              <div>
                <b data-testid="setup-blocks">{segments.length}</b>
                <span>{t('setup.blocks')}</span>
              </div>
            )}
            <div>
              <b className={styles.peak}>{peak}</b>
              <span>{t('setup.peak')}</span>
            </div>
          </div>
          {!experience && (
            <p className={styles.music}>
              {hasCues ? t('setup.musicSome', { n: cueCount }) : t('setup.musicNone')}
            </p>
          )}
        </Card>

        <div className={styles.options}>
          <section aria-labelledby="setup-who" className={styles.whoCard}>
            <h2 id="setup-who" className={styles.who}>
              {t('setup.who')}
            </h2>
            <div className={styles.chips}>
              {players.map((p) => {
                const on = selected.includes(p.id);
                return (
                  <Chip
                    key={p.id}
                    on={on}
                    className={styles.person}
                    disabled={!on && selected.length >= MAX_SESSION_PLAYERS}
                    onClick={() => togglePlayer(p.id)}
                  >
                    <span className={styles.avatar} aria-hidden="true">
                      {p.name.trim().charAt(0).toUpperCase()}
                    </span>
                    {showsWatts ? t('setup.watts', { name: p.name, ftp: p.ftp }) : p.name}
                  </Chip>
                );
              })}
              <Chip
                className={`${styles.person} ${styles.add}`}
                onClick={() => setAdding((v) => !v)}
                aria-expanded={adding}
              >
                <Icon name="plus" size={16} />
                {t('setup.add')}
              </Chip>
            </div>
            {selected.length >= MAX_SESSION_PLAYERS && (
              <p className={styles.note}>{t('setup.maxPlayers')}</p>
            )}
            {adding && (
              <AddPlayerForm
                showsWatts={showsWatts}
                onAdd={addPlayer}
                onCancel={() => setAdding(false)}
              />
            )}
            {!experience && !settings.bikeSetupDone && !trainerConnected && (
              <p className={styles.info} data-testid="bike-line">
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={() => setBikeOpen(true)}
                  data-testid="bike-open"
                  aria-label={`${t('setup.bikeEdit')}: ${bikeName}`}
                >
                  {t('setup.bikeLine', { bike: bikeName })} <Icon name="edit" size={14} />
                </button>
              </p>
            )}
            <div className={styles.devices}>
              <DevicesPanel variant="compact" showTrainer showWatts={showsWatts} />
            </div>
          </section>

          <AdvancedPanel
            chipBar={!experience}
            open={advancedOpen}
            onToggle={setAdvanced}
            panelRef={advancedRef}
            hint={t(experience ? 'setup.advancedHintExperience' : 'setup.advancedHint')}
            left={
              <>
                {musicGroup}
                {experience ? experienceScreenGroup : screenGroup}
              </>
            }
            right={
              <>
                {coachGroup}
                {gearGroup}
              </>
            }
          />
        </div>
      </div>

      <StartBar
        variant={experience ? 'status' : 'shortcuts'}
        status={musicStatus}
        music={{
          label: t('setup.music'),
          icon: musicOn ? 'volume' : 'mute',
          pressed: musicOn,
          disabled: !hasCues,
          onClick: () => setMusic(!musicOn),
          testId: 'bar-music',
        }}
        layout={{
          label: layoutLabel,
          icon: 'layout',
          ariaLabel: t('setup.layoutChip', { layout: layoutLabel }),
          onClick: () => setLayoutOpen(true),
          testId: 'bar-layout',
        }}
        more={{
          label: t('setup.more'),
          icon: 'settings',
          onClick: () => showAdvanced(),
          testId: 'bar-more',
        }}
        {...(youtubeInvalid
          ? {
              notice: {
                text: t('setup.youtubeNeeded'),
                action: t('setup.fix'),
                onAction: () => showAdvanced('setup-youtube'),
              },
            }
          : unplayable.length > 0
            ? {
                notice: {
                  text: t('setup.musicBlocked'),
                  action: t('setup.fix'),
                  onAction: () => showAdvanced('setup-music'),
                },
              }
            : {})}
        disabled={youtubeInvalid || unplayable.length > 0}
        onStart={start}
      />

      {layoutOpen && (
        <Modal title={t('setup.layout')} onClose={() => setLayoutOpen(false)}>
          <div className={styles.layoutSeg}>
            <Segmented
              label={t('setup.layout')}
              value={layout}
              options={layoutOptions(background, experience !== undefined).map((o) => ({
                value: o.value,
                label: t(o.labelKey),
              }))}
              onChange={(v) => {
                setChosenHud(v);
                setLayoutOpen(false);
              }}
            />
          </div>
        </Modal>
      )}
      {bikeOpen && <BikeWizard onClose={() => setBikeOpen(false)} />}
    </div>
  );
}

function AddPlayerForm({
  showsWatts,
  onAdd,
  onCancel,
}: {
  /** Whether the bike measures power; if not, only the name is asked for. */
  showsWatts: boolean;
  onAdd: (p: Player) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useT();
  const [name, setName] = useState('');
  const [ftp, setFtp] = useState('');
  const [errors, setErrors] = useState<{ name?: string; ftp?: string; save?: string }>({});
  const [saving, setSaving] = useState(false);
  // A ref, not just state: a second submit can arrive before React re-renders with saving=true.
  const inFlight = useRef(false);

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (inFlight.current) return;
    const trimmed = ftp.trim();
    const parsed = playerSchema.safeParse({
      id: newId(),
      name,
      ftp: !showsWatts ? DEFAULT_PLAYER_FTP : trimmed === '' ? Number.NaN : Number(trimmed),
    });
    if (!parsed.success) {
      const fields = new Set(parsed.error.issues.map((i) => i.path[0]));
      setErrors({
        ...(fields.has('name') ? { name: t('setup.nameError') } : {}),
        ...(fields.has('ftp') ? { ftp: t('setup.ftpError') } : {}),
      });
      return;
    }
    setErrors({});
    inFlight.current = true;
    setSaving(true);
    onAdd(parsed.data)
      .catch((err) => {
        console.warn('Saving the new player failed', err);
        setErrors({ save: t('setup.saveError') });
      })
      .finally(() => {
        inFlight.current = false;
        setSaving(false);
      });
  };

  return (
    <form className={styles.addForm} onSubmit={submit} noValidate data-testid="add-player-form">
      <Field label={t('setup.playerName')} {...(errors.name ? { error: errors.name } : {})}>
        {(id) => (
          <input
            id={id}
            value={name}
            maxLength={24}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        )}
      </Field>
      {showsWatts && (
        <SettingRow topic={t('setup.playerFtp')} help={t('setup.ftpHelp')}>
          <Field label={t('setup.playerFtp')} {...(errors.ftp ? { error: errors.ftp } : {})}>
            {(id) => (
              <input
                id={id}
                inputMode="numeric"
                value={ftp}
                onChange={(e) => setFtp(e.target.value)}
              />
            )}
          </Field>
        </SettingRow>
      )}
      {errors.save && (
        <p role="alert" className={styles.saveError}>
          {errors.save}
        </p>
      )}
      <div className={styles.addButtons}>
        <Button onClick={onCancel}>{t('setup.playerCancel')}</Button>
        <Button type="submit" variant="primary" disabled={saving}>
          {t('setup.playerSave')}
        </Button>
      </div>
    </form>
  );
}
