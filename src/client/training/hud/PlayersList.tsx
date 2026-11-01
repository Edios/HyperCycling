import { targetWatts } from '../../../domain/effort';
import type { Player } from '../../../domain/player';
import { useT } from '../../i18n';
import hud from './hud.module.css';
import styles from './PlayersList.module.css';

export interface PlayersListProps {
  players: readonly Player[];
  ftpPct: number;
  /** Block effort on the 1-10 scale; shown once when the bike has no watts. */
  effort: number;
  showsWatts: boolean;
  className?: string;
}

function safeWatts(ftp: number, ftpPct: number, unit: string): string {
  if (!Number.isFinite(ftp) || ftp <= 0 || !Number.isFinite(ftpPct)) return '—';
  return `${targetWatts(ftp, ftpPct)} ${unit}`;
}

/** Group R: the riders with their target watts (or only their names when the bike has none). */
export function PlayersList({ players, ftpPct, effort, showsWatts, className }: PlayersListProps) {
  const t = useT();
  return (
    <div
      data-testid="players-list"
      data-g="R"
      className={`${hud.panel} ${styles.root}${className ? ` ${className}` : ''}`}
    >
      <div className={`${hud.lbl} ${styles.header}`}>
        {showsWatts
          ? t('training.playersTarget', { pct: Math.round(ftpPct) })
          : t('training.playersTargetEffort', { effort: Math.round(effort) })}
      </div>
      <ul className={styles.list}>
        {players.map((p) => (
          <li key={p.id} className={`${styles.row} ${p.isMe ? styles.me : ''}`}>
            <span className={styles.who}>
              <span className={styles.name}>{p.name}</span>
              {showsWatts &&
                (Number.isFinite(p.ftp) && p.ftp > 0 ? (
                  <span className={styles.ftp} data-testid="player-ftp">
                    {t('training.playerFtp', { w: Math.round(p.ftp) })}
                  </span>
                ) : (
                  <span
                    className={styles.ftp}
                    data-testid="player-ftp"
                    title={t('training.playerFtpHint')}
                  >
                    {t('training.playerFtpMissing')}
                  </span>
                ))}
            </span>
            {showsWatts && (
              <span className={`${hud.big} ${styles.watts}`}>
                {safeWatts(p.ftp, ftpPct, t('training.watts'))}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
