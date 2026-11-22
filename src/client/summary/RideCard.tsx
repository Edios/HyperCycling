import { useMemo, useState } from 'react';
import type { RideRecord } from '../../domain/ride';
import { triggerDownload } from '../data/import-export';
import { useT } from '../i18n';
import { formatClock } from '../training/format';
import { rideFileName } from '../training/ride-recorder';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Toggle } from '../ui/Toggle';
import styles from './RideCard.module.css';

const CHART_W = 600;
const CHART_H = 90;
/** At most this many points per line, however long the ride. */
const CHART_POINTS = 300;

/** Power and target over the ride, both on the same watt scale (gaps break the power line). */
function tracePaths(ride: RideRecord): { power: string; target: string } | null {
  const { power, targetW } = ride.samples;
  const n = power.length;
  if (n < 2) return null;
  let top = 0;
  for (const v of power) if (v !== null && v > top) top = v;
  for (const v of targetW) if (v !== null && v > top) top = v;
  if (top <= 0) return null;
  top *= 1.1;
  const step = Math.max(1, Math.ceil(n / CHART_POINTS));
  const line = (values: readonly (number | null)[]): string => {
    let d = '';
    let pen = false;
    for (let i = 0; i < n; i += step) {
      // Average of the bucket, ignoring gaps; an empty bucket lifts the pen.
      let sum = 0;
      let k = 0;
      for (let j = i; j < Math.min(n, i + step); j++) {
        const v = values[j];
        if (v === null || v === undefined) continue;
        sum += v;
        k += 1;
      }
      if (k === 0) {
        pen = false;
        continue;
      }
      const x = ((i / (n - 1)) * CHART_W).toFixed(1);
      const y = (CHART_H - (sum / k / top) * CHART_H).toFixed(1);
      d += `${pen ? 'L' : 'M'}${x} ${y}`;
      pen = true;
    }
    return d;
  };
  return { power: line(power), target: line(targetW) };
}

function Stat({ label, value, id }: { label: string; value: string; id: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.value} data-testid={id}>
        {value}
      </span>
      <span className={styles.label}>{label}</span>
    </div>
  );
}

/** After a ride with a trainer or a strap: what was recorded, and its JSON file. */
export function RideCard({ ride }: { ride: RideRecord }) {
  const t = useT();
  const s = ride.summary;
  const paths = useMemo(() => tracePaths(ride), [ride]);
  const zones = s.hrZoneSec;
  const zoneTotal = zones ? zones.reduce((a, b) => a + b, 0) : 0;
  const download = () => {
    const blob = new Blob([JSON.stringify(ride, null, 2)], { type: 'application/json' });
    triggerDownload(blob, rideFileName(ride));
  };
  // The FIT file for Strava, Garmin Connect, intervals.icu...: built only when asked for, so the
  // encoder is a separate chunk that does not weigh on the start of the app.
  const [fitHr, setFitHr] = useState(true);
  const hasHr = ride.samples.heartRate.some((v) => v !== null);
  const downloadFit = async () => {
    const { encodeRideToFit } = await import('../../domain/fit/encode-ride');
    const start = new Date(ride.startedAt);
    const bytes = encodeRideToFit(ride, {
      includeHeartRate: hasHr && fitHr,
      // Local time minus UTC at the start of the ride, in seconds.
      utcOffsetSec: Number.isNaN(start.getTime()) ? 0 : -start.getTimezoneOffset() * 60,
    });
    triggerDownload(
      new Blob([bytes as BlobPart], { type: 'application/vnd.ant.fit' }),
      rideFileName(ride, 'fit'),
    );
  };
  const dash = '—';
  return (
    <Card className={styles.card} data-testid="summary-ride">
      <h2 className={styles.title}>{t('summary.ride.title')}</h2>
      <div className={styles.stats}>
        <Stat id="ride-time" label={t('summary.ride.time')} value={formatClock(s.ridingSec)} />
        {s.avgPowerW !== null && (
          <>
            <Stat
              id="ride-avg-power"
              label={t('summary.ride.avgPower')}
              value={`${s.avgPowerW} W`}
            />
            <Stat
              id="ride-np"
              label={t('summary.ride.np')}
              value={s.normalizedPowerW !== null ? `${s.normalizedPowerW} W` : dash}
            />
            <Stat
              id="ride-max-power"
              label={t('summary.ride.maxPower')}
              value={`${s.maxPowerW ?? dash} W`}
            />
            <Stat id="ride-work" label={t('summary.ride.work')} value={`${s.workKj ?? dash} kJ`} />
          </>
        )}
        {s.avgCadence !== null && (
          <Stat id="ride-cadence" label={t('summary.ride.cadence')} value={`${s.avgCadence} rpm`} />
        )}
        {s.avgHr !== null && (
          <Stat
            id="ride-hr"
            label={t('summary.ride.hr')}
            value={`${s.avgHr} / ${s.maxHr ?? dash} bpm`}
          />
        )}
      </div>
      {paths && (
        <svg
          className={styles.chart}
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={t('summary.ride.chart')}
          data-testid="ride-chart"
        >
          <path className={styles.target} d={paths.target} />
          <path className={styles.power} d={paths.power} />
        </svg>
      )}
      {zones && zoneTotal > 0 && (
        <div
          className={styles.zones}
          role="img"
          aria-label={t('summary.ride.zones')}
          data-testid="ride-zones"
        >
          {zones.map((sec, i) =>
            sec > 0 ? (
              <span
                key={i}
                className={styles.zone}
                style={{ flexGrow: sec, background: `var(--z${(i + 1) * 2})` }}
                title={`${t('summary.ride.zone', { n: i + 1 })}: ${formatClock(sec)}`}
              >
                {sec / zoneTotal >= 0.1 ? `Z${i + 1}` : ''}
              </span>
            ) : null,
          )}
        </div>
      )}
      <div className={styles.actions}>
        <Button onClick={download} data-testid="ride-download">
          {t('summary.ride.download')}
        </Button>
        <Button onClick={() => void downloadFit()} data-testid="ride-download-fit">
          {t('summary.ride.downloadFit')}
        </Button>
        <span className={styles.privacy}>{t('summary.ride.privacy')}</span>
      </div>
      <div className={styles.fit} data-testid="ride-fit">
        {hasHr && <Toggle label={t('summary.ride.fitHr')} checked={fitHr} onChange={setFitHr} />}
        <p className={styles.fitHint}>
          {t('summary.ride.fitHint')}{' '}
          <a href="https://www.strava.com/upload/select" target="_blank" rel="noopener noreferrer">
            {t('summary.ride.fitStrava')}
          </a>
        </p>
      </div>
    </Card>
  );
}
