import { targetWatts } from '../../../domain/effort';
import type { Player } from '../../../domain/player';
import { useT } from '../../i18n';
import styles from './PlayersList.module.css';

export interface PlayersListProps {
  players: readonly Player[];
  ftpPct: number;
  /** Block effort on the 1-10 scale; shown once when the bike has no watts. */
  effort: number;
  showsWatts: boolean;
}

function safeWatts(ftp: number, ftpPct: number, unit: string): string {
  if (!Number.isFinite(ftp) || ftp <= 0 || !Number.isFinite(ftpPct)) return '—';
  return `${targetWatts(ftp, ftpPct)} ${unit}`;
}

export function PlayersList({ players, ftpPct, effort, showsWatts }: PlayersListProps) {
  const t = useT();
  return (
    <div data-testid="players-list" className={styles.root}>
      <div className={styles.header}>
        {showsWatts
          ? t('training.playersTarget', { pct: Math.round(ftpPct) })
          : t('training.playersTargetEffort', { effort: Math.round(effort) })}
      </div>
      <ul className={styles.list}>
        {players.map((p) => (
          <li key={p.id} className={`${styles.row} ${p.isMe ? styles.me : ''}`}>
            <span className={styles.name}>{p.name}</span>
            {showsWatts && (
              <span className={styles.watts}>{safeWatts(p.ftp, ftpPct, t('training.watts'))}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
