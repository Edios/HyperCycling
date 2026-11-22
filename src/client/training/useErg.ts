import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { TrainerSettings } from '../../domain/settings';
import { createErgDriver, type ErgDriver, type ErgSnapshot } from '../devices/erg-driver';
import { useDeviceStore } from '../devices/useDevices';
import { useSessionStore, type SessionRuntime } from './session-store';

const noopSubscribe = () => () => {};
const none = () => null;

/**
 * The ERG driver for one ride. Its moment comes from the session engine, ticked by the driver's
 * own interval as well, so the target follows the workout while the tab is hidden and the render
 * loop sleeps. On leaving the ride the trainer gets Stop and Reset.
 */
export function useErg(
  runtime: SessionRuntime,
  ftp: number | undefined,
  trainerSettings: TrainerSettings,
  { onDeviceStop }: { onDeviceStop?: () => void } = {},
): { driver: ErgDriver | null; snapshot: ErgSnapshot | null } {
  const store = useDeviceStore();
  const ftpRef = useRef(ftp);
  const settingsRef = useRef(trainerSettings);
  const onDeviceStopRef = useRef(onDeviceStop);
  useEffect(() => {
    ftpRef.current = ftp;
    settingsRef.current = trainerSettings;
    onDeviceStopRef.current = onDeviceStop;
  });
  const [driver, setDriver] = useState<ErgDriver | null>(null);

  useEffect(() => {
    const d = createErgDriver({
      store,
      // Stopped on the trainer itself: pause the ride; ERG waits for the rider to resume.
      onDeviceStop: () => {
        const session = useSessionStore.getState();
        if (session.state.status !== 'running') return;
        onDeviceStopRef.current?.();
        session.pause();
      },
      settings: () => settingsRef.current,
      moment: () => {
        const session = useSessionStore.getState();
        session.tick();
        const state = useSessionStore.getState().state;
        const segment = runtime.segments[state.segmentIndex];
        const riderFtp = ftpRef.current;
        if (!segment || riderFtp === undefined || !(riderFtp > 0)) return null;
        return {
          segment,
          segmentIndex: state.segmentIndex,
          elapsedInSegSec: state.segmentElapsedSec,
          running: state.status === 'running',
          finished: state.status === 'finished',
          ftp: riderFtp,
        };
      },
    });
    setDriver(d);
    const offPagehide = finishOnPagehide(d, window);
    return () => {
      offPagehide();
      void d.finish().finally(() => d.dispose());
    };
  }, [store, runtime]);

  const snapshot = useSyncExternalStore(
    driver ? driver.subscribe : noopSubscribe,
    driver ? driver.getSnapshot : none,
    driver ? driver.getSnapshot : none,
  );
  return { driver, snapshot };
}

/**
 * Closing or reloading the tab: React cleanups may not run in time, so send Stop and Reset right
 * away as a best effort (review #113 B1). Returns the unsubscribe.
 */
export function finishOnPagehide(driver: Pick<ErgDriver, 'finish'>, target: Window): () => void {
  const onHide = () => void driver.finish();
  target.addEventListener('pagehide', onHide);
  return () => target.removeEventListener('pagehide', onHide);
}
