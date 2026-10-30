import { BlockTimer } from '../hud/BlockTimer';
import { EffortValue } from '../hud/EffortValue';
import { NextBlock } from '../hud/NextBlock';
import { RpmValue } from '../hud/RpmValue';
import { Timeline } from '../hud/Timeline';
import type { BasicLayoutProps } from './types';
import styles from './BasicSolo.module.css';

export function BasicSolo({
  view,
  segments,
  rpmIsTarget,
  hideRpmTile,
  reducedMotion,
  controls,
  coach,
}: BasicLayoutProps) {
  return (
    <div className={styles.root} data-testid="layout-solo">
      <div className={`${styles.tiles} ${hideRpmTile ? styles.two : ''}`}>
        <EffortValue
          effort={view.effort}
          ftpPct={view.ftpPct}
          labelKey={view.labelKey}
          variant="tile"
          color={view.color}
          animationKey={view.index}
          reducedMotion={reducedMotion}
        />
        {!hideRpmTile && (
          <RpmValue
            rpm={view.segment.rpm}
            position={view.segment.position}
            isTarget={rpmIsTarget}
          />
        )}
        <BlockTimer
          remainingSec={view.remainingSec}
          durationSec={view.durationSec}
          index={view.index}
          total={view.total}
          pulse={view.pulse}
          reducedMotion={reducedMotion}
        />
      </div>
      <div className={styles.nextRow}>
        <NextBlock next={view.next} effortColor={view.nextColor} />
        {controls}
      </div>
      <div className={styles.free}>{coach}</div>
      <Timeline segments={segments} elapsedSec={view.elapsedSec} />
    </div>
  );
}
