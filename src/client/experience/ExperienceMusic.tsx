import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { duplicateHintSlots, type Experience } from '../../domain/experience';
import type { TrackRef, Workout } from '../../domain/workout';
import { useT, type MessageKey } from '../i18n';
import { parseTrackUrl } from '../music/parse-track-url';
import { getSharedSpotifyProvider } from '../music/spotify/shared';
import { spotifyErrorKey } from '../music/spotify/messages';
import type { SpotifyProvider } from '../music/spotify';
import { lookupSpotifyTrack } from '../music/spotify/track-info';
import { SlotQueue } from '../music/SlotQueue';
import { Button } from '../ui/Button';
import { formatSongTime } from './model';
import { saveChoices, type Choices } from './musicChoices';
import { resolveAllQueues, slotInfo, type ItemHow, type QueueMatch } from './musicMatch';
import styles from './ExperienceMusic.module.css';

type Phase =
  | { kind: 'idle' }
  | { kind: 'working'; done: number; total: number }
  | { kind: 'review'; matches: QueueMatch[]; queues: Record<number, TrackRef[]> }
  | { kind: 'error'; key: MessageKey };

interface Props {
  experience: Experience;
  /** The workout whose song slots the hints refer to (before plan scaling). */
  workout: Workout;
  /** Whether Spotify can be used (tokens stored, Client ID resolved). */
  connected: boolean;
  choices: Choices;
  onChoices: (next: Choices) => void;
  /** Test seam; defaults to the app-wide provider. */
  provider?: SpotifyProvider;
}

const name = (o: { artist?: string; title: string }): string =>
  o.artist ? `${o.artist} – ${o.title}` : o.title;

/** Wanted tempo of a slot: the middle of its BPM range. */
const targetBpmOf = (range: readonly [number, number] | undefined): number | undefined =>
  range ? (range[0] + range[1]) / 2 : undefined;

const HOW_KEY: Record<ItemHow, MessageKey> = {
  found: 'experience.music.how.found',
  longer: 'experience.music.how.longer',
  replaced: 'experience.music.how.replaced',
  missing: 'experience.music.how.missing',
};

/**
 * "Match songs from Spotify" for an Experience (setup screen): turns the scenario's song
 * suggestions into tracks of the rider's own account, shows them for approval and keeps the
 * approved set in this browser. Without Spotify the ride simply has no music (or YouTube pins).
 */
