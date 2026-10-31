import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { DEFAULT_PLAN_SETTINGS, type Plan, type PlanProgress } from '../../domain/plan';
import type { Player } from '../../domain/player';
import { flattenWorkout } from '../../domain/segments';
import { builtinPlans } from '../data/builtin';
import { localizedText } from '../data/localized';
import { getRepositories } from '../data/repositories';
import { useSettings } from '../data/useSettings';
import { RAMP_TEST_ID } from '../plans/effective-session';
import { useLang, useT } from '../i18n';
import { formatClock } from '../training/format';
import { useLastResult, type LastResult } from '../training/last-result';
import { AppBar } from '../ui/AppBar';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Chip } from '../ui/Chip';
import { Field } from '../ui/Field';
import { ProfileChart } from '../ui/ProfileChart';
import { Toggle } from '../ui/Toggle';
import { countTarget, meOf, proposeFtp, setupPath, withFtp } from './model';
import { saveSessionLog, syncPlanEntry } from './persist';
import styles from './SummaryScreen.module.css';

/** Route /summary. Redirects home when there is no finished session to show. */
export function SummaryScreen() {
  const result = useLastResult((s) => s.result);
  if (!result) return <Navigate to="/" replace />;
  return <Summary result={result} />;
}

function fresh(planId: string): PlanProgress {
  return {
    id: planId,
    planId,
    startedAt: new Date().toISOString(),
    settings: DEFAULT_PLAN_SETTINGS,
    entries: [],
  };
}

function Summary({ result }: { result: LastResult }) {
  const t = useT();
  const [lang] = useLang();
  const navigate = useNavigate();
  const { settings, loaded } = useSettings();

  const segments = useMemo(
    () => flattenWorkout(result.workout, settings.effortTable),
    [result.workout, settings.effortTable],
  );
  const totalSec = segments.reduce((s, x) => s + x.durationSec, 0);

  // The plan the ride can count toward: the one it was started from, else the active plan.
  const planId = result.plan?.planId ?? settings.activePlanId;
  const plan: Plan | undefined = useMemo(
    () => (planId === undefined ? undefined : builtinPlans.find((p) => p.id === planId)),
    [planId],
  );
  const [progress, setProgress] = useState<PlanProgress | undefined>();
  useEffect(() => {
    if (!plan) return undefined;
    let live = true;
    void (async () => {
      try {
        const repos = await getRepositories();
        const p = await repos.planProgress.get(plan.id);
        if (live) setProgress(p ?? fresh(plan.id));
      } catch (err) {
        console.warn('Loading plan progress failed', err);
      }
    })();
    return () => {
      live = false;
    };
  }, [plan]);

  const target = useMemo(
    () => (loaded ? countTarget(result, plan, progress, totalSec) : undefined),
    [loaded, result, plan, progress, totalSec],
  );
  const [override, setOverride] = useState<boolean | undefined>();
  const counted = target !== undefined && (override ?? target.defaultOn);

  // Everything is saved as soon as the screen opens (a closed tab loses nothing); the toggle
  // adds or removes the plan entry, and the buttons only navigate. Both calls are idempotent.
  useEffect(() => {
    void saveSessionLog(result);
  }, [result]);
  useEffect(() => {
    if (target) void syncPlanEntry(result, target, counted);
  }, [result, target, counted]);

  const leave = (to: string, clear: boolean): void => {
    navigate(to);
    if (clear) useLastResult.getState().clear();
  };

  const name = localizedText(result.workout, lang).name;
  const showFtp = result.workout.id === RAMP_TEST_ID && settings.equipment.showsWatts;

  return (
    <main data-testid="summary-screen" className={styles.page}>
      <AppBar />
      <div className={styles.inner}>
        <h1 className={styles.heading}>
          <span data-testid="summary-name">{name}</span>
          {' · '}
          <span data-testid="summary-status">
            {result.completed ? t('summary.completed') : t('summary.ended')}
          </span>
        </h1>
        <p className={styles.time} data-testid="summary-ridden" aria-label={t('summary.ridden')}>
          {formatClock(result.riddenSec, { round: 'floor' })}
        </p>
        <div className={styles.chart}>
          <ProfileChart segments={segments} height="5.625rem" pastSec={result.riddenSec} thick />
        </div>
        {result.players.length > 0 && (
          <div className={styles.chips} data-testid="summary-players">
            {result.players.map((p) => (
              <Chip key={p.id} disabled>
                {p.name}
              </Chip>
            ))}
          </div>
        )}

        {target && (
          <Card className={styles.count}>
            <Toggle label={t('summary.countTitle')} checked={counted} onChange={setOverride} />
            <p className={styles.detail} data-testid="count-detail">
              {t('summary.countDetail', {
                plan: localizedText(target.plan, lang).name,
                week: target.week,
                slot: t(target.slot === 'progres' ? 'tag.progres' : 'tag.freestyle'),
              })}
            </p>
          </Card>
        )}

        {showFtp && <FtpCard />}

        <div className={styles.buttons}>
          <Button onClick={() => leave(setupPath(result), false)}>{t('summary.again')}</Button>
          <Button variant="primary" onClick={() => leave('/', true)}>
            {t('summary.backToPlan')}
          </Button>
        </div>
      </div>
    </main>
  );
}

