import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { newId } from '../../domain/ids';
import type { HyperrideWorldId } from '../../domain/settings';
import { DEFAULT_PLAN_SETTINGS, type PlanSettings } from '../../domain/plan';
import { playerSchema, type Player } from '../../domain/player';
import { flattenWorkout } from '../../domain/segments';
import { getRepositories } from '../data/repositories';
import { localizedText } from '../data/localized';
import { useLibrary } from '../data/useLibrary';
import { useSettings } from '../data/useSettings';
import { useLang, useT, type MessageKey } from '../i18n';
import { WORLD_CHOICES } from '../hyperride/world-options';
import { useSessionStore } from '../training/session-store';
import { formatClock } from '../training/format';
import { AppBar } from '../ui/AppBar';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Chip } from '../ui/Chip';
import { Field } from '../ui/Field';
import { ProfileChart } from '../ui/ProfileChart';
import { Segmented } from '../ui/Segmented';
import { Toggle } from '../ui/Toggle';
import { parseYoutubeUrl } from '../youtube/parseYoutubeUrl';
import {
  addRecentYoutubeUrl,
  applyPlanSettings,
  buildConfig,
  buildRuntime,
  effectiveLayout,
  ENABLED_BACKGROUNDS,
  layoutOptions,
  initialSelection,
  MAX_SESSION_PLAYERS,
  parsePlanRef,
  peakEffort,
  pickPlayers,
  ridersAvailable,
  ridersHintKey,
  totalSec,
  type Background,
} from './model';
import { layoutKindOf, type LayoutKind } from '../training/overlay-layouts';
import styles from './SetupScreen.module.css';

const BACKGROUNDS: readonly { value: Background; labelKey: MessageKey }[] = [
  { value: 'basic', labelKey: 'setup.backgroundBasic' },
  { value: 'hyperride', labelKey: 'setup.backgroundHyperride' },
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
      planSettings={plan ? planSettings : DEFAULT_PLAN_SETTINGS}
      initialPlayers={players}
    />
  );
}

interface SetupFormProps {
  workout: ReturnType<typeof useLibrary>['workouts'][number];
  plan: ReturnType<typeof parsePlanRef>;
  planSettings: PlanSettings;
  initialPlayers: Player[];
}

