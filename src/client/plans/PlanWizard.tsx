import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { bpmRange, estimateHrMax, HR_ZONES } from '../../domain/hr-zones';
import type { Plan, PlanProgress, PlanSettings } from '../../domain/plan';
import type { Player } from '../../domain/player';
import {
  GOAL_PLAN,
  recommendPlan,
  type FtpAnswer,
  type WizardGoal,
} from '../../domain/plan-wizard';
import { builtinPlans } from '../data/builtin';
import { localizedText } from '../data/localized';
import { getRepositories } from '../data/repositories';
import { updateSettings, useSettings } from '../data/useSettings';
import { useLang, useT, type MessageKey } from '../i18n';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Modal } from '../ui/Modal';
import { Toast } from '../ui/Toast';
import { activatePlan } from './activate-plan';
import { LoadBars } from './LoadBars';
import { DayPicker } from './DayPicker';
import { PlanCalendar } from './PlanCalendar';
import { planLoad, typicalMinutes } from './model';
import { useWeeksLabel } from './useWeeksLabel';
import styles from './PlanWizard.module.css';

const GOALS: readonly WizardGoal[] = ['backToForm', 'buildForm', 'keepFit', 'shortOnTime'];
const DAYS = [2, 3] as const;
const MINUTES = [30, 45, 60] as const;
type FtpKind = FtpAnswer['kind'];
const STEP_KEYS = [
  'wizard.stepGoal',
  'wizard.stepTime',
  'wizard.stepFtp',
  'wizard.stepHr',
  'wizard.stepDone',
] as const;
const LAST = STEP_KEYS.length - 1;

function planFor(goal: WizardGoal): Plan | undefined {
  return builtinPlans.find((p) => p.id === GOAL_PLAN[goal]);
}

function goalOfPlan(planId: string): WizardGoal | undefined {
  return GOALS.find((g) => GOAL_PLAN[g] === planId);
}

function validHrMax(text: string): number | undefined {
  const n = Number(text);
  return text.trim() !== '' && Number.isInteger(n) && n >= 100 && n <= 230 ? n : undefined;
}

function validFtp(text: string): number | undefined {
  const n = Number(text);
  return text.trim() !== '' && Number.isInteger(n) && n >= 50 && n <= 600 ? n : undefined;
}

/** Route `/plans/wizard`: loads what the questions are prefilled from, then runs the steps. */
export function PlanWizard() {
  const { loaded } = useSettings();
  const [me, setMe] = useState<Player | undefined | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      let found: Player | undefined;
      try {
        const repos = await getRepositories();
        found = (await repos.players.list()).find((p) => p.isMe);
      } catch (err) {
        console.warn('Loading the rider profile failed', err);
      }
      if (live) setMe(found);
    })();
    return () => {
      live = false;
    };
  }, []);

  if (!loaded || me === null) return <div className={styles.page} aria-busy="true" />;
  return <Wizard me={me} />;
}

/** Adds the optional fixed weekdays to a recommendation; nothing is added when none are chosen. */
function withDays<R extends { settings: PlanSettings }>(rec: R, trainingDays: number[]): R {
  return trainingDays.length === 0 ? rec : { ...rec, settings: { ...rec.settings, trainingDays } };
}