/** Ramp test: the best 1-minute power gives a proposed FTP (75 %) for the rider. */
function FtpCard() {
  const t = useT();
  const [players, setPlayers] = useState<Player[]>([]);
  const [best, setBest] = useState('');
  const [riderId, setRiderId] = useState('');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | undefined>();

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const repos = await getRepositories();
        const list = await repos.players.list();
        if (live) setPlayers(list);
      } catch (err) {
        console.warn('Loading players failed', err);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const me = meOf(players);
  const rider = me ?? players.find((p) => p.id === riderId);
  const proposal = proposeFtp(best);

  const save = async (): Promise<void> => {
    if (!rider) {
      setMessage({ kind: 'error', text: t('summary.ftpChoose') });
      return;
    }
    if (proposal === undefined) {
      setMessage({ kind: 'error', text: t('summary.ftpBestError') });
      return;
    }
    const updated = withFtp(rider, proposal);
    if (!updated) {
      setMessage({ kind: 'error', text: t('summary.ftpError') });
      return;
    }
    try {
      const repos = await getRepositories();
      await repos.players.put(updated);
      setPlayers((cur) => cur.map((p) => (p.id === updated.id ? updated : p)));
      setMessage({ kind: 'ok', text: t('summary.ftpSaved') });
    } catch (err) {
      console.warn('Saving the FTP failed', err);
      setMessage({ kind: 'error', text: t('summary.ftpSaveFailed') });
    }
  };

  return (
    <Card className={styles.ftp} data-testid="ftp-card">
      <h2>{t('summary.ftpTitle')}</h2>
      <Field label={t('summary.ftpBest')}>
        {(id) => (
          <input
            id={id}
            inputMode="numeric"
            value={best}
            onChange={(e) => {
              setBest(e.target.value);
              setMessage(undefined);
            }}
          />
        )}
      </Field>
      {proposal !== undefined && (
        <p className={styles.proposal} data-testid="ftp-proposal">
          {t('summary.ftpProposal', { ftp: proposal })}
        </p>
      )}
      {!me && players.length > 0 && (
        <Field label={t('summary.ftpWho')}>
          {(id) => (
            <select id={id} value={riderId} onChange={(e) => setRiderId(e.target.value)}>
              <option value="" />
              {players.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      {message && (
        <p role={message.kind === 'error' ? 'alert' : 'status'} className={styles.message}>
          {message.text}
        </p>
      )}
      <Button onClick={() => void save()}>{t('summary.ftpSave')}</Button>
    </Card>
  );
}