function SetupForm({ workout, plan, planSettings, initialPlayers }: SetupFormProps) {
  const t = useT();
  const [lang] = useLang();
  const navigate = useNavigate();
  const { settings, updateSettings } = useSettings();
  const last = settings.lastSession;

  const [players, setPlayers] = useState(initialPlayers);
  const [background, setBackground] = useState<Background>(last?.background ?? 'basic');
  // The Settings default layout, also with a preselected rider.
  const [chosenHud, setChosenHud] = useState<LayoutKind | undefined>(
    last ? layoutKindOf(last.hud, last.background) : undefined,
  );
  const [showRiders, setShowRiders] = useState(
    last?.showRiders ?? (last !== undefined && last.hud !== 'solo'),
  );
  const [selected, setSelected] = useState<string[]>(() =>
    initialSelection(initialPlayers, last?.playerIds),
  );
  const [beeps, setBeeps] = useState(settings.sounds);
  const [coach, setCoach] = useState(settings.coach);
  const [music, setMusic] = useState(last?.music ?? false);
  const [world, setWorld] = useState<HyperrideWorldId>(settings.hyperrideWorld);
  const [adding, setAdding] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState(last?.youtubeUrl ?? '');

  // The plan's session length and difficulty apply to what is shown and to what is ridden.
  const scaled = useMemo(
    () => (plan ? applyPlanSettings(workout, planSettings) : workout),
    [workout, plan, planSettings],
  );
  const segments = useMemo(
    () => flattenWorkout(scaled, settings.effortTable),
    [scaled, settings.effortTable],
  );
  const cueCount = scaled.musicCues.length;
  const hasCues = cueCount > 0;
  const text = localizedText(workout, lang);
  const hasPlayers = selected.length > 0;
  const layout = effectiveLayout(background, chosenHud);
  const ridersOk = ridersAvailable(layout, hasPlayers);
  const ridersHint = ridersHintKey(layout, hasPlayers);

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
    const config = buildConfig(
      {
        background,
        hud: chosenHud,
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
      options: { sounds: beeps, coach, ...(background === 'hyperride' ? { world } : {}) },
    });
    navigate('/train');
  };

  const peak = peakEffort(segments);

  return (
    <div data-testid="setup-screen" className={styles.page}>
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
          <h1>{text.name}</h1>
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
            <ProfileChart segments={segments} height="6.875rem" thick />
          </div>
          <div className={styles.stats}>
            <div>
              <b data-testid="setup-time">{formatClock(totalSec(segments))}</b>
              <span>{t('setup.time')}</span>
            </div>
            <div>
              <b data-testid="setup-blocks">{segments.length}</b>
              <span>{t('setup.blocks')}</span>
            </div>
            <div>
              <b className={styles.peak}>{peak}</b>
              <span>{t('setup.peak')}</span>
            </div>
          </div>
          <p className={styles.music}>
            {hasCues ? t('setup.musicSome', { n: cueCount }) : t('setup.musicNone')}
          </p>
        </Card>

        <div className={styles.options}>
          <section>
            <h2 className={styles.label}>{t('setup.background')}</h2>
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
                      {b.value === 'youtube' && <span aria-hidden="true">▶</span>}
                    </span>
                    <span className={styles.tileName}>
                      {t(b.labelKey)}
                      {!enabled && <small> · {t('setup.soon')}</small>}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {background === 'hyperride' && (
            <section>
              <h2 className={styles.label}>{t('setup.world')}</h2>
              <Segmented
                label={t('setup.world')}
                value={world}
                options={WORLD_CHOICES.map((w) => ({ value: w.value, label: t(w.labelKey) }))}
                onChange={setWorld}
              />
            </section>
          )}

          {background === 'youtube' && (
            <section data-testid="youtube-section">
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
                  <h3 className={styles.recentTitle}>{t('setup.youtubeRecent')}</h3>
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
            </section>
          )}

          <section>
            <h2 className={styles.label}>{t('setup.layout')}</h2>
            <Segmented
              label={t('setup.layout')}
              value={layout}
              options={layoutOptions(background).map((o) => ({
                value: o.value,
                label: t(o.labelKey),
              }))}
              onChange={setChosenHud}
            />
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
          </section>

          <section>
            <h2 className={styles.label}>{t('setup.who')}</h2>
            <div className={styles.chips}>
              {players.map((p) => {
                const on = selected.includes(p.id);
                return (
                  <Chip
                    key={p.id}
                    on={on}
                    disabled={!on && selected.length >= MAX_SESSION_PLAYERS}
                    onClick={() => togglePlayer(p.id)}
                  >
                    {t('setup.watts', { name: p.name, ftp: p.ftp })}
                  </Chip>
                );
              })}
              <Chip className={styles.add} onClick={() => setAdding((v) => !v)}>
                {t('setup.add')}
              </Chip>
            </div>
            {selected.length >= MAX_SESSION_PLAYERS && (
              <p className={styles.note}>{t('setup.maxPlayers')}</p>
            )}
            {adding && <AddPlayerForm onAdd={addPlayer} onCancel={() => setAdding(false)} />}
          </section>

          <Card className={styles.toggles}>
            <Toggle label={t('setup.beeps')} checked={beeps} onChange={setBeeps} />
            <Toggle label={t('setup.coachCues')} checked={coach} onChange={setCoach} />
            <Toggle
              label={t('setup.music')}
              checked={music && hasCues}
              onChange={setMusic}
              disabled={!hasCues}
            />
            {!hasCues && (
              <p className={styles.note} data-testid="music-hint">
                {t('setup.musicDisabled')}
              </p>
            )}
          </Card>

          <div className={styles.startRow}>
            <span className={styles.note}>{t('setup.remembered')}</span>
            <Button variant="primary" size="big" onClick={start} disabled={youtubeInvalid}>
              {t('setup.start')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AddPlayerForm({
  onAdd,
  onCancel,
}: {
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
      ftp: trimmed === '' ? Number.NaN : Number(trimmed),
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
      <Field label={t('setup.playerFtp')} {...(errors.ftp ? { error: errors.ftp } : {})}>
        {(id) => (
          <input id={id} inputMode="numeric" value={ftp} onChange={(e) => setFtp(e.target.value)} />
        )}
      </Field>
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
