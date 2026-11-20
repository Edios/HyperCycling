import { EffortGroup } from '../hud/EffortGroup';
import { HrTarget } from '../hud/HrTarget';
import { hasMeasures, MeasuresGroup } from '../hud/MeasuresGroup';
import { PlayersList } from '../hud/PlayersList';
import { TimeGroup } from '../hud/TimeGroup';
import { Timeline } from '../hud/Timeline';
import type { BasicLayoutProps } from './types';
import styles from './Classic.module.css';

/**
 * Classic tiles (Basic background only): the six groups as tiles. Time left, Measures in the
 * middle, Effort + Next on the right (full height); with riders they get their own column on the
 * left and Time and Measures stack. A tile without data (no cadence) disappears and the others
 * widen. The floor runs along the bottom.
 */
export function Classic({
  withPlayers,
  view,
  segments,
  players,
  showsWatts,
  knobCommand = false,
  rpmIsTarget,
  hideRpmTile,
  reducedMotion,
  workoutName,
  controls,
  coach,
  live,
}: BasicLayoutProps & { withPlayers: boolean }) {
  // Nothing to show (no cadence target, no sensors): the tile is not drawn, no bare placeholder.
  const showMeasures = hasMeasures(view.segment.rpm, !hideRpmTile, live);
  return (
    <div
      className={styles.root}
      data-testid={withPlayers ? 'layout-players' : 'layout-solo'}
      data-material="solid"
      data-players={withPlayers}
      data-measures={showMeasures}
    >
      <div className={styles.tiles}>
        {withPlayers && (
          <PlayersList
            players={players}
            ftpPct={view.ftpPct}
            effort={view.effort}
            showsWatts={showsWatts}
            hr={{ segment: view.segment, elapsedInSegSec: view.durationSec - view.remainingSec }}
            className={styles.riders}
          />
        )}
        <TimeGroup
          remainingSec={view.remainingSec}
          durationSec={view.durationSec}
          pulse={view.pulse}
          reducedMotion={reducedMotion}
          fit
          className={styles.time}
        />
        {showMeasures && (
          <MeasuresGroup
            {...(view.segment.rpm !== undefined ? { rpm: view.segment.rpm } : {})}
            isTarget={rpmIsTarget}
            cadence={!hideRpmTile}
            {...(live ? { live } : {})}
            fit
            className={styles.measures}
          />
        )}
        <EffortGroup
          effort={view.effort}
          ftpPct={view.ftpPct}
          labelKey={view.labelKey}
          {...(view.next ? { next: view.next } : {})}
          position={view.position}
          step={{ index: view.stepIndex, count: view.stepCount }}
          motion={!reducedMotion}
          showFtp={showsWatts}
          {...(knobCommand && view.resistanceCommand
            ? { resistanceCommand: view.resistanceCommand }
            : {})}
          hr={
            <HrTarget
              segment={view.segment}
              elapsedInSegSec={view.durationSec - view.remainingSec}
            />
          }
          className={styles.effort}
        />
      </div>
      <div className={styles.free}>{coach}</div>
      <div className={styles.controls}>{controls}</div>
      <Timeline
        segments={segments}
        elapsedSec={view.elapsedSec}
        blockIndex={view.index}
        title={workoutName}
        className={styles.floor}
      />
    </div>
  );
}
