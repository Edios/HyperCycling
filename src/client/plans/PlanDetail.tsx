import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  DEFAULT_PLAN_SETTINGS,
  type Plan,
  type PlanLayout,
  type PlanProgress,
  type PlanSlot,
  type PlanSettings,
} from '../../domain/plan';
import type { Player } from '../../domain/player';
import { scaleForPlan } from '../../domain/scale';
import { flattenWorkout } from '../../domain/segments';
import type { Workout } from '../../domain/workout';
import { builtinPlans } from '../data/builtin';
import { localizedText } from '../data/localized';
import { getRepositories } from '../data/repositories';
import { useLibrary } from '../data/useLibrary';
import { useSettings } from '../data/useSettings';
import { useLang, useT, type MessageKey } from '../i18n';
import { minutesOf } from '../select/model';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Field } from '../ui/Field';
import { Modal } from '../ui/Modal';
import { ProfileChart } from '../ui/ProfileChart';
import { Segmented } from '../ui/Segmented';
import { Toast } from '../ui/Toast';
import { activatePlan } from './activate-plan';
import { effectiveSession } from './effective-session';
import { LoadBars } from './LoadBars';
import { PlanCalendar } from './PlanCalendar';
import { hoursPerWeek, planLoad, testWeeks } from './model';
import { useWeeksLabel } from './useWeeksLabel';
import styles from './PlanDetail.module.css';

const LENGTHS = [30, 45, 60] as const;
const DIFFICULTIES = [-5, 0, 5] as const;
const LAYOUTS: readonly PlanLayout[] = ['progresFreestyle', 'doubleProgres', 'plusFreestyle'];
const LAYOUT_KEY: Record<PlanLayout, MessageKey> = {
  progresFreestyle: 'plans.layoutProgresFreestyle',
  doubleProgres: 'plans.layoutDoubleProgres',
  plusFreestyle: 'plans.layoutPlusFreestyle',
};

interface Loaded {
  progress: PlanProgress | undefined;
  me: Player | undefined;
}

/** Route `/plans/:planId`: load, preview and customize one plan, then start or update it. */
export function PlanDetail() {
  const { planId } = useParams();
  const t = useT();
  const { loaded: settingsLoaded } = useSettings();
  const plan = builtinPlans.find((p) => p.id === planId);
  const [data, setData] = useState<Loaded | undefined>();

  useEffect(() => {
    if (!plan) return undefined;
    let live = true;
    void (async () => {
      let progress: PlanProgress | undefined;
      let me: Player | undefined;
      try {
        const repos = await getRepositories();
        progress = await repos.planProgress.get(plan.id);
        me = (await repos.players.list()).find((p) => p.isMe);
      } catch (err) {
        console.warn('Loading plan data failed', err);
      }
      if (live) setData({ progress, me });
    })();
    return () => {
      live = false;
    };
  }, [plan]);

  if (!plan) {
    return (
      <div className={styles.page}>
        <p>{t('plans.missing')}</p>
        <Link to="/plans">{t('plans.back')}</Link>
      </div>
    );
  }
  if (!settingsLoaded || !data) return <div className={styles.page} aria-busy="true" />;
  return <Editor key={plan.id} plan={plan} data={data} />;
}

