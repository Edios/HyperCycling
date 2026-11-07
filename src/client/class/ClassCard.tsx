import type { EffortTable } from '../../domain/effort';
import type { Lang } from '../../domain/lang';
import { cooldownBlockOf, type Block, type Workout } from '../../domain/workout';
import { songHint } from '../data/localized';
import { useT } from '../i18n';
import { intensityEffort, blockTotalSec } from '../editor/model';
import { formatClock } from '../training/format';
import styles from './ClassCard.module.css';

interface Row {
  key: string;
  at: number;
  duration: number;
  text: string;
}

function leafText(
  b: Exclude<Block, { kind: 'repeat' }>,
  table: EffortTable,
  t: ReturnType<typeof useT>,
): string {
  const parts: string[] = [];
  if (b.position)
    parts.push(
      t(b.position === 'seated' ? 'editor.inspector.seated' : 'editor.inspector.standing'),
    );
  if (b.rpm !== undefined) parts.push(`${b.rpm} ${t('editor.inspector.rpmUnit')}`);
  parts.push(
    b.kind === 'steady'
      ? `${t('editor.inspector.effort')} ${intensityEffort(b.intensity, table)}`
      : `${t('editor.inspector.effort')} ${intensityEffort(b.from, table)}→${intensityEffort(b.to, table)}`,
  );
  if (b.cue) parts.push(`“${b.cue}”`);
  return parts.join(' · ');
}

/** The trainer's card: songs in order with time, tempo hint and what to do in each block. */
export function ClassCard({
  workout,
  lang,
  table,
  name,
}: {
  workout: Workout;
  lang: Lang;
  table: EffortTable;
  name: string;
}) {
  const t = useT();
  let at = 0;
  const startOf = new Map<string, number>();
  for (const b of workout.blocks) {
    startOf.set(b.id, at);
    at += blockTotalSec(b);
  }
  const rowsFor = (b: Block, base: number): Row[] => {
    if (b.kind !== 'repeat') {
      return [{ key: b.id, at: base, duration: b.durationSec, text: leafText(b, table, t) }];
    }
    const per = b.blocks.reduce((s, c) => s + c.durationSec, 0);
    return [
      {
        key: b.id,
        at: base,
        duration: per * b.times,
        text: `${t('editor.repeatLabel', { n: b.times })}: ${b.blocks
          .map((c) => `${formatClock(c.durationSec)} ${leafText(c, table, t)}`)
          .join(' | ')}`,
      },
    ];
  };
  const slots = workout.songs ?? [];
  const cooldownId = cooldownBlockOf(workout)?.id;
  const sections = slots.map((song, i) => {
    const a = workout.blocks.findIndex((b) => b.id === song.firstBlockId);
    const z = workout.blocks.findIndex((b) => b.id === song.lastBlockId);
    const blocks = a >= 0 && z >= a ? workout.blocks.slice(a, z + 1) : [];
    const start = startOf.get(song.firstBlockId) ?? 0;
    const len = blocks.reduce((s, b) => s + blockTotalSec(b), 0);
    const own = song.track;
    const cool = workout.cooldownTrack && cooldownId && blocks.some((b) => b.id === cooldownId);
    const track = cool ? workout.cooldownTrack : own;
    return { song, i, blocks, start, len, track, hint: songHint(workout, song, lang) };
  });
  return (
    <article className={styles.card} data-testid="class-card" aria-label={t('card.title')}>
      <h2 className={styles.name}>{name}</h2>
      <p className={styles.sum}>{t('card.summary', { n: slots.length, time: formatClock(at) })}</p>
      <ol className={styles.list}>
        {sections.map((s) => (
          <li key={s.song.id} className={styles.song} data-testid="class-card-song">
            <div className={styles.head}>
              <strong>{t('card.song', { n: s.i + 1 })}</strong>
              <span>
                {formatClock(s.start)}–{formatClock(s.start + s.len)} · {formatClock(s.len)}
              </span>
              {s.song.bpm && (
                <span>
                  {s.song.bpm[0]}–{s.song.bpm[1]} {t('card.bpm')}
                </span>
              )}
            </div>
            {s.hint && <p className={styles.hint}>{s.hint}</p>}
            {s.track && (
              <p className={styles.track}>
                ♫ {s.track.title || (s.track.provider === 'spotify' ? 'Spotify' : 'YouTube')}
              </p>
            )}
            <ul className={styles.rows}>
              {s.blocks.flatMap((b) =>
                rowsFor(b, startOf.get(b.id) ?? 0).map((r) => (
                  <li key={r.key}>
                    <span className={styles.time}>
                      {formatClock(r.at)} · {formatClock(r.duration)}
                    </span>{' '}
                    {r.text}
                  </li>
                )),
              )}
            </ul>
          </li>
        ))}
      </ol>
    </article>
  );
}
