import { longerVersion, queueSec, reserveList, type PlanCandidate } from '../../domain/slot-plan';
import type { TrackRef } from '../../domain/workout';
import { formatSongTime } from '../experience/model';
import { useT, type MessageKey } from '../i18n';
import { Button } from '../ui/Button';
import styles from './SlotQueue.module.css';

interface Props {
  tracks: TrackRef[];
  /** Length of the slot in seconds. */
  slotSec: number;
  /** Tempo wanted for the slot (for the "add a song of about N BPM" hint). */
  targetBpm?: number | undefined;
  /** Rest/cooldown slots may end in silence. */
  rest?: boolean;
  /** Other versions and reserve songs (from the Spotify search); empty when unknown. */
  candidates?: readonly PlanCandidate[];
  /** Tracks used by other slots (not offered as reserve). */
  usedIds?: ReadonlySet<string>;
  onChange?: (next: TrackRef[]) => void;
  /** Totals and status only: no offsets or buttons. */
  readOnly?: boolean;
  testId?: string;
}

const label = (t: TrackRef): string => (t.artist ? `${t.artist} – ${t.title}` : t.title);

interface Status {
  key: MessageKey;
  warn: boolean;
  vars: Record<string, string | number>;
}

function statusOf(gap: number, rest: boolean, targetBpm: number | undefined): Status {
  if (gap > 10) {
    const time = formatSongTime(gap);
    if (rest) return { key: 'slotQueue.missingRest', warn: false, vars: { time } };
    if (targetBpm !== undefined) {
      return { key: 'slotQueue.missing', warn: true, vars: { time, bpm: Math.round(targetBpm) } };
    }
    return { key: 'slotQueue.missingAny', warn: true, vars: { time } };
  }
  if (gap < -10)
    return { key: 'slotQueue.over', warn: false, vars: { time: formatSongTime(-gap) } };
  return { key: 'slotQueue.fits', warn: false, vars: {} };
}

/**
 * The song queue of one slot: order, start offsets, total vs slot time and a warning when music
 * is missing or too long. Nothing changes until the owner presses a button; the parent decides
 * when the result is saved.
 */
export function SlotQueue({
  tracks,
  slotSec,
  targetBpm,
  rest = false,
  candidates = [],
  usedIds,
  onChange: onChangeProp,
  readOnly = false,
  testId = 'slot-queue',
}: Props) {
  const onChange = onChangeProp ?? (() => undefined);
  const t = useT();
  const total = queueSec(tracks);
  const gap = Math.round(slotSec - total);
  const unknownLength = tracks.some((x) => x.durationSec === undefined);
  const reserve = reserveList(candidates, tracks, slotSec, targetBpm, usedIds);
  const status = tracks.length > 0 && !unknownLength ? statusOf(gap, rest, targetBpm) : undefined;

  const move = (i: number, d: -1 | 1): void => {
    const next = [...tracks];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j] as TrackRef, next[i] as TrackRef];
    onChange(next);
  };
  const setOffset = (i: number, raw: string): void => {
    const max = Math.max(0, (tracks[i]?.durationSec ?? 3600) - 1);
    const n = Math.max(0, Math.min(Math.floor(Number(raw) || 0), max));
    onChange(tracks.map((x, k) => (k === i ? { ...x, startAtSec: n } : x)));
  };

  return (
    <div className={styles.queue} data-testid={testId}>
      {tracks.length === 0 ? (
        <small className={styles.cap}>{t('slotQueue.empty')}</small>
      ) : readOnly ? null : (
        <ol className={styles.list}>
          {tracks.map((tr, i) => {
            const longer = longerVersion(tr, candidates);
            const known = candidates.find((c) => c.track.id === tr.id);
            const region = known !== undefined && known.playable === undefined;
            return (
              <li key={`${tr.id}:${i}`} className={styles.item} data-testid={`${testId}-item`}>
                <span className={styles.name}>
                  {label(tr)}
                  {tr.durationSec !== undefined
                    ? ` (${formatSongTime(tr.durationSec - tr.startAtSec)})`
                    : ''}
                  {region ? ` · ${t('slotQueue.regionUnknown')}` : ''}
                </span>
                <label className={styles.offset}>
                  <span>{t('slotQueue.offset')}</span>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={tr.startAtSec}
                    data-testid={`${testId}-offset`}
                    onChange={(e) => setOffset(i, e.target.value)}
                  />
                </label>
                <span className={styles.buttons}>
                  <Button
                    aria-label={`${t('slotQueue.up')}: ${label(tr)}`}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    data-testid={`${testId}-up`}
                  >
                    ↑
                  </Button>
                  <Button
                    aria-label={`${t('slotQueue.down')}: ${label(tr)}`}
                    disabled={i === tracks.length - 1}
                    onClick={() => move(i, 1)}
                    data-testid={`${testId}-down`}
                  >
                    ↓
                  </Button>
                  {longer && (
                    <Button
                      onClick={() =>
                        onChange(
                          tracks.map((x, k) =>
                            k === i ? { ...longer.track, startAtSec: x.startAtSec } : x,
                          ),
                        )
                      }
                      data-testid={`${testId}-longer`}
                    >
                      {t('slotQueue.longer')} ({formatSongTime(longer.track.durationSec ?? 0)})
                    </Button>
                  )}
                  <Button
                    aria-label={`${t('slotQueue.remove')}: ${label(tr)}`}
                    onClick={() => onChange(tracks.filter((_, k) => k !== i))}
                    data-testid={`${testId}-remove`}
                  >
                    ✕
                  </Button>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {!unknownLength && tracks.length > 0 && (
        <small className={styles.cap} data-testid={`${testId}-total`}>
          {t('slotQueue.total', { sum: formatSongTime(total), slot: formatSongTime(slotSec) })}
        </small>
      )}
      {status && (
        <small
          className={status.warn ? styles.warn : styles.cap}
          data-testid={`${testId}-status`}
          role={status.warn ? 'status' : undefined}
        >
          {t(status.key, status.vars)}
        </small>
      )}
      {!readOnly && candidates.length > 0 && (
        <Button
          disabled={reserve.length === 0}
          onClick={() => {
            const next = reserve[0];
            if (next) onChange([...tracks, next.track]);
          }}
          data-testid={`${testId}-reserve`}
        >
          {reserve.length === 0 ? t('slotQueue.noReserve') : t('slotQueue.addReserve')}
        </Button>
      )}
    </div>
  );
}
