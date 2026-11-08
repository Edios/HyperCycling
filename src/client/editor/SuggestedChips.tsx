import { useMemo } from 'react';
import type { MatchKind } from '../../domain/bpm-match';
import { useT } from '../i18n';
import { suggestFor, type LibraryTrack } from '../music/library/library';
import { useSongLibrary } from '../music/library/tag-controller';
import { BRAND } from '../music/provider-labels';
import styles from './SuggestedChips.module.css';

const MAX_CHIPS = 6;

const KIND_KEY = {
  exact: 'editor.suggest.exact',
  half: 'editor.suggest.half',
  double: 'editor.suggest.double',
} as const satisfies Record<MatchKind, string>;

/**
 * "Suggested" songs for a block (or song slot): the rider's imported and tagged songs that fit
 * the cadence, best first (2 BPM = 1 RPM, half and double time also count). Each chip shows the
 * tempo, where it came from and how well it fits; a click hands the song to the caller, which
 * pins it the same way 'Find a song' and the link field do.
 */
export function SuggestedChips({
  rpm,
  onPick,
}: {
  rpm: number | undefined;
  onPick: (track: LibraryTrack) => void;
}) {
  const t = useT();
  const library = useSongLibrary();
  const ranked = useMemo(() => suggestFor(library, rpm).slice(0, MAX_CHIPS), [library, rpm]);
  if (rpm === undefined) return null;
  if (library.length === 0) {
    return (
      <small className={styles.caption} data-testid="suggested-empty">
        {t('editor.suggest.empty')}
      </small>
    );
  }
  if (ranked.length === 0) {
    return (
      <small className={styles.caption} data-testid="suggested-none">
        {t('editor.suggest.none', { rpm: Math.round(rpm) })}
      </small>
    );
  }
  return (
    <div className={styles.wrap} data-testid="suggested">
      <span className={styles.label}>{t('editor.suggest.title')}</span>
      <ul className={styles.chips}>
        {ranked.map(({ track, match }) => {
          const source =
            track.bpmSource === 'manual' || !track.bpmSource
              ? t('editor.suggest.manual')
              : BRAND[track.bpmSource];
          const fit = `${t(KIND_KEY[match.kind])}${match.fit === 'close' ? ` (${t('editor.suggest.close')})` : ''}`;
          const name = track.artist ? `${track.title} · ${track.artist}` : track.title;
          return (
            <li key={track.id}>
              <button
                type="button"
                className={styles.chip}
                data-testid="suggested-chip"
                title={`${name} — ${track.bpm} BPM · ${source} · ${fit}`}
                onClick={() => onPick(track)}
              >
                <span className={styles.name}>{name}</span>
                <span className={styles.meta}>{`${track.bpm} BPM · ${source} · ${fit}`}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
