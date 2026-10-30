import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { localizedText } from '../data/localized';
import { builtinPlans } from '../data/builtin';
import { useSettings } from '../data/useSettings';
import { useLang, useT, type MessageKey } from '../i18n';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Chip } from '../ui/Chip';
import { LoadBars } from './LoadBars';
import { matchesFilter, planLoad, typicalMinutes, type LevelFilter } from './model';
import { useWeeksLabel } from './useWeeksLabel';
import styles from './PlanGallery.module.css';

const LEVEL_ORDER = ['beginner', 'intermediate', 'short', 'any'] as const;
const FILTERS: readonly LevelFilter[] = ['all', 'beginner', 'intermediate', 'short'];

/** Plans screen: four cards with the weekly load, level filter chips, Choose / Customize. */
export function PlanGallery() {
  const t = useT();
  const [lang] = useLang();
  const navigate = useNavigate();
  const { settings } = useSettings();
  const weeksLabel = useWeeksLabel();
  const [filter, setFilter] = useState<LevelFilter>('all');

  const loads = useMemo(() => new Map(builtinPlans.map((p) => [p.id, planLoad(p)])), []);
  const visible = builtinPlans
    .filter((p) => matchesFilter(p, filter))
    .sort((a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level));

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1>{t('plans.title')}</h1>
        <div role="group" aria-label={t('plans.filterLabel')} className={styles.chips}>
          {FILTERS.map((f) => (
            <Chip key={f} on={f === filter} onClick={() => setFilter(f)}>
              {t(`plans.filters.${f}` as MessageKey)}
            </Chip>
          ))}
        </div>
      </div>
      <p className={styles.intro}>{t('plans.intro')}</p>

      <div className={styles.grid}>
        {visible.map((plan) => {
          const text = localizedText(plan, lang);
          const active = plan.id === settings.activePlanId;
          const weeks = weeksLabel(plan.weeks.length);
          return (
            <Card
              key={plan.id}
              data-testid="plan-card"
              data-plan={plan.id}
              data-active={active}
              className={`${styles.card} ${active ? styles.active : ''}`}
            >
              <div className={styles.level}>
                <span>{t(`plans.level.${plan.level}` as MessageKey)}</span>
                {active && <b>{t('plans.active')}</b>}
              </div>
              <h2>{text.name}</h2>
              <div className={styles.meta}>
                {t('plans.cardMeta', {
                  weeks: plan.loop ? t('plans.looping', { weeks }) : weeks,
                  minutes: typicalMinutes(plan),
                })}
              </div>
              <p className={styles.desc}>{text.description}</p>
              <div className={styles.bars}>
                <LoadBars
                  load={loads.get(plan.id) ?? []}
                  light={plan.weeks.map((w) => w.light)}
                  height="5.5rem"
                />
              </div>
              <Button
                size="big"
                className={styles.btn}
                onClick={() => navigate(`/plans/${encodeURIComponent(plan.id)}`)}
              >
                {active ? t('plans.customizeBtn') : t('plans.chooseBtn')}
                <span className={styles.sr}> {text.name}</span>
              </Button>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
