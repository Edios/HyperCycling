import { cadenceHints, type CadenceFit, type CadenceVerdict } from '../../domain/bpm-match';
import { useT } from '../i18n';
import styles from './Cadence.module.css';

type T = ReturnType<typeof useT>;

export const MARK: Record<CadenceVerdict, string> = { fit: '✓', alt: '≈', miss: '✕' };

/**
 * The rpm a song tempo suits ("≈ 85–95 rpm"; also half or double time when that cadence is
 * rideable). Same rule as the planner: 2 BPM = 1 RPM, half time BPM = RPM.
 */
export function cadenceText(t: T, bpm: number | undefined): string | undefined {
  if (bpm === undefined) return undefined;
  const hints = cadenceHints(bpm);
  if (hints.length === 0) return undefined;
  return hints
    .map((h, i) =>
      i === 0 && h.kind === 'exact'
        ? t('editor.cadence.range', { lo: h.lo, hi: h.hi })
        : t('editor.cadence.rangeKind', {
            kind: t(`editor.bpm.kind.${h.kind}`),
            lo: h.lo,
            hi: h.hi,
          }),
    )
    .join(' · ');
}

/** Words for how a song fits a cadence. */
export function verdictText(t: T, fit: CadenceFit): string {
  if (fit.verdict === 'fit') return t('editor.cadence.fit');
  if (fit.verdict === 'alt')
    return t(fit.kind === 'double' ? 'editor.cadence.double' : 'editor.cadence.half');
  return t('editor.cadence.miss');
}

/**
 * A small mark that says whether a song fits the block's cadence: a glyph and words (never colour
 * alone), tinted green (fits), amber (half or double time) or red (does not fit).
 */
export function CadenceBadge({ fit, testId }: { fit: CadenceFit; testId?: string }) {
  const t = useT();
  return (
    <span
      className={`${styles.badge} ${styles[fit.verdict]}`}
      data-testid={testId ?? 'cadence-badge'}
      data-verdict={fit.verdict}
    >
      <span aria-hidden="true">{MARK[fit.verdict]}</span> {verdictText(t, fit)}
    </span>
  );
}
