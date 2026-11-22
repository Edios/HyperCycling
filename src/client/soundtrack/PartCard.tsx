import { useId } from 'react';
import type { SectionEnergy, MusicSection } from '../../domain/soundtrack';
import type { CatalogTrack } from '../../domain/soundtrack-catalog';
import type { PlannedSection, PlanPick, PickFit } from '../../domain/soundtrack-plan';
import { isOffTempo, isStretched } from '../../domain/soundtrack-wizard';
import { useT, type MessageKey } from '../i18n';
import { Icon } from '../ui/Icon';
import { formatClock } from '../training/format';
import styles from './SoundtrackWizard.module.css';

const FIT_KEY: Partial<Record<PickFit, MessageKey>> = {
  half: 'soundtrack.fit.half',
  double: 'soundtrack.fit.double',
  close: 'soundtrack.fit.close',
  off: 'soundtrack.fit.off',
  nobeat: 'soundtrack.fit.nobeat',
};

/** "2–4", or "5" when the effort is the same all through. */
export function effortRange(s: MusicSection): string {
  const lo = Math.round(s.effort.min);
  const hi = Math.round(s.effort.max);
  return lo === hi ? String(lo) : `${lo}–${hi}`;
}

export interface PartCardProps {
  planned: PlannedSection;
  section: MusicSection;
  catalog: ReadonlyMap<string, CatalogTrack>;
  locked: boolean;
  /** The song row whose preview plays now. */
  previewKey: string | null;
  onLock(): void;
  onReplace(songId: string): void;
  onPreview(pick: PlanPick, track: CatalogTrack): void;
  onStopPreview(): void;
}

/** One stretch of the ride with its songs: title, lock, the songs and what to know about them. */
export function PartCard({
  planned,
  section,
  catalog,
  locked,
  previewKey,
  onLock,
  onReplace,
  onPreview,
  onStopPreview,
}: PartCardProps) {
  const t = useT();
  const headId = useId();
  const title = t('soundtrack.partTitle', {
    role: t(`soundtrack.role.${planned.role}`),
    range: effortRange(section),
    time: formatClock(planned.durationSec),
  });
  const { report } = planned;
  const notes: { key: string; text: string; tone: 'info' | 'warn' }[] = [];
  if (planned.picks.length === 0)
    notes.push({ key: 'empty', text: t('soundtrack.empty'), tone: 'warn' });
  if (isStretched(planned))
    notes.push({ key: 'str', text: t('soundtrack.stretched'), tone: 'info' });
  if (isOffTempo(planned)) notes.push({ key: 'off', text: t('soundtrack.offTempo'), tone: 'warn' });
  if (report.warn.includes('gap') && planned.picks.length > 0) {
    notes.push({
      key: 'gap',
      text: t('soundtrack.silence', { time: formatClock(report.gapSec) }),
      tone: 'warn',
    });
  }
  if (report.cutSec > 0 && report.warn.includes('cut')) {
    notes.push({
      key: 'cut',
      text: t('soundtrack.cut', { time: formatClock(report.cutSec) }),
      tone: 'info',
    });
  }
  return (
    <article
      className={styles.part}
      data-testid="soundtrack-part"
      data-section={planned.sectionId}
      data-role={planned.role}
      tabIndex={-1}
      aria-labelledby={headId}
    >
      <header className={styles.partHead}>
        <h3 id={headId} className={styles.partTitle}>
          {title}
        </h3>
        <button
          type="button"
          className={styles.lock}
          aria-pressed={locked}
          // The visible word leads the name (WCAG 2.5.3: the label is part of the accessible name).
          aria-label={t('soundtrack.lockLabel', {
            state: locked ? t('soundtrack.locked') : t('soundtrack.lock'),
            title,
          })}
          data-testid="soundtrack-lock"
          onClick={onLock}
        >
          {locked ? t('soundtrack.locked') : t('soundtrack.lock')}
        </button>
      </header>
      <p className={styles.partMusic} data-testid="soundtrack-part-music">
        {t('soundtrack.partMusic', {
          profile: t(`soundtrack.profile.${section.profile}`),
          energy: section.energy,
        })}
      </p>
      {planned.picks.length > 0 && (
        <ol className={styles.songs}>
          {planned.picks.map((pick, i) => {
            const track = catalog.get(pick.ref.id);
            if (!track) return null;
            const key = `${planned.sectionId}:${i}`;
            const playing = previewKey === key;
            const fitKey = FIT_KEY[pick.fit];
            const meta = [
              track.bpm !== undefined ? t('soundtrack.bpm', { bpm: Math.round(track.bpm) }) : '',
              fitKey ? t(fitKey) : '',
              formatClock(pick.playSec),
            ].filter(Boolean);
            return (
              <li
                key={key}
                className={styles.song}
                data-testid="soundtrack-song"
                data-song={track.id}
              >
                <button
                  type="button"
                  className={styles.play}
                  aria-pressed={playing}
                  aria-label={
                    playing ? t('soundtrack.stop') : t('soundtrack.play', { song: track.title })
                  }
                  data-testid="soundtrack-play"
                  onClick={() => (playing ? onStopPreview() : onPreview(pick, track))}
                >
                  <Icon name={playing ? 'pause' : 'play'} size={18} />
                </button>
                <span className={styles.songName}>
                  <strong>{track.title}</strong>
                  <small>{track.artist}</small>
                </span>
                <span className={styles.songMeta}>{meta.join(' · ')}</span>
                <button
                  type="button"
                  className={styles.replace}
                  aria-label={t('soundtrack.replaceLabel', { song: track.title })}
                  data-testid="soundtrack-replace"
                  onClick={() => onReplace(track.id)}
                >
                  {t('soundtrack.replace')}
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {notes.map((n) => (
        <p key={n.key} className={`${styles.note} ${n.tone === 'warn' ? styles.warn : ''}`}>
          {n.text}
        </p>
      ))}
    </article>
  );
}

/** The energy of a section as a number 1-5 (kept for the part strip's height). */
export const energyHeight = (e: SectionEnergy): number => 20 + e * 16;