export function ExperienceMusic({
  experience,
  workout,
  connected,
  choices,
  onChoices,
  provider,
}: Props) {
  const t = useT();
  const hints = useMemo(() => experience.musicHints ?? [], [experience]);
  const duplicates = useMemo(() => duplicateHintSlots(experience), [experience]);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [manual, setManual] = useState<Record<number, string>>({});
  const [manualErr, setManualErr] = useState<number | undefined>();
  const run = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  if (hints.length === 0) return null;

  const matched = hints.filter((h) => {
    const s = workout.songs?.[h.slot];
    return s && choices[s.id];
  }).length;

  if (!connected) {
    return (
      <section className={styles.panel} data-testid="exp-music-offline">
        <h2 className={styles.title}>{t('experience.music.title')}</h2>
        <p className={styles.note}>{t('experience.music.offline')}</p>
        <Link to="/settings" className={styles.link} data-testid="exp-music-connect">
          {t('experience.music.connect')}
        </Link>
      </section>
    );
  }

  const start = async (): Promise<void> => {
    const mine = ++run.current;
    const api = provider ?? getSharedSpotifyProvider();
    setPhase({ kind: 'working', done: 0, total: hints.length });
    try {
      const matches = await resolveAllQueues(
        hints,
        (q, limit) => api.searchTracks(q, limit),
        (slot) => slotInfo(workout, slot)?.sec ?? 0,
        (done, total) => {
          if (alive.current && mine === run.current) setPhase({ kind: 'working', done, total });
        },
      );
      if (alive.current && mine === run.current) {
        const queues: Record<number, TrackRef[]> = {};
        for (const m of matches) queues[m.slot] = m.queue;
        setPhase({ kind: 'review', matches, queues });
      }
    } catch (err) {
      if (alive.current && mine === run.current) {
        setPhase({ kind: 'error', key: spotifyErrorKey(err) });
      }
    }
  };

  const setQueue = (slot: number, tracks: TrackRef[]): void => {
    setPhase((cur) =>
      cur.kind === 'review' ? { ...cur, queues: { ...cur.queues, [slot]: tracks } } : cur,
    );
  };

  const applyManual = async (slot: number): Promise<void> => {
    const parsed = parseTrackUrl(manual[slot] ?? '');
    if (parsed?.provider !== 'spotify') {
      setManualErr(slot);
      return;
    }
    setManualErr(undefined);
    const info = await lookupSpotifyTrack(parsed.id);
    if (!alive.current) return;
    const added: TrackRef = {
      provider: 'spotify',
      id: parsed.id,
      title: info?.title ?? parsed.id,
      ...(info?.artist ? { artist: info.artist } : {}),
      startAtSec: 0,
    };
    setPhase((cur) =>
      cur.kind === 'review'
        ? { ...cur, queues: { ...cur.queues, [slot]: [...(cur.queues[slot] ?? []), added] } }
        : cur,
    );
  };

  const approve = (): void => {
    if (phase.kind !== 'review') return;
    const next: Choices = {};
    for (const m of phase.matches) {
      const slot = workout.songs?.[m.slot];
      const queue = phase.queues[m.slot] ?? [];
      if (slot && queue.length > 0) next[slot.id] = queue;
    }
    saveChoices(experience.id, next);
    onChoices(next);
    setPhase({ kind: 'idle' });
  };

  const clear = (): void => {
    saveChoices(experience.id, {});
    onChoices({});
  };

  return (
    <section className={styles.panel} data-testid="exp-music">
      <h2 className={styles.title}>{t('experience.music.title')}</h2>
      {duplicates.map(([a, b]) => (
        <p key={`${a}-${b}`} className={styles.warn} data-testid="exp-music-duplicate">
          {t('experience.music.duplicate', { a: a + 1, b: b + 1 })}
        </p>
      ))}
      {phase.kind === 'idle' && (
        <>
          <p className={styles.note} data-testid="exp-music-state">
            {matched > 0
              ? t('experience.music.saved', { n: matched, total: hints.length })
              : t('experience.music.intro')}
          </p>
          <div className={styles.actions}>
            <Button onClick={() => void start()} data-testid="exp-music-match">
              {matched > 0 ? t('experience.music.rematch') : t('experience.music.match')}
            </Button>
            {matched > 0 && (
              <Button onClick={clear} data-testid="exp-music-clear">
                {t('experience.music.clear')}
              </Button>
            )}
          </div>
        </>
      )}
      {phase.kind === 'working' && (
        <p role="status" className={styles.note} data-testid="exp-music-working">
          {t('experience.music.working', { done: phase.done, total: phase.total })}
        </p>
      )}
      {phase.kind === 'error' && (
        <>
          <p role="alert" className={styles.err} data-testid="exp-music-error">
            {t(phase.key)}
          </p>
          <div className={styles.actions}>
            <Button onClick={() => void start()}>{t('experience.music.retry')}</Button>
            <Button onClick={() => setPhase({ kind: 'idle' })}>{t('experience.music.skip')}</Button>
          </div>
        </>
      )}
      {phase.kind === 'review' && (
        <>
          <p className={styles.note}>{t('experience.music.review')}</p>
          <ol className={styles.list} data-testid="exp-music-review">
            {phase.matches.map((m) => {
              const hint = hints.find((h) => h.slot === m.slot);
              const info = slotInfo(workout, m.slot);
              if (!hint || !info) return null;
              const queue = phase.queues[m.slot] ?? [];
              const others = new Set(
                Object.entries(phase.queues).flatMap(([k, v]) =>
                  Number(k) === m.slot ? [] : v.map((x) => x.id),
                ),
              );
              return (
                <li key={m.slot} className={styles.row} data-testid="exp-music-row">
                  <div className={styles.head}>
                    <b>
                      {t('experience.songRow', { n: m.slot + 1, time: formatSongTime(info.sec) })}
                    </b>
                  </div>
                  <ul className={styles.items}>
                    {m.items.map((it, i) => (
                      <li key={i} data-testid="exp-music-item" data-how={it.how}>
                        <span>{name(it.want)}</span>
                        {it.ref && (
                          <span className={styles.cap}>
                            {' '}
                            {it.how === 'replaced' ? `→ ${name(it.ref)}` : ''}
                            {it.ref.durationSec !== undefined
                              ? ` (${formatSongTime(it.ref.durationSec - it.ref.startAtSec)})`
                              : ''}
                          </span>
                        )}
                        <small
                          className={
                            it.how === 'missing' || it.how === 'replaced' ? styles.warn : styles.cap
                          }
                        >
                          {' · '}
                          {t(HOW_KEY[it.how])}
                        </small>
                        {it.regionUnverified && (
                          <small className={styles.cap} data-testid="exp-music-region">
                            {' · '}
                            {t('experience.music.regionUnknown')}
                          </small>
                        )}
                      </li>
                    ))}
                  </ul>
                  <SlotQueue
                    tracks={queue}
                    slotSec={info.sec}
                    targetBpm={targetBpmOf(info.range)}
                    rest={hint.noBeat === true}
                    readOnly
                    testId="exp-music-queue"
                  />
                  <details className={styles.advanced} data-testid="exp-music-advanced">
                    <summary>{t('experience.music.advanced')}</summary>
                    <SlotQueue
                      tracks={queue}
                      slotSec={info.sec}
                      targetBpm={targetBpmOf(info.range)}
                      rest={hint.noBeat === true}
                      candidates={m.candidates}
                      usedIds={others}
                      onChange={(next) => setQueue(m.slot, next)}
                      testId="exp-music-edit"
                    />
                    <div className={styles.manual}>
                      <input
                        aria-label={t('experience.music.manualLabel', { n: m.slot + 1 })}
                        placeholder={t('experience.music.manualPlaceholder')}
                        value={manual[m.slot] ?? ''}
                        maxLength={200}
                        data-testid="exp-music-manual"
                        onChange={(e) => setManual((cur) => ({ ...cur, [m.slot]: e.target.value }))}
                      />
                      <Button
                        onClick={() => void applyManual(m.slot)}
                        disabled={!(manual[m.slot] ?? '').trim()}
                      >
                        {t('experience.music.manualUse')}
                      </Button>
                    </div>
                    {manualErr === m.slot && (
                      <small role="alert" className={styles.warn}>
                        {t('experience.music.manualBad')}
                      </small>
                    )}
                  </details>
                </li>
              );
            })}
          </ol>
          <div className={styles.actions}>
            <Button variant="primary" onClick={approve} data-testid="exp-music-approve">
              {t('experience.music.approve')}
            </Button>
            <Button onClick={() => setPhase({ kind: 'idle' })} data-testid="exp-music-reject">
              {t('experience.music.reject')}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
