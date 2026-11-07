import { DashLine } from '../../../brand';
import { EffortGroup } from '../../hud/EffortGroup';
import { HrTarget } from '../../hud/HrTarget';
import { MeasuresGroup } from '../../hud/MeasuresGroup';
import { PlayersList } from '../../hud/PlayersList';
import { TimeGroup } from '../../hud/TimeGroup';
import { Timeline } from '../../hud/Timeline';
import hud from '../../hud/hud.module.css';
import type { BasicLayoutProps } from '../types';
import styles from './overlay.module.css';

export type OverlayKind = 'immersive' | 'column' | 'cockpit' | 'tunnel';

export interface OverlayLayoutProps extends BasicLayoutProps {
  /** Show the riders panel (Corners and Column only). */
  withPlayers?: boolean;
}

interface OverlayHudProps extends OverlayLayoutProps {
  kind: OverlayKind;
}

/**
 * Shared markup of the four overlay layouts. Six groups, one panel (or column section) each:
 * W Effort + Next, C Time, M Measures, P Progress (the floor), R Riders; S Music is the
 * now-playing label of the training screen. The CSS places the groups per layout.
 */
export function OverlayHud({
  kind,
  view,
  segments,
  players,
  showsWatts,
  rpmIsTarget,
  hideRpmTile,
  reducedMotion,
  glass,
  workoutName,
  controls,
  coach,
  withPlayers = false,
}: OverlayHudProps) {
  const showPlayers =
    withPlayers && players.length > 0 && (kind === 'immersive' || kind === 'column');
  const motion = !reducedMotion;
  const column = kind === 'column';
  const tunnel = kind === 'tunnel';
  const effort = (
    <EffortGroup
      effort={view.effort}
      ftpPct={view.ftpPct}
      labelKey={view.labelKey}
      {...(view.next ? { next: view.next } : {})}
      position={view.position}
      step={{ index: view.stepIndex, count: view.stepCount }}
      nextPlacement={column || tunnel ? 'aside' : 'below'}
      glass={glass}
      section={column}
      motion={motion}
      hr={
        <HrTarget segment={view.segment} elapsedInSegSec={view.durationSec - view.remainingSec} />
      }
    />
  );
  const time = (
    <TimeGroup
      remainingSec={view.remainingSec}
      durationSec={view.durationSec}
      pulse={view.pulse}
      reducedMotion={reducedMotion}
      hideLabel={tunnel}
      section={column}
    />
  );
  const measures = hideRpmTile ? null : (
    <MeasuresGroup
      {...(view.segment.rpm !== undefined ? { rpm: view.segment.rpm } : {})}
      isTarget={rpmIsTarget}
      section={column}
      line={column}
      bare={tunnel}
    />
  );
  return (
    <div
      className={styles.root}
      data-testid={`layout-${kind}`}
      data-layout={kind}
      data-players={showPlayers}
      data-material={glass ? 'glass' : 'solid'}
      data-measures={measures !== null}
    >
      <div className={styles.edge} data-testid="overlay-edge" aria-hidden="true" />
      {showPlayers && (
        <PlayersList
          players={players}
          ftpPct={view.ftpPct}
          effort={view.effort}
          showsWatts={showsWatts}
          hr={{ segment: view.segment, elapsedInSegSec: view.durationSec - view.remainingSec }}
        />
      )}
      {column ? (
        <div className={`${hud.panel} ${hud.zoned} ${styles.col}`} data-testid="column-panel">
          {effort}
          <DashLine />
          {time}
          {measures && (
            <>
              <DashLine />
              {measures}
            </>
          )}
        </div>
      ) : (
        <>
          {effort}
          {time}
          {measures}
        </>
      )}
      <div className={styles.free}>{coach}</div>
      <div className={styles.controls}>{controls}</div>
      <Timeline
        segments={segments}
        elapsedSec={view.elapsedSec}
        blockIndex={view.index}
        title={workoutName}
        mini={tunnel}
        className={styles.floor}
      />
    </div>
  );
}