function Editor({ plan, data }: { plan: Plan; data: Loaded }) {
  const t = useT();
  const [lang] = useLang();
  const navigate = useNavigate();
  const weeksLabel = useWeeksLabel();
  const { settings } = useSettings();
  const { workouts } = useLibrary();
  const isActive = settings.activePlanId === plan.id;
  const stored = data.progress?.settings;

  const [cfg, setCfg] = useState<PlanSettings>(stored ?? DEFAULT_PLAN_SETTINGS);
  const [pickWeek, setPickWeek] = useState((stored?.startWeek ?? 1) > 1);
  const [ftpText, setFtpText] = useState(data.me ? String(data.me.ftp) : '');
  const [confirming, setConfirming] = useState<false | 'choose' | 'reset'>(false);
  const [error, setError] = useState<string | undefined>();

  const equipment = settings.equipment;
  const text = localizedText(plan, lang);
  const byId = useMemo(() => new Map(workouts.map((w) => [w.id, w])), [workouts]);
  const load = useMemo(() => planLoad(plan), [plan]);
  const tests = useMemo(
    () => testWeeks(plan, equipment, cfg.layout, cfg.skipFirstTest),
    [plan, equipment, cfg.layout, cfg.skipFirstTest],
  );
  const lightWeeks = plan.weeks.flatMap((w, i) => (w.light ? [i + 1] : []));

  const ftpValue = Number(ftpText);
  const ftpDirty = ftpText.trim() !== '' && ftpValue !== data.me?.ftp;
  const ftpError = ftpDirty && (!Number.isInteger(ftpValue) || ftpValue < 50 || ftpValue > 600);

  const set = (patch: Partial<PlanSettings>): void => setCfg((c) => ({ ...c, ...patch }));

  const previewWeek = cfg.startWeek;
  const slots: { slot: PlanSlot; label: MessageKey; cls: string | undefined }[] = [
    { slot: 'progres', label: 'tag.progres', cls: styles.progres },
    cfg.layout === 'doubleProgres'
      ? { slot: 'freestyle', label: 'tag.progres', cls: styles.progres }
      : { slot: 'freestyle', label: 'tag.freestyle', cls: styles.freestyle },
  ];

  async function commit(mode: 'keep' | 'reset'): Promise<void> {
    try {
      await activatePlan({
        plan,
        settings: cfg,
        mode,
        ftp: equipment.showsWatts && ftpDirty && !ftpError ? ftpValue : undefined,
        meName: t('plans.me'),
        currentActiveId: settings.activePlanId,
      });
    } catch (err) {
      console.warn('Saving the plan failed', err);
      setConfirming(false);
      setError(t('plans.saveFailed'));
      return;
    }
    navigate('/');
  }

  const doneCount = data.progress?.entries.filter((e) => e.status === 'done').length ?? 0;
  const doneCat = new Intl.PluralRules(lang).select(doneCount);
  const doneLabel = t(
    doneCat === 'one'
      ? 'plans.doneOne'
      : doneCat === 'few'
        ? 'plans.doneFew'
        : doneCat === 'many'
          ? 'plans.doneMany'
          : 'plans.doneOther',
    { n: doneCount },
  );
  const otherActive = settings.activePlanId !== undefined && !isActive;
  const hasProgress = !isActive && data.progress !== undefined;

  function onPrimary(): void {
    if (otherActive || hasProgress) setConfirming('choose');
    else void commit('keep');
  }

  const current = builtinPlans.find((p) => p.id === settings.activePlanId);

  return (
    <div className={styles.page}>
      <div className={styles.left}>
        <Link to="/plans" className={styles.back}>
          ‹ {t('plans.title')}
        </Link>
        <div className={styles.head}>
          <div>
            <h1>{text.name}</h1>
            <div className={styles.mut}>
              {t('plans.headerMeta', {
                weeks: plan.loop
                  ? t('plans.looping', { weeks: weeksLabel(plan.weeks.length) })
                  : weeksLabel(plan.weeks.length),
                audience: t(`plans.audience.${plan.level}` as MessageKey),
              })}
            </div>
          </div>
          <div className={styles.hours} data-testid="plan-hours">
            {t('plans.hoursPerWeek', {
              hours: new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(
                hoursPerWeek(cfg.sessionMinutes, cfg.layout),
              ),
            })}
            <span> {t('plans.perWeek')}</span>
          </div>
        </div>

        <Card className={styles.panel}>
          <div className={styles.row}>
            <h3>{t('plans.loadTitle')}</h3>
            <span className={styles.mut}>
              {[
                lightWeeks.length > 0 && t('plans.lightWeeks', { weeks: lightWeeks.join(', ') }),
                tests.length > 0 && t('plans.testWeeks', { weeks: tests.join(', ') }),
              ]
                .filter(Boolean)
                .join(', ')}
            </span>
          </div>
          <LoadBars
            testId="load-chart"
            load={load}
            light={plan.weeks.map((w) => w.light)}
            height="9.5rem"
            labels={plan.weeks.map((_, i) =>
              tests.includes(i + 1)
                ? `${t('plan.weekShort', { n: i + 1 })} · ${t('plans.testLabel')}`
                : t('plan.weekShort', { n: i + 1 }),
            )}
          />
        </Card>

        <Card className={styles.panel}>
          <div className={styles.row}>
            <h3>{t('plans.previewTitle', { week: previewWeek })}</h3>
            <span className={styles.mut}>{t('plans.preview')}</span>
          </div>
          <div className={styles.previews}>
            {slots.map(({ slot, label, cls }) => (
              <Preview
                key={slot}
                testId={`preview-${slot}`}
                badge={t(label)}
                badgeClass={cls}
                workout={byId.get(
                  effectiveSession(
                    plan,
                    previewWeek,
                    slot,
                    equipment,
                    cfg.layout,
                    cfg.skipFirstTest,
                  ) ?? '',
                )}
                cfg={cfg}
              />
            ))}
          </div>
        </Card>
      </div>

      <Card className={styles.cfg} data-testid="customize">
        <h2>{t('plans.customize')}</h2>

        <div className={styles.group}>
          <span className={styles.lbl}>{t('plans.sessionLength')}</span>
          <Segmented
            label={t('plans.sessionLength')}
            value={String(cfg.sessionMinutes)}
            options={LENGTHS.map((m) => ({
              value: String(m),
              label: t('plans.minutes', { n: m }),
            }))}
            onChange={(v) => set({ sessionMinutes: Number(v) as PlanSettings['sessionMinutes'] })}
          />
          <small className={styles.hint}>{t('plans.sessionLengthHint')}</small>
        </div>

        <div className={styles.group}>
          <span className={styles.lbl}>{t('plans.difficulty')}</span>
          <Segmented
            label={t('plans.difficulty')}
            value={String(cfg.difficulty)}
            options={DIFFICULTIES.map((d) => ({
              value: String(d),
              label: t(d < 0 ? 'plans.easier' : d > 0 ? 'plans.harder' : 'plans.standard'),
            }))}
            onChange={(v) => set({ difficulty: Number(v) as PlanSettings['difficulty'] })}
          />
        </div>

        <div className={styles.group}>
          <span className={styles.lbl}>{t('plans.layout')}</span>
          <Segmented
            label={t('plans.layout')}
            value={cfg.layout}
            options={LAYOUTS.map((l) => ({ value: l, label: t(LAYOUT_KEY[l]) }))}
            onChange={(layout) => set({ layout })}
          />
        </div>

        <div className={styles.group}>
          <span className={styles.lbl}>{t('plans.startFrom')}</span>
          <Segmented
            label={t('plans.startFrom')}
            value={pickWeek ? 'pick' : 'first'}
            options={[
              { value: 'first', label: t('plans.startFirst') },
              { value: 'pick', label: t('plans.startPick') },
            ]}
            onChange={(v) => {
              setPickWeek(v === 'pick');
              if (v === 'first') set({ startWeek: 1 });
            }}
          />
          {pickWeek && (
            <Field label={t('plans.startWeek')}>
              {(id) => (
                <select
                  id={id}
                  className={styles.select}
                  value={cfg.startWeek}
                  onChange={(e) => set({ startWeek: Number(e.target.value) })}
                >
                  {plan.weeks.map((_, i) => (
                    <option key={i} value={i + 1}>
                      {t('plan.weekShort', { n: i + 1 })}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
        </div>

        {equipment.showsWatts && (
          <div className={styles.group}>
            <Field
              label={t('plans.ftp')}
              hint={t('plans.ftpHint')}
              error={ftpError ? t('plans.ftpError') : undefined}
            >
              {(id) => (
                <input
                  id={id}
                  type="number"
                  inputMode="numeric"
                  className={styles.ftp}
                  value={ftpText}
                  onChange={(e) => setFtpText(e.target.value)}
                />
              )}
            </Field>
          </div>
        )}

        <PlanCalendar plan={plan} settings={cfg} equipment={equipment} />

        <div className={styles.foot}>
          <span className={styles.mut}>{t('plans.changeLater')}</span>
          <Button variant="primary" size="big" disabled={ftpError} onClick={onPrimary}>
            {isActive ? t('plans.saveChanges') : t('plans.startPlan')}
          </Button>
        </div>
      </Card>

      {confirming === 'choose' && (
        <Modal title={t('plans.confirmTitle')} onClose={() => setConfirming(false)}>
          {otherActive && (
            <p>
              {t('plans.confirmBody', {
                current: current ? localizedText(current, lang).name : '',
              })}
            </p>
          )}
          {hasProgress && <p>{t('plans.existingBody', { done: doneLabel })}</p>}
          <div className={styles.modalButtons}>
            <Button onClick={() => setConfirming(false)}>{t('plans.cancel')}</Button>
            {hasProgress ? (
              <>
                <Button onClick={() => setConfirming('reset')}>{t('plans.startOver')}</Button>
                <Button variant="primary" onClick={() => void commit('keep')}>
                  {t('plans.continue')}
                </Button>
              </>
            ) : (
              <Button variant="primary" onClick={() => void commit('keep')}>
                {t('plans.confirmYes', { name: text.name })}
              </Button>
            )}
          </div>
        </Modal>
      )}
      {confirming === 'reset' && (
        <Modal title={t('plans.resetTitle')} onClose={() => setConfirming(false)}>
          <p>{t('plans.resetBody')}</p>
          <div className={styles.modalButtons}>
            <Button onClick={() => setConfirming('choose')}>{t('plans.cancel')}</Button>
            <Button variant="primary" onClick={() => void commit('reset')}>
              {t('plans.resetYes')}
            </Button>
          </div>
        </Modal>
      )}
      {error && <Toast message={error} onClose={() => setError(undefined)} />}
    </div>
  );
}

interface PreviewProps {
  testId: string;
  badge: string;
  badgeClass: string | undefined;
  workout: Workout | undefined;
  cfg: PlanSettings;
}

function Preview({ testId, badge, badgeClass, workout, cfg }: PreviewProps) {
  const t = useT();
  const [lang] = useLang();
  const { settings } = useSettings();
  const scaled = useMemo<Workout | undefined>(() => {
    if (!workout) return undefined;
    try {
      return scaleForPlan(workout, cfg);
    } catch (err) {
      console.warn('Scaling the preview failed, showing it unscaled', err);
      return workout;
    }
  }, [workout, cfg]);
  const segments = useMemo(
    () => (scaled ? flattenWorkout(scaled, settings.effortTable) : []),
    [scaled, settings.effortTable],
  );
  return (
    <div data-testid={testId}>
      <div className={styles.row}>
        <span className={styles.pname}>
          <span className={badgeClass}>{badge}</span> ·{' '}
          {workout ? localizedText(workout, lang).name : ''}
        </span>
        <span className={styles.pmin} data-testid={`${testId}-minutes`}>
          {scaled ? minutesOf(scaled) : '-'} {t('common.min')}
        </span>
      </div>
      <div className={styles.pchart}>
        <ProfileChart segments={segments} height="4rem" />
      </div>
    </div>
  );
}