function Wizard({ me }: { me: Player | undefined }) {
  const t = useT();
  const [lang] = useLang();
  const navigate = useNavigate();
  const weeksLabel = useWeeksLabel();
  const { settings } = useSettings();

  const [step, setStep] = useState(0);
  const [goal, setGoal] = useState<WizardGoal | undefined>();
  const [days, setDays] = useState<2 | 3>(3);
  const [minutes, setMinutes] = useState<30 | 45 | 60>(45);
  const [trainingDays, setTrainingDays] = useState<number[]>([]);
  const [pickedKind, setPickedKind] = useState<FtpKind | undefined>();
  const [ftpText, setFtpText] = useState(me ? String(me.ftp) : '');
  const [hrText, setHrText] = useState(me?.hrMax !== undefined ? String(me.hrMax) : '');
  const [ageText, setAgeText] = useState('');
  const [confirming, setConfirming] = useState<false | 'choose' | 'reset'>(false);
  const [existing, setExisting] = useState<PlanProgress | undefined>();
  const [error, setError] = useState<string | undefined>();
  const heading = useRef<HTMLHeadingElement>(null);

  // A bike that already reports no watts starts on that answer.
  const ftpKind: FtpKind = pickedKind ?? (settings.equipment.showsWatts ? 'unknown' : 'noWatts');
  const ftpValue = validFtp(ftpText);
  const ftpAnswer: FtpAnswer =
    ftpKind === 'known' && ftpValue !== undefined
      ? { kind: 'known', ftp: ftpValue }
      : ftpKind === 'known'
        ? { kind: 'unknown' }
        : { kind: ftpKind };

  const hrBlank = hrText.trim() === '';
  const hrValue = validHrMax(hrText);

  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  const rec = useMemo(
    () =>
      goal
        ? withDays(
            recommendPlan({ goal, daysPerWeek: days, minutes, ftp: ftpAnswer }, builtinPlans),
            trainingDays,
          )
        : undefined,
    // ftpAnswer is rebuilt each render from these two primitives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [goal, days, minutes, trainingDays, ftpKind, ftpValue],
  );
  const plan = rec ? builtinPlans.find((p) => p.id === rec.planId) : undefined;
  const planName = plan ? localizedText(plan, lang).name : '';
  const alt = builtinPlans.find((p) => p.id === rec?.alternativePlanId);
  const altGoal = alt ? goalOfPlan(alt.id) : undefined;
  const altName = alt ? localizedText(alt, lang).name : '';
  const equipment = { ...settings.equipment, showsWatts: ftpKind !== 'noWatts' };

  const canGoOn =
    step === 0
      ? goal !== undefined
      : step === 2
        ? ftpKind !== 'known' || ftpValue !== undefined
        : step === 3
          ? hrBlank || hrValue !== undefined
          : true;

  function weeksOf(p: Plan): string {
    const label = weeksLabel(p.weeks.length);
    return p.loop ? t('plans.looping', { weeks: label }) : label;
  }

  async function onStart(): Promise<void> {
    if (!rec || !plan) return;
    let progress: PlanProgress | undefined;
    try {
      const repos = await getRepositories();
      progress = await repos.planProgress.get(plan.id);
    } catch (err) {
      console.warn('Loading plan progress failed', err);
    }
    const isActive = settings.activePlanId === plan.id;
    const otherActive = settings.activePlanId !== undefined && !isActive;
    // The active plan is only asked about once it holds entries that new settings could invalidate.
    const hasProgress = progress !== undefined && (!isActive || progress.entries.length > 0);
    setExisting(hasProgress ? progress : undefined);
    if (otherActive || hasProgress) setConfirming('choose');
    else await commit('keep');
  }

  async function commit(mode: 'keep' | 'reset'): Promise<void> {
    if (!rec || !plan) return;
    const before = settings.equipment;
    const wantWatts = ftpKind !== 'noWatts';
    let equipmentChanged = false;
    try {
      if (before.showsWatts !== wantWatts) {
        await updateSettings({ equipment: { ...before, showsWatts: wantWatts } });
        equipmentChanged = true;
      }
      await activatePlan({
        plan,
        settings: rec.settings,
        mode,
        ftp: ftpAnswer.kind === 'known' ? ftpAnswer.ftp : undefined,
        ...(hrValue !== undefined ? { hrMax: hrValue } : {}),
        meName: t('plans.me'),
        currentActiveId: settings.activePlanId,
      });
    } catch (err) {
      console.warn('Saving the plan failed', err);
      if (equipmentChanged) {
        await updateSettings({ equipment: before }).catch((e: unknown) =>
          console.warn('Restoring the equipment failed', e),
        );
      }
      setConfirming(false);
      setError(t('plans.saveFailed'));
      return;
    }
    navigate('/');
  }

  const doneCount = existing?.entries.filter((e) => e.status === 'done').length ?? 0;
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
  const current = builtinPlans.find((p) => p.id === settings.activePlanId);
  const otherActive = current !== undefined && current.id !== plan?.id;

  return (
    <main className={styles.page} data-testid="plan-wizard">
      <header className={styles.top}>
        <h2>{t('wizard.title')}</h2>
        <Link to="/" className={styles.cancel}>
          {t('wizard.cancel')}
        </Link>
      </header>
      <ol className={styles.steps} aria-label={t('wizard.stepsLabel')}>
        {STEP_KEYS.map((key, i) => (
          <li
            key={key}
            data-testid="wizard-step"
            aria-current={i === step ? 'step' : undefined}
            className={i < step ? styles.done : i === step ? styles.cur : undefined}
          >
            <span className={styles.sr}>{t(key)}</span>
          </li>
        ))}
      </ol>
      <div className={styles.stepLabel}>
        <b>{step < LAST ? t('wizard.stepOf', { n: step + 1 }) : t('wizard.ready')}</b>
        {t(STEP_KEYS[step] ?? 'wizard.stepGoal')}
      </div>

      <div className={styles.body}>
        {step === 0 && (
          <>
            <h1 ref={heading} tabIndex={-1}>
              {t('wizard.goal.title')}
            </h1>
            <p className={styles.sub}>{t('wizard.goal.sub')}</p>
            <div role="radiogroup" aria-label={t('wizard.goal.title')} className={styles.options}>
              {GOALS.map((g) => {
                const p = planFor(g);
                if (!p) return null;
                return (
                  <Choice
                    key={g}
                    checked={goal === g}
                    name="goal"
                    onSelect={() => setGoal(g)}
                    className={styles.goalCard}
                  >
                    <span className={styles.goalText}>
                      <b className={styles.title}>{localizedText(p, lang).name}</b>
                      <span className={styles.desc}>{t(`wizard.goal.${g}` as MessageKey)}</span>
                      <span className={styles.meta}>
                        {t('wizard.goal.meta', { weeks: weeksOf(p), minutes: typicalMinutes(p) })}
                      </span>
                    </span>
                    <span className={styles.mini} aria-hidden="true">
                      <LoadBars
                        load={planLoad(p)}
                        light={p.weeks.map((w) => w.light)}
                        height="2.5rem"
                      />
                    </span>
                  </Choice>
                );
              })}
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h1 ref={heading} tabIndex={-1}>
              {t('wizard.time.title')}
            </h1>
            <h3 className={styles.q}>{t('wizard.time.daysTitle')}</h3>
            <p className={styles.hint}>{t('wizard.time.daysHint')}</p>
            <div role="radiogroup" aria-label={t('wizard.time.daysTitle')} className={styles.tiles}>
              {DAYS.map((d) => (
                <Choice
                  key={d}
                  name="days"
                  checked={days === d}
                  label={t('wizard.time.days', { n: d })}
                  onSelect={() => setDays(d)}
                  className={styles.tile}
                >
                  <b>{d}</b>
                  <small>{t('wizard.time.daysUnit')}</small>
                </Choice>
              ))}
            </div>
            <h3 className={styles.q}>{t('plans.trainingDays')}</h3>
            <div className={styles.dayPick}>
              <DayPicker value={trainingDays} onChange={setTrainingDays} sessions={days} />
            </div>
            <h3 className={styles.q}>{t('wizard.time.minutesTitle')}</h3>
            <p className={styles.hint}>{t('wizard.time.minutesHint')}</p>
            <div
              role="radiogroup"
              aria-label={t('wizard.time.minutesTitle')}
              className={styles.tiles}
            >
              {MINUTES.map((m) => (
                <Choice
                  key={m}
                  name="minutes"
                  checked={minutes === m}
                  label={t('plans.minutes', { n: m })}
                  onSelect={() => setMinutes(m)}
                  className={styles.tile}
                >
                  <b>{m}</b>
                  <small>{t('common.min')}</small>
                </Choice>
              ))}
            </div>
            {rec && plan && (
              <div className={styles.fit} data-testid="wizard-fit" role="status">
                <b>{t('wizard.time.fits', { name: planName })}</b>
                <span>
                  {t('wizard.time.fitsBody', {
                    weeks: weeksOf(plan),
                    days,
                    minutes,
                  })}
                </span>
                {alt && altGoal && (
                  <span className={styles.better}>
                    {t('wizard.time.better', { minutes, name: altName })}
                    <button type="button" className={styles.link} onClick={() => setGoal(altGoal)}>
                      {t('wizard.time.switchTo', { name: altName })}
                    </button>
                  </span>
                )}
              </div>
            )}
          </>
        )}

        {step === 2 && (
          <>
            <h1 ref={heading} tabIndex={-1}>
              {t('wizard.ftp.title')}
            </h1>
            <p className={styles.sub}>{t('wizard.ftp.sub')}</p>
            <div role="radiogroup" aria-label={t('wizard.ftp.title')} className={styles.options}>
              <div className={styles.ftpCard} data-checked={ftpKind === 'known'}>
                <Choice
                  name="ftp"
                  checked={ftpKind === 'known'}
                  onSelect={() => setPickedKind('known')}
                  className={styles.ftpHead}
                >
                  <b className={styles.title}>{t('wizard.ftp.yes')}</b>
                </Choice>
                <div className={styles.ftpInput}>
                  <input
                    type="number"
                    inputMode="numeric"
                    aria-label={t('wizard.ftp.input')}
                    aria-invalid={ftpKind === 'known' && ftpValue === undefined}
                    value={ftpText}
                    onFocus={() => setPickedKind('known')}
                    onChange={(e) => {
                      setPickedKind('known');
                      setFtpText(e.target.value);
                    }}
                  />
                  <span aria-hidden="true">{t('wizard.ftp.unit')}</span>
                </div>
                {ftpKind === 'known' && ftpValue === undefined ? (
                  <small className={styles.err} role="alert">
                    {t('wizard.ftp.error')}
                  </small>
                ) : (
                  me && <small className={styles.note}>{t('wizard.ftp.yesHint')}</small>
                )}
              </div>
              <div className={styles.ftpCard} data-checked={ftpKind === 'unknown'}>
                <Choice
                  name="ftp"
                  checked={ftpKind === 'unknown'}
                  onSelect={() => setPickedKind('unknown')}
                  className={styles.ftpHead}
                >
                  <b className={styles.title}>{t('wizard.ftp.no')}</b>
                </Choice>
                <p className={styles.desc}>{t('wizard.ftp.noBody')}</p>
                {ftpKind === 'unknown' && (
                  <>
                    <div className={styles.testNote}>
                      <b>20′</b>
                      <span>
                        {t('wizard.ftp.noTest', {
                          weeks: plan ? weeksOf(plan) : '',
                        })}
                      </span>
                    </div>
                    <Link to="/settings" className={styles.link}>
                      {t('wizard.ftp.guide')}
                    </Link>
                  </>
                )}
              </div>
              <div className={styles.ftpCard} data-checked={ftpKind === 'noWatts'}>
                <Choice
                  name="ftp"
                  checked={ftpKind === 'noWatts'}
                  onSelect={() => setPickedKind('noWatts')}
                  className={styles.ftpHead}
                >
                  <b className={styles.title}>{t('wizard.ftp.noWatts')}</b>
                </Choice>
                <p className={styles.desc}>{t('wizard.ftp.noWattsBody')}</p>
              </div>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h1 ref={heading} tabIndex={-1}>
              {t('wizard.hr.title')}
            </h1>
            <p className={styles.sub}>{t('wizard.hr.sub')}</p>
            <div className={styles.ftpCard}>
              <div className={styles.ftpInput}>
                <input
                  type="number"
                  inputMode="numeric"
                  aria-label={t('wizard.hr.input')}
                  aria-invalid={!hrBlank && hrValue === undefined}
                  value={hrText}
                  onChange={(e) => setHrText(e.target.value)}
                />
                <span aria-hidden="true">{t('wizard.hr.unit')}</span>
              </div>
              <div className={styles.ftpInput}>
                <input
                  type="number"
                  inputMode="numeric"
                  aria-label={t('wizard.hr.age')}
                  value={ageText}
                  onChange={(e) => setAgeText(e.target.value)}
                />
                <Button
                  disabled={!(Number(ageText) > 0)}
                  onClick={() => setHrText(String(estimateHrMax(Number(ageText))))}
                >
                  {t('wizard.hr.fromAge')}
                </Button>
              </div>
              {!hrBlank && hrValue === undefined && (
                <small className={styles.err} role="alert">
                  {t('players.hrMaxError')}
                </small>
              )}
              {hrValue !== undefined && (
                <ul className={styles.hrBars} data-testid="hr-preview">
                  {HR_ZONES.map((z) => {
                    const r = bpmRange(z.zone, hrValue);
                    return (
                      <li key={z.zone} data-zone={z.zone}>
                        <b>{`Z${z.zone}`}</b> <span>{t(`hr.zone${z.zone}`)}</span>{' '}
                        <span>
                          {r.min}–{r.max} {t('hr.bpm')}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <p className={styles.note}>{t('wizard.hr.skipHint')}</p>
          </>
        )}

        {step === LAST && rec && plan && (
          <div className={styles.summary}>
            <div className={styles.summaryMain}>
              <Card hero className={styles.planCard}>
                <span className={styles.badge}>{t('tag.progres')}</span>
                <h1 ref={heading} tabIndex={-1}>
                  {planName}
                </h1>
                <div className={styles.meta}>
                  {t('wizard.summaryMeta', {
                    weeks: weeksOf(plan),
                    days,
                    minutes,
                  })}
                </div>
              </Card>
              <p className={styles.reason} data-testid="wizard-reason">
                {t(rec.reason.key as MessageKey, {
                  ...rec.reason.params,
                  weeks: weeksOf(plan),
                })}
              </p>
            </div>
            <Card className={styles.calendar}>
              <PlanCalendar plan={plan} settings={rec.settings} equipment={equipment} />
            </Card>
          </div>
        )}
      </div>

      <div className={styles.actions}>
        {step < LAST && !canGoOn && (
          <p className={styles.pickHint} role="status">
            {t('wizard.pickToContinue')}
          </p>
        )}
        {step > 0 && <Button onClick={() => setStep(step - 1)}>{t('wizard.back')}</Button>}
        {step < LAST ? (
          <Button
            variant="primary"
            className={styles.grow}
            disabled={!canGoOn}
            onClick={() => setStep(step + 1)}
          >
            {t('wizard.next')}
          </Button>
        ) : (
          <>
            <Button
              onClick={() =>
                rec &&
                navigate(`/plans/${encodeURIComponent(rec.planId)}`, {
                  state: {
                    settings: rec.settings,
                    ftp: ftpAnswer.kind === 'known' ? ftpAnswer.ftp : undefined,
                    showsWatts: ftpKind !== 'noWatts',
                  },
                })
              }
            >
              {t('wizard.customize')}
            </Button>
            <Button variant="primary" className={styles.grow} onClick={() => void onStart()}>
              {t('wizard.start')}
            </Button>
          </>
        )}
      </div>

      {confirming === 'choose' && plan && (
        <Modal title={t('plans.confirmTitle')} onClose={() => setConfirming(false)}>
          {otherActive && current && (
            <p>{t('plans.confirmBody', { current: localizedText(current, lang).name })}</p>
          )}
          {existing && <p>{t('plans.existingBody', { done: doneLabel })}</p>}
          <div className={styles.modalButtons}>
            <Button onClick={() => setConfirming(false)}>{t('plans.cancel')}</Button>
            {existing ? (
              <>
                <Button onClick={() => setConfirming('reset')}>{t('plans.startOver')}</Button>
                <Button variant="primary" onClick={() => void commit('keep')}>
                  {t('plans.continue')}
                </Button>
              </>
            ) : (
              <Button variant="primary" onClick={() => void commit('keep')}>
                {t('plans.confirmYes', { name: planName })}
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
    </main>
  );
}

interface ChoiceProps {
  name: string;
  checked: boolean;
  onSelect: () => void;
  className: string | undefined;
  /** Accessible name when the visible content is not a good one. */
  label?: string;
  children: ReactNode;
}

/** A radio presented as a large touch target: a native input keeps arrow-key behaviour. */
function Choice({ name, checked, onSelect, className, label, children }: ChoiceProps) {
  return (
    <label className={`${styles.choice} ${className ?? ''}`} data-checked={checked}>
      <input
        type="radio"
        name={name}
        className={styles.sr}
        checked={checked}
        aria-label={label}
        onChange={onSelect}
      />
      <span className={styles.mark} aria-hidden="true" />
      {children}
    </label>
  );
}
