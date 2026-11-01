import { BlockTimer } from '../hud/BlockTimer';
import { EffortValue } from '../hud/EffortValue';
import { NextBlock } from '../hud/NextBlock';
import { PlayersList } from '../hud/PlayersList';
import { RpmValue } from '../hud/RpmValue';
import { Timeline } from '../hud/Timeline';
import type { BasicLayoutProps } from './types';
import styles from './BasicPlayers.module.css';

export function BasicPlayers({
  view,
  segments,
  players,
  showsWatts,
  rpmIsTarget,
  hideRpmTile,
  reducedMotion,
  controls,
  coach,
}: BasicLayoutProps) {
  return (
    <div className={styles.root} data-testid="layout-players">
      <div className={styles.main}>
        <div className={styles.players}>
          <PlayersList players={players} ftpPct={view.ftpPct} showsWatts={showsWatts} />
        </div>
        <div className={styles.right}>
          <div className={`${styles.tiles} ${hideRpmTile ? styles.two : ''}`}>
            <EffortValue
              effort={view.effort}
              ftpPct={view.ftpPct}
              labelKey={view.labelKey}
              variant="tile"
              color={view.color}
              size="lg"
              animationKey={view.index}
              reducedMotion={reducedMotion}
            />
            {!hideRpmTile && (
              <RpmValue
                rpm={view.segment.rpm}
                position={view.segment.position}
                isTarget={rpmIsTarget}
                size="lg"
              />
            )}
            <BlockTimer
              remainingSec={view.remainingSec}
              durationSec={view.durationSec}
              index={view.index}
              total={view.total}
              pulse={view.pulse}
              size="lg"
              reducedMotion={reducedMotion}
            />
          </div>
          <div className={styles.nextRow}>
            <NextBlock next={view.next} effortColor={view.nextColor} />
            {controls}
          </div>
          <div className={styles.free}>{coach}</div>
        </div>
      </div>
      <Timeline segments={segments} elapsedSec={view.elapsedSec} />
    </div>
  );
}
