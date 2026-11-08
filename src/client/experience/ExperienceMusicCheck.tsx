import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { hintQueue, type Experience } from '../../domain/experience';
import { queueRecordings } from '../../domain/music-chain';
import type { TrackRef, Workout } from '../../domain/workout';
import { useT, type MessageKey } from '../i18n';
import { setMusicSource } from '../music/music-source';
import { ipOriginHost } from '../music/origin';
import {
  checkRecordings,
  liveCount,
  saveResults,
  slotHealth,
  type Health,
  type PreflightDeps,
  type ResultMap,
} from '../music/preflight';
import { Button } from '../ui/Button';
import styles from './ExperienceMusic.module.css';
import { MusicSourceSelect } from './MusicSourceSelect';

const HEALTH_KEY: Record<Health, MessageKey> = {
  green: 'experience.check.health.green',
  yellow: 'experience.check.health.yellow',
  red: 'experience.check.health.red',
};
const HEALTH_MARK: Record<Health, string> = { green: '●', yellow: '▲', red: '✖' };

interface Props {
  experience: Experience;
  workout: Workout;
  /** The queue of every slot (slot id -> tracks with their backups), as the ride will play it. */
  chains: Readonly<Record<string, TrackRef[]>>;
  /** Results of the last check in this visit; empty = not checked yet. */
  results: ResultMap;
  onResults: (next: ResultMap) => void;
  spotifyConnected: boolean;
  /** Test seam: the oEmbed lookup and the trial embed. */
  deps?: PreflightDeps;
  /** Test seam: the page's host name; defaults to the real one. */
  host?: string | undefined;
}

/** Slots whose music cannot play according to the check (empty until a check ran). */
export function redSlots(
  experience: Experience,
  workout: Workout,
  chains: Readonly<Record<string, TrackRef[]>>,
  results: ResultMap,
): number[] {
  if (results.size === 0) return [];
  const out: number[] = [];
  for (const h of experience.musicHints ?? []) {
    const slot = workout.songs?.[h.slot];
    if (!slot) continue;
    if (slotHealth(chains[slot.id] ?? [], results) === 'red') out.push(h.slot);
  }
  return out;
}

/**
 * "Check the music": tries every recording of every slot (oEmbed + a muted trial embed) and
 * shows each slot as green / yellow (only a backup plays) / red (nothing plays). Meant to be run
 * on the device in the training room, where region blocks and a weak connection show up.
 */
export function ExperienceMusicCheck({
  experience,
  workout,
  chains,
  results,
  onResults,
  spotifyConnected,
  deps,
  host,
}: Props) {
  const t = useT();
  const hints = useMemo(() => experience.musicHints ?? [], [experience]);
  // YouTube refuses to play from an IP address: say so instead of a bare "nothing plays".
  const ip = ipOriginHost(host === undefined ? undefined : { hostname: host }) ?? undefined;
  const [progress, setProgress] = useState<{ done: number; total: number } | undefined>();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  if (hints.length === 0) return null;

  const run = async (): Promise<void> => {
    const all = Object.values(chains).flatMap((q) => queueRecordings(q));
    setProgress({ done: 0, total: all.length });
    const found = await checkRecordings(all, deps, (done, total) => {
      if (alive.current) setProgress({ done, total });
    });
    saveResults(found);
    if (!alive.current) return;
    setProgress(undefined);
    onResults(found);
  };

  const checked = results.size > 0;
  const red = redSlots(experience, workout, chains, results);

  return (
    <section className={styles.panel} data-testid="exp-check">
      <h2 className={styles.title}>{t('experience.check.title')}</h2>
      <p className={styles.note}>{t('experience.check.intro')}</p>
      {ip && (
        <p role="note" className={styles.warn} data-testid="exp-check-ip">
          {t(spotifyConnected ? 'experience.check.ipOriginAuto' : 'experience.check.ipOrigin', {
            host: ip,
          })}
        </p>
      )}
      <MusicSourceSelect className={styles.note} />
      <div className={styles.actions}>
        <Button
          onClick={() => void run()}
          disabled={progress !== undefined}
          data-testid="exp-check-run"
        >
          {t(checked ? 'experience.check.rerun' : 'experience.check.run')}
        </Button>
      </div>
      {progress && (
        <p role="status" className={styles.note} data-testid="exp-check-working">
          {t('experience.check.working', progress)}
        </p>
      )}
      {!checked && !progress && (
        <p className={styles.cap} data-testid="exp-check-notrun">
          {t('experience.check.notRun')}
        </p>
      )}
      {checked && (
        <ol className={styles.list} data-testid="exp-check-list">
          {hints.map((h) => {
            const slot = workout.songs?.[h.slot];
            const queue = slot ? (chains[slot.id] ?? []) : [];
            const health = slotHealth(queue, results);
            const all = queueRecordings(queue);
            return (
              <li
                key={h.slot}
                className={styles.row}
                data-testid="exp-check-slot"
                data-health={health}
              >
                <span className={styles.head}>
                  <strong>
                    {t('experience.check.slot', {
                      n: h.slot + 1,
                      title: hintQueue(h)
                        .map((i) => i.title)
                        .join(' + '),
                    })}
                  </strong>
                  <span className={health === 'red' ? styles.err : styles.warn}>
                    <span aria-hidden="true">{HEALTH_MARK[health]}</span> {t(HEALTH_KEY[health])}
                  </span>
                </span>
                <small className={styles.cap}>
                  {t('experience.check.detail', {
                    live: liveCount(all, results),
                    total: all.length,
                  })}
                </small>
              </li>
            );
          })}
        </ol>
      )}
      {red.length > 0 && (
        <div role="alert" className={styles.err} data-testid="exp-check-blocked">
          <p>{t('experience.check.blocked', { slots: red.map((n) => n + 1).join(', ') })}</p>
          <p>
            {ip ? t('experience.check.ipOrigin', { host: ip }) : t('experience.check.blockedTip')}
          </p>
          {spotifyConnected ? (
            <Button onClick={() => setMusicSource('spotify')} data-testid="exp-check-spotify">
              {t('experience.check.useSpotify')}
            </Button>
          ) : (
            <Link to="/settings" className={styles.link}>
              {t('experience.music.connect')}
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
